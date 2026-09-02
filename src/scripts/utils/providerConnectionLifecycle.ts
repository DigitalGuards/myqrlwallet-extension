import { Transform, type Duplex } from "readable-stream";

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
  forwardedGeneration?: number;
};

const requestKey = (envelope: unknown) => {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    return undefined;
  const { id, method } = envelope as JsonRpcEnvelope;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof method !== "string"
  )
    return undefined;
  return `${typeof id}:${String(id)}`;
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

  const onPageData = (envelope: unknown) => {
    const key = requestKey(envelope);
    let pendingRequest: PendingRequest | undefined;
    if (key) {
      pendingRequest = { envelope };
      pendingRequests.set(key, pendingRequest);
    }

    if (pendingRequest && connectionReady)
      pendingRequest.forwardedGeneration = extensionGeneration;
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
      for (const pendingRequest of pendingRequests.values()) {
        if (pendingRequest.forwardedGeneration === extensionGeneration)
          continue;
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
