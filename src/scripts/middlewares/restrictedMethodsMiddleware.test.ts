import { profileStorageKey } from "@/utilities/profileStorage";
import {
  Json,
  JsonRpcRequest,
  PendingJsonRpcResponse,
} from "@theqrl/qrl-wallet-provider/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { malformed } from "@/test-utils/malformed";
import { isRecord } from "@/utilities/storageGuards";
import StorageUtil from "@/utilities/storageUtil";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import type LockManager from "../lockManager/lockManager";
import type { openApprovalSurface } from "../utils/approvalSurface";
import { resetApprovalSlot } from "../utils/approvalSlot";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import { toChecksumAddress } from "@theqrl/wallet.js";
import {
  POPUP_RESPONSE_TIMEOUT_MS,
  checkRequestCanCompleteSilently,
  restrictedMethodsMiddleware,
} from "./restrictedMethodsMiddleware";

const { mockIsLocked, mockCheckDomain, mockOpenApprovalSurface } = vi.hoisted(
  () => ({
    mockIsLocked: vi
      .fn<typeof LockManager.isLocked>()
      .mockResolvedValue({ isLocked: false, hasPasswordSet: true }),
    mockCheckDomain: vi.fn<
      typeof import("../phishing/phishingDetector").checkDomain
    >(() => ({ isDomainPhishing: false })),
    mockOpenApprovalSurface: vi
      .fn<typeof openApprovalSurface>()
      .mockResolvedValue(undefined),
  }),
);

// The real LockManager pulls in the @theqrl/web3 crypto graph; the silent
// path only needs its isLocked() answer.
vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: mockIsLocked },
}));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: mockCheckDomain,
}));

vi.mock("../utils/approvalSurface", () => ({
  openApprovalSurface: mockOpenApprovalSurface,
}));

