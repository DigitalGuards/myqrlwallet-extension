import { profileStorageKey } from "@/utilities/profileStorage";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  APPROVAL_ORIGIN_COOLDOWN_MS,
  APPROVAL_REFUSAL_GRACE,
  resetApprovalSlot,
} from "../utils/approvalSlot";
import {
  APPROVAL_IN_PROGRESS_TIMEOUT_MS,
  POPUP_RESPONSE_TIMEOUT_MS,
  restrictedMethodsMiddleware,
} from "./restrictedMethodsMiddleware";
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

  default: { isLocked: (...args: any[]) => mockIsLocked(...args) },
}));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: (...args: Parameters<typeof mockCheckDomain>) =>
    mockCheckDomain(...args),
}));

// The surface itself is covered by approvalSurface.test.ts; here only the
// tab id the middleware asks it to raise matters.
vi.mock("../utils/approvalSurface", () => ({
  openApprovalSurface: (...args: unknown[]) => mockOpenApprovalSurface(...args),
}));

const ORIGIN_A = "https://a.example";
const ORIGIN_B = "https://b.example";
const DAPPS_KEY = profileStorageKey("DAPPS");

type ResponseShape = {
  result?: unknown;
  error?: { code?: number; message?: string };
};

const buildRequest = (
  origin: string,
  tabId: number,
): JsonRpcRequest<JsonRpcRequest> =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method: "qrl_requestAccounts",
    params: [],
    senderData: { url: `${origin}/app`, tabId },
  }) as never;

