import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  checkRequestCanCompleteSilently,
  restrictedMethodsMiddleware,
} from "./restrictedMethodsMiddleware";

const { mockIsLocked, mockCheckDomain } = vi.hoisted(() => ({
  mockIsLocked: vi
    .fn<any>()
    .mockResolvedValue({ isLocked: false, hasPasswordSet: true }),
  mockCheckDomain: vi.fn<any>(() => ({ isDomainPhishing: false })),
}));

// The real LockManager pulls in the @theqrl/web3 crypto graph; the silent
// path only needs its isLocked() answer.
vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: (...args: any[]) => mockIsLocked(...args) },
}));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: (...args: any[]) => mockCheckDomain(...args),
}));

const ORIGIN = "https://dapp.example";
const ACCOUNT_A = "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1";
const ACCOUNT_B = "Qb70193d03d693c2c3d0eba4b7d08f31c2b5fe871";

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
      case "DAPPS":
        return connectedAccounts
          ? {
              DAPPS: {
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
      case "ACCOUNTS":
        return { ACCOUNTS: { ALL_ACCOUNTS: walletAccounts } };
      case "LEDGER":
        return {
          LEDGER: {
            LEDGER_ACCOUNTS: ledgerAccounts.map((address) => ({ address })),
          },
        };
      case "SETTINGS":
        return { SETTINGS: settings };
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
      DAPPS: { ALL_DAPPS: Record<string, { accounts: string[] }> };
    };
    expect(written.DAPPS.ALL_DAPPS[ORIGIN].accounts).toEqual([ACCOUNT_A]);
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
});
