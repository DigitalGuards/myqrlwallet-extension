import { Transform, type Duplex } from "readable-stream";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";

export const initializeContentScriptProviderConnection = async <TPort>(
  port: TPort,
  setupConnection: (providerPort: TPort) => Promise<void>,
  announceReady: () => Promise<void>,
) => {
  await setupConnection(port);
  await announceReady();
};

export const createProviderStreamFailureGuard = (
  generation: number,
  currentGeneration: () => number,
  notifyInpage: () => void,
) => {
  let recoverablePortDisconnect = false;

  return {
    markPortDisconnected() {
      recoverablePortDisconnect = true;
    },
    handlePipelineClose() {
      queueMicrotask(() => {
        if (!recoverablePortDisconnect && generation === currentGeneration())
          notifyInpage();
      });
    },
  };
};

type JsonRpcEnvelope = {
  id?: string | number | null;
  method?: unknown;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  envelope: unknown;
  id: string | number;
  method: string;
  createdAt: number;
  forwardedGeneration?: number;
};

/**
 * Unrestricted methods that change state somewhere, so re-running one
 * performs the action a second time.
 *
 * - qrl_sendRawTransaction broadcasts a transaction.
 * - wallet_revokePermissions rewrites the stored dApp grant.
 * - qrl_subscribe, qrl_unsubscribe and the qrl_new*Filter family allocate
 *   or release node-side handles, so a replay leaks or double-frees one.
 * - qrl_uninstallFilter releases a handle the page may since have reused.
 * - qrl_getFilterChanges drains its filter's queue, so a replay returns
 *   events the first call already consumed.
 */
const STATE_CHANGING_UNRESTRICTED_METHODS: ReadonlySet<string> = new Set([
  UNRESTRICTED_METHODS.QRL_SEND_RAW_TRANSACTION,
  UNRESTRICTED_METHODS.WALLET_REVOKE_PERMISSIONS,
  UNRESTRICTED_METHODS.QRL_SUBSCRIBE,
  UNRESTRICTED_METHODS.QRL_UNSUBSCRIBE,
  UNRESTRICTED_METHODS.QRL_NEW_FILTER,
  UNRESTRICTED_METHODS.QRL_NEW_BLOCK_FILTER,
  UNRESTRICTED_METHODS.QRL_NEW_PENDING_TRANSACTION_FILTER,
  UNRESTRICTED_METHODS.QRL_UNINSTALL_FILTER,
  UNRESTRICTED_METHODS.QRL_GET_FILTER_CHANGES,
]);

/**
 * Methods a request may be replayed with after it already reached the
 * service worker.
 *
 * Only the page freezes when Chrome caches it, and a service-worker restart
 * likewise leaves the browser running: a request that was already forwarded
 * may have completed while its answer was dropped on the closed port. For a
 * read that is harmless, because the second call returns the same kind of
 * answer. For anything else the replay is a second distinct action: a
 * second approval prompt for work that already landed, or for the
 * unrestricted qrl_sendRawTransaction a silent second broadcast.
 *
 * The set is therefore the unrestricted method list minus the state
 * changing entries above. Every restricted method is absent by
 * construction, since each one needs the user's approval and none of them
 * can be re-run on the user's behalf. A new entry in UNRESTRICTED_METHODS
 * lands here automatically, so providerConnectionLifecycle.test.ts pins the
 * membership and fails until the new method has been classified.
 */
export const REPLAY_SAFE_METHODS: ReadonlySet<string> = new Set(
  Object.values(UNRESTRICTED_METHODS).filter(
    (method) => !STATE_CHANGING_UNRESTRICTED_METHODS.has(method),
  ),
);

/**
 * A page with this many unanswered provider requests is past any plausible
 * use, so the oldest are settled to keep the pending map bounded.
 */
export const MAX_PENDING_REQUESTS = 100;

/**
 * How long a request orphaned by a connection that never came back may sit
 * in the pending map. A request being served by the current connection is
 * exempt however old it is, because a transaction approval can legitimately
 * stay on screen for a long time.
 */
export const PENDING_REQUEST_TTL_MS = 5 * 60_000;

/**
 * JSON-RPC internal error. EIP-1193 reserves 4900 "Disconnected" for a
 * provider that has lost every chain; here the connection has just been
 * rebuilt and the next request will work, so only this one request is
 * reported as lost and the dApp is told to try again.
 */
const connectionResetResponse = (id: string | number) => ({
  jsonrpc: "2.0",
  id,
  error: {
    code: -32603,
    message: "Connection to the wallet was reset; please retry",
  },
});

const parseRequest = (envelope: unknown) => {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    return undefined;
  const { id, method } = envelope as JsonRpcEnvelope;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof method !== "string"
  )
    return undefined;
  return { key: `${typeof id}:${String(id)}`, id, method };
};

const responseKey = (envelope: unknown) => {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    return undefined;
  const response = envelope as JsonRpcEnvelope;
  if (typeof response.id !== "string" && typeof response.id !== "number")
    return undefined;
  if (!("result" in response) && !("error" in response)) return undefined;
  return `${typeof response.id}:${String(response.id)}`;
};