vi.mock("../utils/dAppTransactionWatcher", () => ({
  registerDAppTransactionWatch: vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));

const mockedBrowser = vi.mocked(browser, true);

const ORIGIN = "https://dapp.example";
const ACCOUNT_A = toChecksumAddress(`Q${"a".repeat(128)}`);
const ACCOUNT_B = toChecksumAddress(`Q${"b".repeat(128)}`);

type StorageFixtures = {
  connectedAccounts?: string[];
  walletAccounts?: string[];
  ledgerAccounts?: string[];
  settings?: object;
  connectedBlockchains?: unknown;
  otherDApps?: Record<string, unknown>;
};

const setupStorage = ({
  connectedAccounts,
  walletAccounts = [ACCOUNT_A, ACCOUNT_B],
  ledgerAccounts = [],
  settings = {},
  connectedBlockchains = [],
  otherDApps = {},
}: StorageFixtures) => {
  const records: Record<string, unknown> = {
    [profileStorageKey("DAPPS")]: {
      ALL_DAPPS: {
        ...otherDApps,
        ...(connectedAccounts && {
          [ORIGIN]: {
            urlOrigin: ORIGIN,
            accounts: connectedAccounts,
            blockchains: connectedBlockchains,
            permissions: [],
          },
        }),
      },
    },
    [profileStorageKey("ACCOUNTS")]: { ALL_ACCOUNTS: walletAccounts },
    [profileStorageKey("LEDGER")]: {
      LEDGER_ACCOUNTS: ledgerAccounts.map((address) => ({ address })),
    },
    [profileStorageKey("SETTINGS")]: settings,
  };
  mockedBrowser.storage.local.get.mockImplementation((key: unknown) =>
    Promise.resolve(
      typeof key === "string" ? { [key]: records[key] } : records,
    ),
  );
  mockedBrowser.storage.local.set.mockImplementation((values: unknown) => {
    if (!isRecord(values))
      return Promise.reject(new Error("Expected storage values"));
    Object.assign(records, values);
    return Promise.resolve();
  });
  return records;
};

type Request = JsonRpcRequest & {
  senderData: { url?: string; mainFrameOrigin?: string; tabId?: number };
};

const buildRequest = (method = "qrl_requestAccounts"): Request => ({
  id: 1,
  jsonrpc: "2.0",
  method,
  params: [],
  senderData: { url: `${ORIGIN}/swap` },
});

const buildResponse = (): PendingJsonRpcResponse<Json> => ({
  id: 1,
  jsonrpc: "2.0",
});

beforeEach(() => {
  resetApprovalSlot();
  mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
  mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
  mockOpenApprovalSurface.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetApprovalSlot();
});

describe("qrl_requestAccounts silent reconnect", () => {
  beforeEach(() => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
  });

  it("returns the stored accounts without opening any approval surface", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A, ACCOUNT_B] });
    const req = buildRequest();
    const res = buildResponse();
    const end = vi.fn();

    await restrictedMethodsMiddleware(req, res, vi.fn(), end);

    expect(res.result).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(res.error).toBeUndefined();
    expect(end).toHaveBeenCalledTimes(1);
    // no popup, no notification window, no pending-request write
    expect(mockedBrowser.action.openPopup.mock.calls).toHaveLength(0);
    expect(mockedBrowser.windows.create.mock.calls).toHaveLength(0);
    expect(mockedBrowser.storage.session.set.mock.calls).toHaveLength(0);
  });

  it.each([undefined, "null", "not an origin"])(
    "rejects a missing or opaque requester origin immediately (%s)",
    async (url) => {
      setupStorage({ connectedAccounts: undefined });
      const req = buildRequest();
      req.senderData = { url };
      const res = buildResponse();
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res, vi.fn(), end);

      expect(res.error?.code).toBe(4100);
      expect(end).toHaveBeenCalledTimes(1);
      expect(mockedBrowser.storage.session.set.mock.calls).toHaveLength(0);
      expect(mockedBrowser.action.openPopup.mock.calls).toHaveLength(0);
      expect(mockedBrowser.windows.create.mock.calls).toHaveLength(0);
    },
  );

  it("prompts when the origin has no stored connection", async () => {
    setupStorage({ connectedAccounts: undefined });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
  });

  it("prompts while the wallet is locked", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
  });

  it("prompts when the frame origin is phishing-flagged", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    mockCheckDomain.mockReturnValue({ isDomainPhishing: true });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
  });

  it("prompts when only the parent tab origin is phishing-flagged", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    mockCheckDomain.mockImplementation((url: unknown) => ({
      isDomainPhishing: url === "https://evil.example",
    }));
    const req = buildRequest();
    req.senderData.mainFrameOrigin = "https://evil.example";

    expect(await checkRequestCanCompleteSilently(req)).toEqual({
      hasCompleted: false,
    });
  });

  it("filters out accounts deleted from the wallet and prunes the record", async () => {
    setupStorage({
      connectedAccounts: [ACCOUNT_A, ACCOUNT_B],
      walletAccounts: [ACCOUNT_A],
    });

    const result = await checkRequestCanCompleteSilently(buildRequest());

    expect(result).toEqual({
      hasCompleted: true,
      completionResult: [ACCOUNT_A],
    });
    const written: unknown = mockedBrowser.storage.local.set.mock.lastCall?.[0];
    expect(written).toMatchObject({
      [profileStorageKey("DAPPS")]: {
        ALL_DAPPS: { [ORIGIN]: { accounts: [ACCOUNT_A] } },
      },
    });
  });

  it("counts ledger accounts as live accounts", async () => {
    setupStorage({
      connectedAccounts: [ACCOUNT_B],
      walletAccounts: [],
      ledgerAccounts: [ACCOUNT_B],
    });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: true,
      completionResult: [ACCOUNT_B],
    });
  });

  it("prompts without touching storage when no stored account still exists", async () => {
    setupStorage({
      connectedAccounts: [ACCOUNT_B],
      walletAccounts: [ACCOUNT_A],
    });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
    expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
  });

  it("keeps prompting for wallet_requestPermissions (re-selection escape hatch)", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });

    expect(
      await checkRequestCanCompleteSilently(
        buildRequest("wallet_requestPermissions"),
      ),
    ).toEqual({ hasCompleted: false });
  });

  it("rejects qrl_signTypedData_v4 locally before opening an approval surface", async () => {
    {
      setupStorage({ connectedAccounts: [ACCOUNT_A] });
      const req = buildRequest("qrl_signTypedData_v4");
      req.params = [ACCOUNT_A, { domain: { chainId: "0x539" } }];
      const res = buildResponse();
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res, vi.fn(), end);

      expect(res.error?.code).toBe(4200);
      expect(res.error?.message).toContain("cannot encode QIP-55 addresses");
      expect(end).toHaveBeenCalledTimes(1);
      expect(mockedBrowser.action.openPopup.mock.calls).toHaveLength(0);
      expect(mockedBrowser.windows.create.mock.calls).toHaveLength(0);
      expect(mockedBrowser.storage.session.set.mock.calls).toHaveLength(0);
    }
  });
});

