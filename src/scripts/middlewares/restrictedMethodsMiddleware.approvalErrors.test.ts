import { profileStorageKey } from "@/utilities/profileStorage";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import { resetApprovalSlot } from "../utils/approvalSlot";
import { restrictedMethodsMiddleware } from "./restrictedMethodsMiddleware";
import { DAppResponseType } from "./middlewareTypes";

const { mockIsLocked, mockCheckDomain, mockOpenApprovalSurface } = vi.hoisted(
  () => ({
    mockIsLocked: vi
      .fn()
      .mockResolvedValue({ isLocked: false, hasPasswordSet: true }),
    mockCheckDomain: vi.fn(() => ({ isDomainPhishing: false })),
    mockOpenApprovalSurface: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: () => mockIsLocked() },
}));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: () => mockCheckDomain(),
}));

vi.mock("../utils/approvalSurface", () => ({
  openApprovalSurface: (...args: unknown[]) => mockOpenApprovalSurface(...args),
}));

// The watcher talks to the node; this file only cares about the answer the
// dApp receives.
vi.mock("../utils/dAppTransactionWatcher", () => ({
  registerDAppTransactionWatch: vi.fn().mockResolvedValue(undefined),
}));

const ORIGIN = "https://dapp.example";
const ACCOUNT = toChecksumAddress(`Q${"a".repeat(128)}`);
const RECIPIENT = toChecksumAddress(`Q${"b".repeat(128)}`);
const CHAIN_ID = "0x301825";
const DAPPS_KEY = profileStorageKey("DAPPS");