describe("restricted method approval slot and timers", () => {
  let sessionStore: Record<string, unknown>;

  const pendingRequestId = (): string | undefined => {
    const dapps = sessionStore[DAPPS_KEY] as
      | { DAPPS_REQUEST_DATA?: { requestId?: string } }
      | undefined;
    return dapps?.DAPPS_REQUEST_DATA?.requestId;
  };

  // browser.runtime.onMessage.removeListener is a bare spy in the mock, so
  // the listeners the middleware has taken back have to be filtered out by
  // hand before a test may post to the ones still live.
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

  const post = (message: Partial<DAppResponseType>) => {
    for (const listener of liveMessageListeners()) {
      (listener as (value: unknown) => unknown)(message);
    }
  };

  /** Wait until the middleware has written a request other than `previous`. */
  const awaitPendingRequest = async (previous?: string) => {
    await vi.waitFor(() => {
      const id = pendingRequestId();
      expect(typeof id === "string" && id !== previous).toBe(true);
    });
    return pendingRequestId() as string;
  };

  /**
   * Answer the pending request the way the approval surface does, and drop
   * the slot from session storage the way onPermission does.
   */
  const answerPending = (hasApproved: boolean, response?: unknown) => {
    post({
      method: "qrl_requestAccounts",
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved,
      requestId: pendingRequestId(),
      response,
    });
    delete sessionStore[DAPPS_KEY];
  };

  const isSettled = async (promise: unknown) => {
    const sentinel = Symbol("pending");
    const winner = await Promise.race([
      Promise.resolve(promise).then(() => "settled" as const),
      Promise.resolve(sentinel),
    ]);
    return winner !== sentinel;
  };

  beforeEach(() => {
    resetApprovalSlot();
    vi.useFakeTimers();
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
    // No stored grant for either origin, so qrl_requestAccounts always
    // reaches the approval surface rather than completing silently.
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    resetApprovalSlot();
  });

  it("serializes two requests that arrive in the same tick (L2)", async () => {
    const firstRes = {} as ResponseShape;
    const secondRes = {} as ResponseShape;

    const first = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      firstRes as never,
      vi.fn(),
      vi.fn(),
    );
    const second = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      secondRes as never,
      vi.fn(),
      vi.fn(),
    );

    await second;
    expect(secondRes.error?.message).toBe("A request is already pending");

    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    // Exactly one request reached the approval slot, so neither dApp was
    // orphaned by the other's session-storage write.
    const requestWrites = vi
      .mocked(browser.storage.session.set)
      .mock.calls.filter(
        (call) =>
          (call[0] as Record<string, { DAPPS_REQUEST_DATA?: unknown }>)[
            DAPPS_KEY
          ]?.DAPPS_REQUEST_DATA !== undefined,
      );
    expect(requestWrites).toHaveLength(1);

    answerPending(false);
    await first;
  });

  it("raises the approval surface in the tab that owns the pending request (L2)", async () => {
    const firstRes = {} as ResponseShape;
    const first = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      firstRes as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    mockOpenApprovalSurface.mockClear();

    await restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      {} as never,
      vi.fn(),
      vi.fn(),
    );

    expect(mockOpenApprovalSurface).toHaveBeenCalledWith({ tabId: 11 });

    answerPending(false);
    await first;
  });

  /** Reject `times` approvals in a row from the same origin. */
  const rejectRepeatedly = async (origin: string, times: number) => {
    for (let attempt = 0; attempt < times; attempt += 1) {
      const pending = restrictedMethodsMiddleware(
        buildRequest(origin, 11),
        {} as never,
        vi.fn(),
        vi.fn(),
      );
      await awaitPendingRequest();
      answerPending(false);
      await pending;
    }
  };

  it("lets a site ask again right after the first refusals (L2)", async () => {
    await rejectRepeatedly(ORIGIN_A, APPROVAL_REFUSAL_GRACE);

    const retryRes = {} as ResponseShape;
    const retry = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      retryRes as never,
      vi.fn(),
      vi.fn(),
    );
    await awaitPendingRequest();
    expect(retryRes.error).toBeUndefined();

    answerPending(false);
    await retry;
  });

  it("makes a repeatedly refused origin back off before it may take the slot again (L2)", async () => {
    await rejectRepeatedly(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);

    mockOpenApprovalSurface.mockClear();
    const retryRes = {} as ResponseShape;
    await restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      retryRes as never,
      vi.fn(),
      vi.fn(),
    );

    expect(retryRes.error?.code).toBe(-32002);
    // A rejected site cannot reopen the wallet in a loop.
    expect(mockOpenApprovalSurface).not.toHaveBeenCalled();

    // Another site is unaffected by one origin's cooldown.
    const otherRes = {} as ResponseShape;
    const other = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      otherRes as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    answerPending(false);
    await other;
  });

  it("lets an origin ask again once its cooldown has elapsed (L2)", async () => {
    await rejectRepeatedly(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);

    await vi.advanceTimersByTimeAsync(APPROVAL_ORIGIN_COOLDOWN_MS + 1);
    const retryRes = {} as ResponseShape;
    const retry = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      retryRes as never,
      vi.fn(),
      vi.fn(),
    );
    await awaitPendingRequest();
    expect(retryRes.error).toBeUndefined();

    answerPending(false);
    await retry;
  });

  it("leaves an approved origin free to ask again at once (L2)", async () => {
    const first = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      {} as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    answerPending(true, { accounts: [], blockchains: [] });
    await first;

    const retryRes = {} as ResponseShape;
    const retry = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      retryRes as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    expect(retryRes.error).toBeUndefined();

    answerPending(false);
    await retry;
  });

  it("rejects a request the user never answered (M1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });

    await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS + 1);
    await pending;

    expect(res.error?.code).toBe(4001);
  });

  it("stops the idle timeout once the user has acted (M1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    const requestId = pendingRequestId();

    // The user clicks Approve with 15 seconds left on the idle clock.
    await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS - 15_000);
    post({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId,
    });

    // A slow node keeps the broadcast running well past where the idle
    // timeout would have answered 4001 underneath it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await isSettled(pending)).toBe(false);

    post({
      method: "qrl_requestAccounts",
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved: true,
      requestId,
      response: { accounts: [], blockchains: [] },
    });
    await pending;

    expect(res.error).toBeUndefined();
  });

  it("ignores an in-progress signal that names another request (M1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });

    post({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId: "some-other-request",
    });
    await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS + 1);
    await pending;

    expect(res.error?.code).toBe(4001);
  });

  it("still bounds an approval that never answers after the click (M1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });

    post({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId: pendingRequestId(),
    });
    await vi.advanceTimersByTimeAsync(APPROVAL_IN_PROGRESS_TIMEOUT_MS + 1);
    await pending;

    expect(res.error?.code).toBe(4001);
    // The slot came back, so the next request is served.
    const nextRes = {} as ResponseShape;
    const next = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      nextRes as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });
    expect(nextRes.error).toBeUndefined();
    answerPending(false);
    await next;
  });

  it("answers a late response only when it names the pending request (M1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeTypeOf("string");
    });

    // The answer an already abandoned approval would post.
    post({
      action: EXTENSION_MESSAGES.DAPP_RESPONSE,
      hasApproved: true,
      requestId: "a-request-that-already-ended",
      response: { transactionHash: "0xdead" },
    });
    expect(await isSettled(pending)).toBe(false);

    answerPending(false);
    await pending;
    expect(res.error?.code).toBe(4001);
  });
});