describe("restricted request boundaries", () => {
  it.each(["wallet_addQRLChain", "wallet_switchQRLChain"])(
    "%s silently acknowledges an existing chain with a case-insensitive ID",
    async (method) => {
      setupStorage({ connectedAccounts: [ACCOUNT_A] });
      const req = buildRequest(method);
      req.params = [{ chainId: DEFAULT_BLOCKCHAIN.chainId.toUpperCase() }];

      expect(await checkRequestCanCompleteSilently(req)).toEqual({
        hasCompleted: true,
        completionResult: null,
      });
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it.each([undefined, null, {}, [], [null], [{}], [{ chainId: 42 }]])(
    "keeps malformed chain parameters out of silent completion (%j)",
    async (params) => {
      setupStorage({});
      for (const method of ["wallet_addQRLChain", "wallet_switchQRLChain"]) {
        const req = buildRequest(method);
        req.params = malformed(params);
        expect(await checkRequestCanCompleteSilently(req)).toEqual({
          hasCompleted: false,
        });
      }
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it("returns capabilities for positional and indexed-object parameters", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    for (const params of [
      [ACCOUNT_A, ["0x301825", "0x123"]],
      { 0: ACCOUNT_A, 1: ["0x301825", "0x123"] },
    ]) {
      const req = buildRequest("wallet_getCapabilities");
      req.params = params;
      const res = buildResponse();
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res, vi.fn(), end);

      expect(res.result).toEqual({
        "0x301825": { atomic: { status: "supported" } },
        "0x123": { atomic: { status: "supported" } },
      });
      expect(res.error).toBeUndefined();
      expect(end).toHaveBeenCalledOnce();
    }
    expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
  });

  it.each([undefined, null, []])(
    "keeps empty capabilities for %j",
    async (chains) => {
      const req = buildRequest("wallet_getCapabilities");
      req.params = chains === undefined ? [ACCOUNT_A] : [ACCOUNT_A, chains];
      expect(await checkRequestCanCompleteSilently(req)).toEqual({
        hasCompleted: true,
        completionResult: {},
      });
    },
  );

  it.each(["0x301825", 42, {}, [null], [42], ["0x301825", {}]])(
    "rejects malformed capability chains before opening an approval (%j)",
    async (chains) => {
      setupStorage({ connectedAccounts: [ACCOUNT_A] });
      const req = buildRequest("wallet_getCapabilities");
      req.params = [ACCOUNT_A, chains];
      const res = buildResponse();

      await restrictedMethodsMiddleware(req, res, vi.fn(), vi.fn());

      expect(res.error?.code).toBe(-32602);
      expect(res.error?.message).toBe("The wallet cannot parse the request.");
      expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["wallet_addQRLChain", undefined],
    ["wallet_addQRLChain", [{ chainId: 12 }]],
    [
      "wallet_addQRLChain",
      [
        {
          chainId: "0x123",
          chainName: "Test",
          rpcUrls: [42],
          nativeCurrency: null,
        },
      ],
    ],
    ["wallet_switchQRLChain", [null]],
    ["wallet_switchQRLChain", [{ chainId: 12 }]],
    ["wallet_watchAsset", [{ type: 42 }]],
    ["wallet_watchAsset", [{ type: "ZRC20", options: null }]],
    [
      "wallet_watchAsset",
      [
        {
          type: "ZRC20",
          options: { address: ACCOUNT_A, symbol: "TEST", decimals: "18" },
        },
      ],
    ],
    [
      "wallet_watchAsset",
      [
        {
          type: "ZRC20",
          options: { address: 123, symbol: "TEST", decimals: 18 },
        },
      ],
    ],
    ["wallet_requestPermissions", [null]],
    ["wallet_requestPermissions", [[]]],
  ] satisfies Array<[string, unknown]>)(
    "rejects malformed %s input with invalid params (%j)",
    async (method, params) => {
      setupStorage({ connectedAccounts: [ACCOUNT_A] });
      const req = buildRequest(method);
      req.params = malformed(params);
      const res = buildResponse();
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res, vi.fn(), end);

      expect(res.error?.code).toBe(-32602);
      expect(end).toHaveBeenCalledOnce();
      expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it("preserves the locked-wallet refusal before parameter validation", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
    const req = buildRequest("wallet_addQRLChain");
    req.params = [null];
    const res = buildResponse();

    await restrictedMethodsMiddleware(req, res, vi.fn(), vi.fn());

    expect(res.error).toMatchObject({
      code: 4100,
      message: "The wallet is locked. Unlock it and try again.",
    });
  });

  it.each([
    { url: 42 },
    { url: ORIGIN, mainFrameOrigin: 42 },
    { url: ORIGIN, tabId: "tab" },
  ])("rejects malformed sender metadata (%j)", async (senderData) => {
    const req = buildRequest();
    req.senderData = malformed(senderData);
    const res = buildResponse();

    await restrictedMethodsMiddleware(req, res, vi.fn(), vi.fn());

    expect(res.error?.code).toBe(4100);
    expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
  });

  it("keeps stored chain records and unrelated dApps intact when pruning deleted accounts", async () => {
    const chains = [
      { chainId: "0x301825", custom: { label: "First" } },
      { chainId: "0x123", custom: ["Second", "Third"] },
    ];
    const otherDApps = {
      "https://other.example": { unknownRecord: [1, null, 3] },
    };
    const records = setupStorage({
      connectedAccounts: [ACCOUNT_B, ACCOUNT_A],
      walletAccounts: [ACCOUNT_A],
      connectedBlockchains: chains,
      otherDApps,
    });

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: true,
      completionResult: [ACCOUNT_A],
    });

    expect(records[profileStorageKey("DAPPS")]).toMatchObject({
      ALL_DAPPS: {
        ...otherDApps,
        [ORIGIN]: { accounts: [ACCOUNT_A], blockchains: chains },
      },
    });
  });

  it("preserves stored account order and skips writes when all accounts are live", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_B, ACCOUNT_A] });
    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: true,
      completionResult: [ACCOUNT_B, ACCOUNT_A],
    });
    expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
  });

  it.each([[{ chainId: 42 }], [null], "chains"])(
    "keeps malformed stored grants out of silent pruning (%j)",
    async (connectedBlockchains) => {
      const records = setupStorage({
        connectedAccounts: [ACCOUNT_A, ACCOUNT_B],
        walletAccounts: [ACCOUNT_A],
        connectedBlockchains,
      });
      const before = structuredClone(records);

      expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
        hasCompleted: false,
      });
      expect(records).toEqual(before);
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it("requires a readable unlocked state for silent reconnect", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });
    mockIsLocked.mockResolvedValue(malformed({ hasPasswordSet: true }));

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
    expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
  });

  it("keeps malformed ledger data from causing a partial grant rewrite", async () => {
    setupStorage({
      connectedAccounts: [ACCOUNT_A, ACCOUNT_B],
      walletAccounts: [ACCOUNT_A],
    });
    vi.spyOn(StorageUtil, "getLedgerAccounts").mockResolvedValue(
      malformed([{ address: 42 }]),
    );

    expect(await checkRequestCanCompleteSilently(buildRequest())).toEqual({
      hasCompleted: false,
    });
    expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
  });
});

