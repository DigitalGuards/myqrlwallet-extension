import { profileStorageKey } from "@/utilities/profileStorage";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { toChecksumAddress } from "@theqrl/wallet.js";
import {
  DAPP_REQUEST_PORT_NAME,
  EXTENSION_MESSAGES,
} from "../constants/streamConstants";
import {
  checkRequestCanCompleteSilently,
  restrictedMethodsMiddleware,
} from "./restrictedMethodsMiddleware";

const { mockIsLocked, mockCheckDomain } = vi.hoisted(() => ({
  mockIsLocked: vi
    .fn()
    .mockResolvedValue({ isLocked: false, hasPasswordSet: true }),
  mockCheckDomain: vi.fn<
    typeof import("../phishing/phishingDetector").checkDomain
  >(() => ({ isDomainPhishing: false })),
}));

// The real LockManager pulls in the @theqrl/web3 crypto graph; the silent
// path only needs its isLocked() answer.
vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: (...args: any[]) => mockIsLocked(...args) },
}));

vi.mock("../utils/approvalSurface", () => ({
  openApprovalSurface: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("uuid", () => ({ v4: () => "request-1" }));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: (...args: Parameters<typeof mockCheckDomain>) =>
    mockCheckDomain(...args),
}));

const ORIGIN = "https://dapp.example";
const ACCOUNT_A = toChecksumAddress(`Q${"a".repeat(128)}`);
const ACCOUNT_B = toChecksumAddress(`Q${"b".repeat(128)}`);

type StorageFixtures = {
  connectedAccounts?: string[];
  walletAccounts?: string[];
  ledgerAccounts?: string[];
  settings?: object;
};

const setupStorage = ({
  connectedAccounts,
  walletAccounts = [ACCOUNT_A, ACCOUNT_B],
  ledgerAccounts = [],
  settings = {},
}: StorageFixtures) => {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
    switch (key) {
      case profileStorageKey("DAPPS"):
        return connectedAccounts
          ? {
              [profileStorageKey("DAPPS")]: {
                ALL_DAPPS: {
                  [ORIGIN]: {
                    urlOrigin: ORIGIN,
                    accounts: connectedAccounts,
                    blockchains: [],
                    permissions: [],
                  },
                },
              },
            }
          : {};
      case profileStorageKey("ACCOUNTS"):
        return {
          [profileStorageKey("ACCOUNTS")]: { ALL_ACCOUNTS: walletAccounts },
        };
      case profileStorageKey("LEDGER"):
        return {
          [profileStorageKey("LEDGER")]: {
            LEDGER_ACCOUNTS: ledgerAccounts.map((address) => ({ address })),
          },
        };
      case profileStorageKey("SETTINGS"):
        return { [profileStorageKey("SETTINGS")]: settings };
      default:
        return {};
    }
  });
};

const buildRequest = (
  method = "qrl_requestAccounts",
): JsonRpcRequest<JsonRpcRequest> =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method,
    params: [],
    senderData: { url: `${ORIGIN}/swap` },
  }) as never;

