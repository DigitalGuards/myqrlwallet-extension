import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { profileStorageKey } from "@/utilities/profileStorage";
import { getStoredValue } from "@/utilities/storageGuards";
import StorageUtil from "@/utilities/storageUtil";
import { ACCOUNT, CHAIN } from "@/utilities/__mocks__/storageFixtures";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import { resetApprovalSlot } from "../utils/approvalSlot";
import { openApprovalSurface } from "../utils/approvalSurface";
import { restrictedMethodsMiddleware } from "./restrictedMethodsMiddleware";

vi.mock("../lockManager/lockManager", () => ({
  default: {
    isLocked: () => Promise.resolve({ isLocked: false, hasPasswordSet: true }),
  },
}));
vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: () => ({ isDomainPhishing: false }),
}));
vi.mock("../utils/approvalSurface", () => ({ openApprovalSurface: vi.fn() }));
vi.mock("../utils/dAppTransactionWatcher", () => ({
  registerDAppTransactionWatch: vi.fn(),
}));

const origin = "https://permissions.example";
const dAppsKey = profileStorageKey("DAPPS");
const grants = [
  {
    invoker: origin,
    parentCapability: "qrl_accounts",
    caveats: [{ type: "restrictReturnedAccounts", value: [ACCOUNT] }],
  },
  {
    invoker: origin,
    parentCapability: "qrl_chains",
    caveats: [{ type: "restrictNetworkSwitching", value: [CHAIN.chainId] }],
  },
];
const opaquePermissions: unknown[] = [
  null,
  false,
  7,
  "unreadable",
  [],
  {},
  { futurePermission: true },
  { invoker: origin, parentCapability: "future_capability", caveats: [] },
  { invoker: false, parentCapability: "qrl_accounts", caveats: [] },
  { invoker: origin, parentCapability: null, caveats: false },
];
const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const roundTrip = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

beforeEach(() => {
  resetApprovalSlot();
  vi.clearAllMocks();
  for (const [area, store] of [
    [browser.storage.local, local],
    [browser.storage.session, session],
  ] as const) {
    for (const key of Object.keys(store)) Reflect.deleteProperty(store, key);
    vi.spyOn(area, "get").mockImplementation((key: unknown) =>
      Promise.resolve(
        typeof key === "string"
          ? { [key]: roundTrip(store[key]) }
          : { ...store },
      ),
    );
    vi.spyOn(area, "set").mockImplementation((values) => {
      for (const [key, value] of Object.entries(values))
        store[key] = roundTrip(value);
      return Promise.resolve();
    });
  }
  local[profileStorageKey("ACCOUNTS")] = {
    ALL_ACCOUNTS: [ACCOUNT],
    ACTIVE_ACCOUNT: ACCOUNT,
  };
  local[profileStorageKey("BLOCKCHAINS")] = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
  vi.mocked(openApprovalSurface).mockImplementation(async () => {
    const requestId = getStoredValue(
      session,
      dAppsKey,
      "DAPPS_REQUEST_DATA",
      "requestId",
    );
    expect(requestId).toBeTypeOf("string");
    const removed = new Set(
      vi
        .spyOn(browser.runtime.onMessage, "removeListener")
        .mock.calls.map(([listener]) => listener),
    );
    const listeners = vi
      .spyOn(browser.runtime.onMessage, "addListener")
      .mock.calls.map(([listener]) => listener)
      .filter((listener) => !removed.has(listener));
    expect(listeners).toHaveLength(1);
    for (const action of [
      EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      EXTENSION_MESSAGES.DAPP_RESPONSE,
    ]) {
      for (const listener of listeners) {
        const result: unknown = listener(
          {
            method: "wallet_requestPermissions",
            action,
            requestId,
            hasApproved: true,
            response: { accounts: [ACCOUNT], blockchains: [CHAIN] },
          },
          { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
          vi.fn(),
        );
        await result;
      }
    }
  });
});

afterEach(() => {
  resetApprovalSlot();
  vi.restoreAllMocks();
});

const approve = async () => {
  const response: Parameters<typeof restrictedMethodsMiddleware>[1] = {
    id: 1,
    jsonrpc: "2.0",
  };
  const end = vi.fn();
  await restrictedMethodsMiddleware(
    {
      id: 1,
      jsonrpc: "2.0",
      method: "wallet_requestPermissions",
      params: [{ qrl_accounts: {} }],
      senderData: { url: `${origin}/app`, tabId: 1 },
    },
    response,
    vi.fn(),
    end,
  );
  expect(end).toHaveBeenCalledOnce();
  expect(response.error).toBeUndefined();
  expect(response.result).toEqual(grants);
};

describe("permission approval with opaque stored siblings", () => {
  it.each(
    opaquePermissions.flatMap((opaque, id) =>
      [0, 1, 2].map((position) => ({ opaque, id, position })),
    ),
  )(
    "returns both approved grants with opaque entry $id at position $position",
    async ({ opaque, position }) => {
      const permissions = [
        ...grants.slice(0, position),
        opaque,
        ...grants.slice(position),
      ];
      const connection = {
        urlOrigin: origin,
        accounts: [ACCOUNT],
        blockchains: [CHAIN],
        permissions,
        future: { retain: true },
      };
      local[dAppsKey] = { ALL_DAPPS: { [origin]: connection } };
      const before = JSON.stringify(local);
      for (let repeat = 0; repeat < 2; repeat += 1) {
        await approve();
        expect(JSON.stringify(local)).toBe(before);
        expect(
          (await StorageUtil.getDAppsConnectedAccountsData(origin))
            ?.permissions,
        ).toEqual(permissions);
      }
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      expect(await StorageUtil.getDAppsConnectedAccountsData(origin)).toBe(
        undefined,
      );
    },
  );
});