export const createProviderChannelBridge = (pageChannel: Duplex) => {
  const pendingRequests = new Map<string, PendingRequest>();
  let extensionChannel: Duplex | undefined;
  let extensionGeneration = 0;
  let connectionReady = false;
  let detachExtensionChannel: (() => void) | undefined;

  const settleAsReset = (pendingRequest: PendingRequest) => {
    try {
      pageChannel.write(connectionResetResponse(pendingRequest.id));
    } catch {
      // The page stream is already gone, so there is nobody left to answer
      // and a write error here would surface as a stream failure.
    }
  };

  const expireStalePending = (now: number) => {
    for (const [key, pendingRequest] of pendingRequests) {
      if (pendingRequest.forwardedGeneration === extensionGeneration) continue;
      if (now - pendingRequest.createdAt < PENDING_REQUEST_TTL_MS) continue;
      pendingRequests.delete(key);
      settleAsReset(pendingRequest);
    }
  };

  const oldestStalePending = () => {
    for (const entry of pendingRequests) {
      if (entry[1].forwardedGeneration !== extensionGeneration) return entry;
    }
    return undefined;
  };

  /**
   * Keeps the pending map bounded without touching a request the live
   * connection is still working on: an approval the user has open is the
   * oldest entry by design, and settling it here would answer the dApp with
   * an error while the wallet goes on to complete it. When every pending
   * request belongs to the current connection, the arrival that broke the
   * cap is the one refused. A live connection is piped straight through, so
   * that arrival may still reach the service worker; the cap decides which
   * request the page is answered about, and a page holding this many
   * unanswered requests at once is abusing the provider either way.
   */
  const enforcePendingCap = (incoming?: {
    key: string;
    request: PendingRequest;
  }) => {
    while (pendingRequests.size > MAX_PENDING_REQUESTS) {
      const stale = oldestStalePending();
      if (stale) {
        pendingRequests.delete(stale[0]);
        settleAsReset(stale[1]);
        continue;
      }
      if (!incoming || !pendingRequests.has(incoming.key)) return;
      pendingRequests.delete(incoming.key);
      settleAsReset(incoming.request);
      return;
    }
  };

  const onPageData = (envelope: unknown) => {
    const request = parseRequest(envelope);
    let pendingRequest: PendingRequest | undefined;
    if (request) {
      pendingRequest = {
        envelope,
        id: request.id,
        method: request.method,
        createdAt: Date.now(),
      };
      pendingRequests.set(request.key, pendingRequest);
    }

    if (pendingRequest && connectionReady)
      pendingRequest.forwardedGeneration = extensionGeneration;

    expireStalePending(Date.now());
    enforcePendingCap(
      request && pendingRequest
        ? { key: request.key, request: pendingRequest }
        : undefined,
    );
  };

  pageChannel.on("data", onPageData);
  pageChannel.resume();

  return {
    attachExtensionChannel(channel: Duplex) {
      detachExtensionChannel?.();
      extensionGeneration += 1;
      extensionChannel = channel;
      connectionReady = false;
      const responseFilter = new Transform({
        objectMode: true,
        transform(envelope: unknown, _encoding, callback) {
          if (Array.isArray(envelope)) {
            callback();
            return;
          }
          const key = responseKey(envelope);
          if (!key) {
            callback(null, envelope);
            return;
          }
          if (!pendingRequests.delete(key)) {
            callback();
            return;
          }
          callback(null, envelope);
        },
      });
      channel.pipe(responseFilter, { end: false });
      responseFilter.pipe(pageChannel, { end: false });

      const detach = () => {
        pageChannel.unpipe(channel);
        pageChannel.resume();
        channel.unpipe(responseFilter);
        responseFilter.unpipe(pageChannel);
        responseFilter.destroy();
        if (extensionChannel === channel) {
          extensionChannel = undefined;
          connectionReady = false;
        }
        if (detachExtensionChannel === detach)
          detachExtensionChannel = undefined;
      };
      detachExtensionChannel = detach;
      return detach;
    },
    markConnectionReady() {
      const connectedChannel = extensionChannel;
      if (!connectedChannel || connectedChannel.destroyed || connectionReady)
        return 0;
      connectionReady = true;
      pageChannel.pipe(connectedChannel, { end: false });
      let replayed = 0;
      for (const [key, pendingRequest] of [...pendingRequests]) {
        if (pendingRequest.forwardedGeneration === extensionGeneration)
          continue;
        if (
          pendingRequest.forwardedGeneration !== undefined &&
          !REPLAY_SAFE_METHODS.has(pendingRequest.method)
        ) {
          // The service worker already had this one and may have carried it
          // out while its answer was dropped on the closed port, so the page
          // gets a definite error and nothing runs a second time.
          pendingRequests.delete(key);
          settleAsReset(pendingRequest);
          continue;
        }
        pendingRequest.forwardedGeneration = extensionGeneration;
        connectedChannel.write(pendingRequest.envelope);
        replayed += 1;
      }
      return replayed;
    },
    destroy() {
      detachExtensionChannel?.();
      pageChannel.removeListener("data", onPageData);
      pendingRequests.clear();
    },
  };
};