type ResponseShape = {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

/**
 * What the approval screens record when they refuse, as the dApp request
 * store serializes it: a plain object carrying the EIP-1193 or EIP-1474
 * code the screen chose.
 */
const RECORDED_EMPTY_RESULT_ERROR = {
  code: -32603,
  message:
    "The wallet approved this request but produced no result. Try again from the site.",
};

const RECORDED_LOCKED_ERROR = {
  code: 4100,
  message: "The wallet is locked",
};

describe("the dApp receives the code the approval recorded", () => {
  let sessionStore: Record<string, unknown>;

  const pendingRequestId = (): string | undefined => {
    const dapps = sessionStore[DAPPS_KEY] as
      | { DAPPS_REQUEST_DATA?: { requestId?: string } }
      | undefined;
    return dapps?.DAPPS_REQUEST_DATA?.requestId;
  };

  const liveMessageListeners = () => {
    const added = vi
      .mocked(browser.runtime.onMessage.addListener)
      .mock.calls.map((call) => call[0]);
    const removed = new Set(
      vi
        .mocked(browser.runtime.onMessage.removeListener)
        .mock.calls.map((call) => call[0]),
    );
    return added.filter((listener) => !removed.has(listener));
  };

  const TRUSTED_SENDER = {
    id: "mock-id",
    url: "chrome-extension://mock-id/index.html",
  };

  const post = (message: Partial<DAppResponseType>) => {
    const answers: unknown[] = [];
    for (const listener of liveMessageListeners()) {
      const answer = (listener as (value: unknown, sender: unknown) => unknown)(
        message,
        TRUSTED_SENDER,
      );
      if (answer !== undefined) answers.push(answer);
    }
    return answers;
  };

  /** Click Approve, then answer with what the screen recorded. */
  const approveWith = async (method: string, response: unknown) => {
    const requestId = pendingRequestId();
    const answers = post({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId,
      hasApproved: true,
    });
    if (answers.length > 0) await answers[0];
    post({
      method,
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved: true,
      requestId,
      response,
    } as Partial<DAppResponseType>);
    delete sessionStore[DAPPS_KEY];
  };

  const buildRequest = (
    method: string,
    params: unknown[],
  ): JsonRpcRequest<JsonRpcRequest> =>
    ({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
      senderData: { url: `${ORIGIN}/app`, tabId: 11 },
    }) as never;

  const run = async (method: string, params: unknown[], response: unknown) => {
    const res = {} as ResponseShape;
    const call = restrictedMethodsMiddleware(
      buildRequest(method, params),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    await approveWith(method, response);
    await call;
    return res;
  };

  beforeEach(() => {
    resetApprovalSlot();
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
    mockOpenApprovalSurface.mockResolvedValue(undefined);

    sessionStore = {};
    vi.mocked(browser.storage.session.get).mockImplementation(
      async (key: unknown) => {
        if (typeof key === "string") {
          return key in sessionStore ? { [key]: sessionStore[key] } : {};
        }
        return { ...sessionStore };
      },
    );
    vi.mocked(browser.storage.session.set).mockImplementation(
      async (values: unknown) => {
        Object.assign(sessionStore, values as Record<string, unknown>);
      },
    );
    // The origin holds a grant for this account on the active chain, so a
    // signing request reaches the approval surface rather than being
    // refused by the precheck.
    vi.mocked(browser.storage.local.get).mockImplementation(
      async (key: unknown) => {
        switch (key) {
          case profileStorageKey("DAPPS"):
            return {
              [profileStorageKey("DAPPS")]: {
                ALL_DAPPS: {
                  [ORIGIN]: {
                    urlOrigin: ORIGIN,
                    accounts: [ACCOUNT],
                    blockchains: [{ chainId: CHAIN_ID }],
                    permissions: [],
                  },
                },
              },
            };
          case profileStorageKey("ACCOUNTS"):
            return {
              [profileStorageKey("ACCOUNTS")]: { ALL_ACCOUNTS: [ACCOUNT] },
            };
          default:
            return {};
        }
      },
    );
  });

  afterEach(() => {
    resetApprovalSlot();
    vi.clearAllMocks();
  });

  it("forwards -32603 for a signing approval that produced nothing", async () => {
    const res = await run("personal_sign", ["0x48656c6c6f", ACCOUNT], {
      error: RECORDED_EMPTY_RESULT_ERROR,
    });

    // Flattened to 4200 this said "the wallet does not support
    // personal_sign", which some dApps answer by disabling signing for the
    // rest of the session.
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain("produced no result");
    expect(res.result).toBeUndefined();
  });

  it("forwards 4100 for a signing approval refused by a locked wallet", async () => {
    const res = await run("personal_sign", ["0x48656c6c6f", ACCOUNT], {
      error: RECORDED_LOCKED_ERROR,
    });

    expect(res.error?.code).toBe(4100);
  });

  it("keeps 4200 for a refusal that recorded no code of its own", async () => {
    const res = await run("personal_sign", ["0x48656c6c6f", ACCOUNT], {
      error: { message: "Mnemonic phrases did not match with the address" },
    });

    expect(res.error?.code).toBe(4200);
    expect(res.error?.message).toContain("did not match");
  });

  it("still answers a signature with the signature", async () => {
    const res = await run("personal_sign", ["0x48656c6c6f", ACCOUNT], {
      signature: "0xsigned",
      publicKey: "0xpub",
    });

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ signature: "0xsigned", publicKey: "0xpub" });
  });

  it("forwards -32603 for a send approval that produced nothing", async () => {
    const res = await run(
      "qrl_sendTransaction",
      [{ from: ACCOUNT, to: RECIPIENT, value: "0x0", chainId: CHAIN_ID }],
      { error: RECORDED_EMPTY_RESULT_ERROR },
    );

    expect(res.error?.code).toBe(-32603);
  });

  it("keeps -32003 for a send that failed on its own terms", async () => {
    const res = await run(
      "qrl_sendTransaction",
      [{ from: ACCOUNT, to: RECIPIENT, value: "0x0", chainId: CHAIN_ID }],
      { error: { message: "insufficient funds" } },
    );

    expect(res.error?.code).toBe(-32003);
    expect(res.error?.message).toContain("insufficient funds");
  });

  it("still answers a broadcast with its transaction hash", async () => {
    const res = await run(
      "qrl_sendTransaction",
      [{ from: ACCOUNT, to: RECIPIENT, value: "0x0", chainId: CHAIN_ID }],
      { transactionHash: "0xdeadbeef" },
    );

    expect(res.error).toBeUndefined();
    expect(res.result).toBe("0xdeadbeef");
  });
});
