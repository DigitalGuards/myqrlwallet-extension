import { profileStorageKey } from "@/utilities/profileStorage";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  APPROVAL_ORIGIN_COOLDOWN_MS,
  APPROVAL_REFUSAL_GRACE,
  APPROVAL_REFUSAL_WINDOW_MS,
  resetApprovalSlot,
} from "../utils/approvalSlot";
import {
  APPROVAL_DISCONNECT_GRACE_MS,
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
const SILENT_ACCOUNT = toChecksumAddress(`Q${"a".repeat(128)}`);

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

  // What the approval surface looks like to the service worker: this
  // extension's own id, on an extension-origin page.
  const TRUSTED_SENDER = {
    id: "mock-id",
    url: "chrome-extension://mock-id/index.html",
  };

  const post = (
    message: Partial<DAppResponseType>,
    sender: unknown = TRUSTED_SENDER,
  ) => {
    const answers: unknown[] = [];
    for (const listener of liveMessageListeners()) {
      const answer = (listener as (value: unknown, sender: unknown) => unknown)(
        message,
        sender,
      );
      if (answer !== undefined) answers.push(answer);
    }
    return answers;
  };

  /** Drive the approval surface's click handshake and return the answer. */
  const actOnPending = async (requestId?: string) => {
    const answers = post({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId: requestId ?? pendingRequestId(),
    });
    return answers.length === 0 ? undefined : await answers[0];
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

  /**
   * Connect the approval surface's lifecycle port the way DAppRequest.tsx
   * does, and hand back its disconnect trigger.
   */
  const connectApprovalPort = (sender: unknown = TRUSTED_SENDER) => {
    const disconnectListeners: Array<() => unknown> = [];
    const port = {
      name: "qrl-wallet-dapp-request",
      sender,
      onDisconnect: {
        addListener: (listener: () => unknown) => {
          disconnectListeners.push(listener);
        },
        removeListener: (listener: () => unknown) => {
          const index = disconnectListeners.indexOf(listener);
          if (index >= 0) disconnectListeners.splice(index, 1);
        },
      },
    };
    for (const listener of vi
      .mocked(browser.runtime.onConnect.addListener)
      .mock.calls.map((call) => call[0])) {
      (listener as (value: unknown) => unknown)(port);
    }
    return {
      disconnect: async () => {
        await Promise.all(disconnectListeners.map((listener) => listener()));
      },
      hasDisconnectListener: () => disconnectListeners.length > 0,
    };
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
    expect(await actOnPending(requestId)).toEqual({ accepted: true });

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

    expect(await actOnPending("some-other-request")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS + 1);
    await pending;

    expect(res.error?.code).toBe(4001);
  });

  it("reports an unknown outcome when nothing answers after the click (M1)", async () => {
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

    await actOnPending();
    await vi.advanceTimersByTimeAsync(APPROVAL_IN_PROGRESS_TIMEOUT_MS + 1);
    await pending;

    // The user approved, so a rejection would be a lie and would invite a
    // retry for work that may already have landed.
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain("outcome is unknown");
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

  it("clears the request at once when the surface dies after the click (M-1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    const requestId = await awaitPendingRequest();
    const port = connectApprovalPort();
    await actOnPending(requestId);

    // The action popup closed while the signature was still running.
    await port.disconnect();

    // Nothing is left for the next person who opens the wallet to approve
    // a second time, and the badge has nothing to show.
    await vi.waitFor(() => {
      expect(pendingRequestId()).toBeUndefined();
    });
    // The dApp is still waiting: the answer may have been posted as the
    // port went.
    expect(await isSettled(pending)).toBe(false);

    await vi.advanceTimersByTimeAsync(APPROVAL_DISCONNECT_GRACE_MS + 1);
    await pending;
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain("outcome is unknown");
  });

  it("takes an answer that was already in flight when the surface died (M-1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    const requestId = await awaitPendingRequest();
    const port = connectApprovalPort();
    await actOnPending(requestId);
    await port.disconnect();

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

  it("frees the slot for the next site after an unknown outcome (M-1)", async () => {
    const first = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      {} as never,
      vi.fn(),
      vi.fn(),
    );
    const requestId = await awaitPendingRequest();
    const port = connectApprovalPort();
    await actOnPending(requestId);
    await port.disconnect();
    await vi.advanceTimersByTimeAsync(APPROVAL_DISCONNECT_GRACE_MS + 1);
    await first;

    const nextRes = {} as ResponseShape;
    const next = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      nextRes as never,
      vi.fn(),
      vi.fn(),
    );
    await awaitPendingRequest();
    expect(nextRes.error).toBeUndefined();
    answerPending(false);
    await next;
  });

  it("rejects when the surface dies before the user clicked (M-1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await awaitPendingRequest();
    const port = connectApprovalPort();

    await port.disconnect();
    await pending;

    expect(res.error?.code).toBe(4001);
  });

  it("ignores a response from an untrusted sender (L-1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    const requestId = await awaitPendingRequest();

    // A content script running on the dApp page: same extension id, page
    // origin in the url.
    const contentScriptSender = { id: "mock-id", url: `${ORIGIN_A}/app` };
    post(
      {
        method: "qrl_requestAccounts",
        action: EXTENSION_MESSAGES.DAPP_RESPONSE,
        hasApproved: true,
        requestId,
        response: { accounts: ["QAttacker"], blockchains: [] },
      },
      contentScriptSender,
    );
    post({ action: EXTENSION_MESSAGES.DAPP_RESPONSE }, undefined);
    expect(await isSettled(pending)).toBe(false);

    // The in-progress handshake is refused for the same sender.
    const answers = post(
      {
        action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
        requestId,
      },
      contentScriptSender,
    );
    expect(answers).toEqual([]);

    answerPending(false);
    await pending;
    expect(res.error?.code).toBe(4001);
  });

  it("ignores a lifecycle port from an untrusted sender (L-1)", async () => {
    const res = {} as ResponseShape;
    const pending = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      res as never,
      vi.fn(),
      vi.fn(),
    );
    await awaitPendingRequest();

    const port = connectApprovalPort({ id: "mock-id", url: `${ORIGIN_A}/app` });
    expect(port.hasDisconnectListener()).toBe(false);
    await port.disconnect();
    expect(await isSettled(pending)).toBe(false);

    answerPending(false);
    await pending;
  });

  it("charges a refusal to the top-level origin of an iframe request (L-3)", async () => {
    const iframeRequest = (frameOrigin: string) => {
      const req = buildRequest(frameOrigin, 11);
      (req.senderData as { mainFrameOrigin?: string }).mainFrameOrigin =
        ORIGIN_A;
      return req;
    };

    // Each attempt comes from a fresh subdomain, so the frame origin alone
    // would hand every one of them a clean streak.
    for (let attempt = 0; attempt <= APPROVAL_REFUSAL_GRACE; attempt += 1) {
      const pending = restrictedMethodsMiddleware(
        iframeRequest(`https://frame${attempt}.a.example`),
        {} as never,
        vi.fn(),
        vi.fn(),
      );
      await awaitPendingRequest();
      answerPending(false);
      await pending;
    }

    const blockedRes = {} as ResponseShape;
    await restrictedMethodsMiddleware(
      iframeRequest("https://frame-next.a.example"),
      blockedRes as never,
      vi.fn(),
      vi.fn(),
    );

    expect(blockedRes.error?.code).toBe(-32002);
  });

  it("keeps the refusal window longer than the idle timeout (L-3)", () => {
    // A site that simply reopens a prompt the user ignores each time must
    // still build a streak, which needs the window to outlast the timeout
    // that ends each of those attempts.
    expect(APPROVAL_REFUSAL_WINDOW_MS).toBeGreaterThanOrEqual(
      POPUP_RESPONSE_TIMEOUT_MS,
    );
  });

  it("leaves the slot alone for a request that completes silently (L-4)", async () => {
    // A stored grant lets qrl_requestAccounts answer without a prompt.
    vi.mocked(browser.storage.local.get).mockImplementation(
      async (key: unknown) => {
        if (key === profileStorageKey("DAPPS")) {
          return {
            [profileStorageKey("DAPPS")]: {
              ALL_DAPPS: {
                [ORIGIN_A]: {
                  urlOrigin: ORIGIN_A,
                  accounts: [SILENT_ACCOUNT],
                  blockchains: [],
                  permissions: [],
                },
              },
            },
          };
        }
        if (key === profileStorageKey("ACCOUNTS")) {
          return {
            [profileStorageKey("ACCOUNTS")]: {
              ALL_ACCOUNTS: [SILENT_ACCOUNT],
            },
          };
        }
        return {};
      },
    );

    const silentRes = {} as ResponseShape;
    const otherRes = {} as ResponseShape;
    const silent = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_A, 11),
      silentRes as never,
      vi.fn(),
      vi.fn(),
    );
    // A second site asks while the silent one is still running its async
    // checks. Holding the slot across those checks used to answer this one
    // "a request is already pending" and open a surface for it.
    const other = restrictedMethodsMiddleware(
      buildRequest(ORIGIN_B, 22),
      otherRes as never,
      vi.fn(),
      vi.fn(),
    );

    await silent;
    expect(silentRes.result).toEqual([SILENT_ACCOUNT]);
    expect(silentRes.error).toBeUndefined();

    await awaitPendingRequest();
    expect(otherRes.error).toBeUndefined();
    answerPending(false);
    await other;
  });
});