describe("qrl_requestAccounts silent reconnect", () => {
  beforeEach(() => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
  });

  it("returns the stored accounts without opening any approval surface", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A, ACCOUNT_B] });
    const req = buildRequest();
    const res = {} as { result?: unknown; error?: unknown };
    const end = vi.fn();

    await restrictedMethodsMiddleware(req, res as never, vi.fn(), end);

    expect(res.result).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(res.error).toBeUndefined();
    expect(end).toHaveBeenCalledTimes(1);
    // no popup, no notification window, no pending-request write
    expect(browser.action.openPopup).not.toHaveBeenCalled();
    expect(browser.windows.create).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
  });

  it.each([undefined, "null", "not an origin"])(
    "rejects a missing or opaque requester origin immediately (%s)",
    async (url) => {
      setupStorage({ connectedAccounts: undefined });
      const req = buildRequest();
      req.senderData = { url };
      const res = {} as { result?: unknown; error?: { code?: number } };
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res as never, vi.fn(), end);

      expect(res.error?.code).toBe(4100);
      expect(end).toHaveBeenCalledTimes(1);
      expect(browser.storage.session.set).not.toHaveBeenCalled();
      expect(browser.action.openPopup).not.toHaveBeenCalled();
      expect(browser.windows.create).not.toHaveBeenCalled();
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
    (req.senderData as { mainFrameOrigin?: string }).mainFrameOrigin =
      "https://evil.example";

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
    const writes = vi.mocked(browser.storage.local.set).mock.calls;
    expect(writes.length).toBeGreaterThan(0);
    const written = writes[writes.length - 1][0] as {
      [key: string]: { ALL_DAPPS: Record<string, { accounts: string[] }> };
    };
    expect(
      written[profileStorageKey("DAPPS")].ALL_DAPPS[ORIGIN].accounts,
    ).toEqual([ACCOUNT_A]);
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
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("keeps prompting for wallet_requestPermissions (re-selection escape hatch)", async () => {
    setupStorage({ connectedAccounts: [ACCOUNT_A] });

    expect(
      await checkRequestCanCompleteSilently(
        buildRequest("wallet_requestPermissions"),
      ),
    ).toEqual({ hasCompleted: false });
  });

  it.each(["qrl_signTypedData_v4", "qrl_signTypedData"])(
    "rejects %s locally before opening an approval surface",
    async (method) => {
      setupStorage({ connectedAccounts: [ACCOUNT_A] });
      const req = buildRequest(method);
      req.params = [ACCOUNT_A, { domain: { chainId: "0x539" } }] as never;
      const res = {} as {
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      const end = vi.fn();

      await restrictedMethodsMiddleware(req, res as never, vi.fn(), end);

      expect(res.error?.code).toBe(4200);
      expect(res.error?.message).toContain("versioned 64-byte address layout");
      expect(end).toHaveBeenCalledTimes(1);
      expect(browser.action.openPopup).not.toHaveBeenCalled();
      expect(browser.windows.create).not.toHaveBeenCalled();
      expect(browser.storage.session.set).not.toHaveBeenCalled();
    },
  );
});

describe("approval wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
    setupStorage({ connectedAccounts: undefined });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const startPrompt = async () => {
    const res = {} as { result?: unknown; error?: { code?: number } };
    const end = vi.fn();
    const done = restrictedMethodsMiddleware(
      buildRequest(),
      res as never,
      vi.fn(),
      end,
    );
    await vi.waitFor(() =>
      expect(browser.runtime.onConnect.addListener).toHaveBeenCalled(),
    );
    const onConnect = vi
      .mocked(browser.runtime.onConnect.addListener)
      .mock.calls.at(-1)![0] as (port: unknown) => void;
    const onMessage = vi
      .mocked(browser.runtime.onMessage.addListener)
      .mock.calls.at(-1)![0] as (message: unknown) => void;
    return { res, end, done, onConnect, onMessage };
  };

  it("keeps waiting past the safety timeout once the popup is connected", async () => {
    const { end, done, onConnect, onMessage } = await startPrompt();
    onConnect({
      name: DAPP_REQUEST_PORT_NAME,
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    });

    // A mined transaction at 60 s slots can take longer than the 90 s timer.
    await vi.advanceTimersByTimeAsync(150_000);
    expect(end).not.toHaveBeenCalled();

    onMessage({
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      requestId: "request-1",
      method: "qrl_requestAccounts",
      hasApproved: false,
    });
    await done;
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("gives up after the safety timeout when the popup never connects", async () => {
    const { res, end, done } = await startPrompt();

    await vi.advanceTimersByTimeAsync(90_000);
    await done;

    expect(end).toHaveBeenCalledTimes(1);
    expect(res.error).toBeDefined();
  });
});