describe("approval message boundaries and cleanup", () => {
  const trustedSender = {
    id: "mock-id",
    url: "chrome-extension://mock-id/index.html",
  };
  let sessionStore: Map<string, unknown>;

  beforeEach(() => {
    sessionStore = new Map();
    setupStorage({
      connectedAccounts: [ACCOUNT_A],
      connectedBlockchains: [{ chainId: DEFAULT_BLOCKCHAIN.chainId }],
    });
    mockedBrowser.storage.session.get.mockImplementation((key: unknown) =>
      Promise.resolve(
        typeof key === "string"
          ? { [key]: sessionStore.get(key) }
          : Object.fromEntries(sessionStore),
      ),
    );
    mockedBrowser.storage.session.set.mockImplementation((values: unknown) => {
      if (!isRecord(values))
        return Promise.reject(new Error("Expected storage values"));
      for (const [key, value] of Object.entries(values))
        sessionStore.set(key, value);
      return Promise.resolve();
    });
  });

  const post = (message: unknown, sender = trustedSender): unknown[] => {
    const removed = new Set(
      mockedBrowser.runtime.onMessage.removeListener.mock.calls.map(
        ([listener]) => listener,
      ),
    );
    const answers: unknown[] = [];
    for (const [listener] of mockedBrowser.runtime.onMessage.addListener.mock
      .calls) {
      if (!removed.has(listener)) {
        const answer: unknown = listener(message, sender, vi.fn());
        if (answer !== undefined) answers.push(answer);
      }
    }
    return answers;
  };

  const startApproval = async (
    method = "wallet_requestPermissions",
    params: Json[] = [{ qrl_accounts: {} }],
  ) => {
    const req = buildRequest(method);
    req.params = params;
    const res = buildResponse();
    const end = vi.fn();
    const call = restrictedMethodsMiddleware(req, res, vi.fn(), end);
    const requestId = await vi.waitFor(() => {
      const dapps = sessionStore.get(profileStorageKey("DAPPS"));
      const request = isRecord(dapps) ? dapps.DAPPS_REQUEST_DATA : undefined;
      if (!isRecord(request) || typeof request.requestId !== "string") {
        throw new Error("Expected a pending approval");
      }
      return request.requestId;
    });
    return { call, res, end, requestId, method };
  };

  const respond = (
    approval: Awaited<ReturnType<typeof startApproval>>,
    response?: unknown,
    hasApproved = true,
  ) => {
    post({
      method: approval.method,
      requestId: approval.requestId,
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved,
      response,
    });
    return approval.call;
  };

  it("ignores malformed, stale, mismatched, and untrusted approval messages", async () => {
    const approval = await startApproval();
    const message = {
      method: approval.method,
      requestId: approval.requestId,
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved: true,
      response: { accounts: [ACCOUNT_A], blockchains: [] },
    };
    for (const invalid of [
      null,
      undefined,
      [],
      42,
      {},
      { ...message, requestId: "stale" },
      { ...message, method: "qrl_sendTransaction" },
      { ...message, hasApproved: "yes" },
    ]) {
      expect(post(invalid)).toEqual([]);
    }
    post(message, { id: "mock-id", url: ORIGIN });
    expect(approval.end).not.toHaveBeenCalled();
    expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);

    await respond(approval, message.response);

    expect(approval.end).toHaveBeenCalledOnce();
    expect(approval.res.error).toBeUndefined();
  });

  it("rejects a malformed click acknowledgement and accepts the next valid click once", async () => {
    const approval = await startApproval();
    const message = {
      requestId: approval.requestId,
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
    };
    expect(await Promise.all(post({ ...message, hasApproved: "yes" }))).toEqual(
      [{ accepted: false }],
    );
    expect(await Promise.all(post({ ...message, hasApproved: true }))).toEqual([
      { accepted: true },
    ]);
    expect(await Promise.all(post({ ...message, hasApproved: true }))).toEqual([
      { accepted: false },
    ]);

    await respond(approval, { accounts: [ACCOUNT_A], blockchains: [] });
    expect(approval.res.error).toBeUndefined();
  });

  it.each([
    null,
    {},
    { accounts: [ACCOUNT_A, 7], blockchains: [] },
    { accounts: new Array<unknown>(1), blockchains: [] },
    { accounts: [ACCOUNT_A], blockchains: [null] },
    { accounts: [ACCOUNT_A], blockchains: new Array<unknown>(1) },
    { accounts: [ACCOUNT_A], blockchains: [{ chainId: 7 }] },
  ])(
    "rejects malformed approval grants without writing connection data (%j)",
    async (response) => {
      const approval = await startApproval();
      await respond(approval, response);

      expect(approval.res.error?.code).toBe(-32603);
      expect(approval.end).toHaveBeenCalledOnce();
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it("retains the complete grant records and account order after approval", async () => {
    setupStorage({});
    const approval = await startApproval("qrl_requestAccounts", []);
    const blockchains = [
      { chainId: DEFAULT_BLOCKCHAIN.chainId, custom: { label: "Retained" } },
    ];
    await respond(approval, { accounts: [ACCOUNT_B, ACCOUNT_A], blockchains });

    expect(approval.res.result).toEqual([ACCOUNT_B, ACCOUNT_A]);
    const written: unknown = mockedBrowser.storage.local.set.mock.lastCall?.[0];
    expect(written).toMatchObject({
      [profileStorageKey("DAPPS")]: {
        ALL_DAPPS: {
          [ORIGIN]: { accounts: [ACCOUNT_B, ACCOUNT_A], blockchains },
        },
      },
    });
  });

  it.each([true, false])(
    "preserves a watch-asset approval result of %s",
    async (result) => {
      const approval = await startApproval("wallet_watchAsset", [
        {
          type: "ZRC20",
          options: { address: ACCOUNT_A, symbol: "TEST", decimals: 18 },
        },
      ]);
      await respond(approval, { result });
      expect(approval.res.result).toBe(result);
      expect(approval.res.error).toBeUndefined();
    },
  );

  it("requires a boolean success flag from watch-asset approvals", async () => {
    const approval = await startApproval("wallet_watchAsset", [
      {
        type: "ZRC20",
        options: { address: ACCOUNT_A, symbol: "TEST", decimals: 18 },
      },
    ]);
    await respond(approval, { result: "yes" });
    expect(approval.res.result).toBe(false);
  });

  it("keeps the add-chain wire format with a null currency and omitted optional fields", async () => {
    const approval = await startApproval("wallet_addQRLChain", [
      {
        chainId: "0x123",
        chainName: "Test",
        rpcUrls: ["https://rpc.example"],
        nativeCurrency: null,
      },
    ]);
    await respond(approval, { result: true });
    expect(approval.res.result).toBeNull();
    expect(approval.res.error).toBeUndefined();
  });

  it("preserves recorded signing error codes, messages, and data", async () => {
    const approval = await startApproval("personal_sign", [
      "0x1234",
      ACCOUNT_A,
    ]);
    const error = {
      code: 4100,
      message: "The wallet is locked",
      data: { detail: "retained" },
    };
    await respond(approval, { error });
    expect(approval.res.error).toMatchObject({
      code: error.code,
      message: error.message,
      data: error,
    });
  });

  it("fails closed for a non-JSON signing error payload", async () => {
    const approval = await startApproval("personal_sign", [
      "0x1234",
      ACCOUNT_A,
    ]);
    await respond(approval, {
      error: { code: 4100, message: "Locked", data: 1n },
    });
    expect(approval.res.error?.code).toBe(-32603);
    expect(approval.res.result).toBeUndefined();
  });

  it("requires a string transaction hash", async () => {
    const approval = await startApproval("qrl_sendTransaction", [
      { from: ACCOUNT_A, to: ACCOUNT_B, value: "0x0" },
    ]);
    await respond(approval, { transactionHash: 42 });
    expect(approval.res.error?.code).toBe(-32003);
    expect(approval.res.result).toBeUndefined();
  });

  it("preserves the pending transaction hash and recorded error data", async () => {
    const approval = await startApproval("qrl_sendTransaction", [
      { from: ACCOUNT_A, to: ACCOUNT_B, value: "0x0" },
    ]);
    const error = {
      code: -32603,
      message: "Broadcast timed out",
      data: { transactionHash: "0xdeadbeef", pending: true },
    };
    await respond(approval, { error });
    expect(approval.res.error).toMatchObject({
      code: error.code,
      message: error.message,
      data: { ...error, transactionHash: "0xdeadbeef" },
    });
  });

  it("completes a response even when stored-request cleanup rejects", async () => {
    const approval = await startApproval();
    vi.spyOn(
      StorageUtil,
      "clearDAppsRequestDataForRequestId",
    ).mockRejectedValue(new Error("Storage unavailable"));
    await respond(approval, undefined, false);
    expect(approval.res.error?.code).toBe(4001);
    expect(approval.end).toHaveBeenCalledOnce();
  });

  it("completes the idle timeout even when stored-request cleanup rejects", async () => {
    vi.useFakeTimers();
    const approval = await startApproval();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(
      StorageUtil,
      "clearDAppsRequestDataForRequestId",
    ).mockRejectedValue(new Error("Storage unavailable"));
    await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS);
    await approval.call;
    expect(approval.res.error?.code).toBe(4001);
    expect(approval.end).toHaveBeenCalledOnce();
  });

  it("removes approval listeners and timers when storing the request fails", async () => {
    vi.useFakeTimers();
    const failure = new Error("Storage unavailable");
    mockedBrowser.storage.session.set.mockRejectedValueOnce(failure);
    const req = buildRequest("wallet_requestPermissions");
    req.params = [{ qrl_accounts: {} }];

    await expect(
      restrictedMethodsMiddleware(req, buildResponse(), vi.fn(), vi.fn()),
    ).rejects.toBe(failure);

    expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
    expect(mockedBrowser.runtime.onMessage.removeListener.mock.calls).toEqual(
      mockedBrowser.runtime.onMessage.addListener.mock.calls,
    );
    expect(mockedBrowser.runtime.onConnect.removeListener.mock.calls).toEqual(
      mockedBrowser.runtime.onConnect.addListener.mock.calls,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its stored request and listeners when opening the approval surface fails", async () => {
    vi.useFakeTimers();
    const failure = new Error("Approval surface unavailable");
    mockOpenApprovalSurface.mockRejectedValueOnce(failure);
    const req = buildRequest("wallet_requestPermissions");
    req.params = [{ qrl_accounts: {} }];

    await expect(
      restrictedMethodsMiddleware(req, buildResponse(), vi.fn(), vi.fn()),
    ).rejects.toBe(failure);

    const stored = sessionStore.get(profileStorageKey("DAPPS"));
    expect(
      isRecord(stored) ? stored.DAPPS_REQUEST_DATA : undefined,
    ).toBeUndefined();
    expect(mockedBrowser.runtime.onMessage.removeListener.mock.calls).toEqual(
      mockedBrowser.runtime.onMessage.addListener.mock.calls,
    );
    expect(mockedBrowser.runtime.onConnect.removeListener.mock.calls).toEqual(
      mockedBrowser.runtime.onConnect.addListener.mock.calls,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
