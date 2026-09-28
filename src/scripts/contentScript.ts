import {
  ObjectMultiplex,
  Substream,
} from "@theqrl/qrl-wallet-provider/object-multiplex";
import { WindowPostMessageStream } from "@theqrl/qrl-wallet-provider/post-message-stream";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { ExtensionPortStream } from "extension-port-stream";
import { pipeline } from "readable-stream";
import browser from "webextension-polyfill";
import {
  EXTENSION_MESSAGES,
  QRL_POST_MESSAGE_STREAM,
  QRL_WALLET_PROVIDER_NAME,
} from "./constants/streamConstants";
import {
  createProviderChannelBridge,
  createProviderStreamFailureGuard,
} from "./utils/providerConnectionLifecycle";
import { startContentScriptKeepAlive } from "./utils/contentScriptKeepAlive";
import { checkForLastError } from "./utils/scriptUtils";
import { handleSidePanelOpenRequest } from "./utils/sidePanelContentBridge";

// NOTE: this script deliberately performs NO RPC. Content-script fetches
// run under the hosting page's CORS (Chrome 85+), so any network call
// made here inherits the dApp page's Origin and fails against endpoints
// that don't allowlist it. All provider RPC executes in the service
// worker (see scripts/utils/unrestrictedMethodExecutor.ts); this file
// only bridges the inpage <-> extension streams.

type MessageType = {
  name: string;
  data?: JsonRpcRequest<JsonRpcRequest>;
};

let pageMux: ObjectMultiplex;
let pageChannel: Substream;

let extensionPort: browser.Runtime.Port;
let extensionStream: ExtensionPortStream | null;
let extensionMux: ObjectMultiplex;
let extensionChannel: Substream;
let providerChannelBridge: ReturnType<typeof createProviderChannelBridge>;
let disconnectProviderChannel: (() => void) | undefined;
let detachExtensionPortListeners: (() => void) | undefined;
let extensionConnectionGeneration = 0;
let lastStreamRebuildAt = 0;
let restorePending = false;

/**
 * Backstop for a trusted restore signal that arrives with no cache entry
 * recorded for it, which is the only case the restorePending flag cannot
 * pair up. It must never be the primary guard: Back, Forward, Back on one
 * tab restores the same page twice about 20 ms apart, and a human
 * double-click on Back is 100 to 300 ms, so a wall-clock window wide enough
 * to be useful would drop a genuine restore and leave the page on a port
 * the second cache entry already closed.
 */
const MIN_STREAM_REBUILD_INTERVAL_MS = 500;

const setupPageStreams = () => {
  // the transport-specific streams for communication between inpage and background
  const pageStream = new WindowPostMessageStream({
    name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT,
    target: QRL_POST_MESSAGE_STREAM.INPAGE,
  });

  // create and connect channel muxers
  // so we can handle the channels individually
  pageMux = new ObjectMultiplex();
  pageMux.setMaxListeners(25);

  pipeline(pageMux, pageStream, pageMux, (err: Error | null) => {
    console.warn("QrlWeb3Wallet: Inpage Multiplex", err);
  });

  pageChannel = pageMux.createStream(QRL_WALLET_PROVIDER_NAME);
  providerChannelBridge = createProviderChannelBridge(pageChannel);
};

/** Destroys all of the extension streams */
const destroyExtensionStreams = () => {
  disconnectProviderChannel?.();
  disconnectProviderChannel = undefined;

  detachExtensionPortListeners?.();
  detachExtensionPortListeners = undefined;

  extensionMux.removeAllListeners();
  extensionMux.destroy();

  extensionChannel.removeAllListeners();
  extensionChannel.destroy();

  extensionStream = null;
};

/**
 * Chrome closes every extension port held by a page the moment that page
 * enters the back/forward cache, and it reports the close to the service
 * worker alone: "The page keeping the extension port is moved into
 * back/forward cache, so the message channel is closed." The page side is
 * frozen when that happens and is never handed the matching onDisconnect,
 * not even once the page is restored. Without the signal this script keeps
 * believing its port is live and writes dApp traffic into a channel the
 * browser already tore down, so after a back/forward restore every request
 * hangs forever and accountsChanged/chainChanged stop arriving.
 *
 * A restore is therefore the only notice the page gets, so treat it as the
 * disconnect that already happened and rebuild the extension streams. The
 * provider bridge replays whatever is still pending onto the new
 * connection, so a request left in flight at cache entry settles as well.
 * Nothing here touches the page streams or the in-page provider, so the
 * provider is neither re-announced nor re-initialized.
 */
const resetExtensionStreamsAfterPageRestore = () => {
  lastStreamRebuildAt = Date.now();
  restorePending = false;

  if (extensionStream) destroyExtensionStreams();

  try {
    extensionPort.disconnect();
  } catch {
    // The browser closed this port at cache entry; nothing left to close.
  }

  // Bumping the generation inside setupExtensionStreams turns a late
  // onDisconnect for the retired port into a no-op, so a browser that
  // does deliver it cannot open a second connection on top of this one.
  setupExtensionStreams();
};

/**
 * Only the browser can fire any of these events for real, so an untrusted
 * one is a page calling dispatchEvent to make this script open runtime
 * ports on demand, which would hold the service worker awake for a locked
 * wallet and re-run the pending-request replay.
 */
const isBrowserCacheSignal = (event: Event) =>
  event.isTrusted &&
  // pagehide and pageshow carry persisted; freeze and resume do not.
  (!("persisted" in event) || (event as PageTransitionEvent).persisted);

/**
 * Records that this page is going into the back/forward cache, or is being
 * frozen, which is the moment the browser closes its extension ports.
 */
const onPageCacheEntry = (event: Event) => {
  if (!isBrowserCacheSignal(event)) return;
  restorePending = true;
};

/**
 * Acts on the signals a restored page gets: pageshow with persisted set
 * (back/forward cache) and the Page Lifecycle resume event, which also
 * covers a tab thawed after Chrome froze it under Memory Saver.
 *
 * A recorded cache entry is what pairs a rebuild with the restore it
 * belongs to. One restore fires two of these events and consumes the single
 * flag, so the second is ignored with no time window involved, and two
 * genuine restores milliseconds apart each have their own cache entry and
 * each rebuild.
 */
const onPageRestoreSignal = (event: Event) => {
  if (!isBrowserCacheSignal(event)) return;
  if (
    !restorePending &&
    Date.now() - lastStreamRebuildAt < MIN_STREAM_REBUILD_INTERVAL_MS
  )
    return;
  resetExtensionStreamsAfterPageRestore();
};

/**
 * This listener destroys the extension streams when the extension port is disconnected,
 * so that streams may be re-established later when the extension port is reconnected.
 */
const onDisconnectExtensionStream = (
  disconnectedPort: browser.Runtime.Port,
  generation: number,
  listener: () => void,
  messageListener: (message: MessageType) => void,
  disconnectError: unknown,
) => {
  disconnectedPort.onDisconnect.removeListener(listener);
  disconnectedPort.onMessage.removeListener(messageListener);
  if (generation !== extensionConnectionGeneration) return;

  destroyExtensionStreams();

  /**
   * If an error is found, reset the streams. When running two or more dapps, resetting the service
   * worker may cause the error, "Error: Could not establish connection. Receiving end does not
   * exist.", due to a race-condition. The disconnect event may be called by runtime.connect which
   * may cause issues. We suspect that this is a chromium bug as this event should only be called
   * once the port and connections are ready. Delay time is arbitrary.
   */
  if (disconnectError) {
    console.warn(`${JSON.stringify(disconnectError)}\nResetting the streams.`);
  }
  setTimeout(() => {
    if (generation === extensionConnectionGeneration && !extensionStream) {
      setupExtensionStreams();
    }
  }, 1000);
};

/**
 * This function must ONLY be called in pipeline destruction/close callbacks.
 * Notifies the inpage context that streams have failed, via window.postMessage.
 * Relies on 'object-multiplex' and 'post-message-stream' implementation details.
 */
function notifyInpageOfStreamFailure() {
  window.postMessage(
    {
      target: QRL_POST_MESSAGE_STREAM.INPAGE, // the post-message-stream "target"
      data: {
        // this object gets passed to `object-multiplex`
        name: QRL_WALLET_PROVIDER_NAME, // the `object-multiplex` channel name
        data: {
          jsonrpc: "2.0",
          method: "QRL_WALLET_STREAM_FAILURE",
        },
      },
    },
    window.location.origin,
  );
}

const setupExtensionStreams = () => {
  const generation = ++extensionConnectionGeneration;
  extensionPort = browser.runtime.connect({
    name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT,
  });
  const connectedPort = extensionPort;
  const streamFailureGuard = createProviderStreamFailureGuard(
    generation,
    () => extensionConnectionGeneration,
    notifyInpageOfStreamFailure,
  );
  const onPortMessage = (message: MessageType) => {
    if (
      generation === extensionConnectionGeneration &&
      message.name === EXTENSION_MESSAGES.CONNECTION_READY
    ) {
      providerChannelBridge.markConnectionReady();
    }
  };
  const onDisconnect = () => {
    const disconnectError = connectedPort.error ?? checkForLastError();
    streamFailureGuard.markPortDisconnected();
    onDisconnectExtensionStream(
      connectedPort,
      generation,
      onDisconnect,
      onPortMessage,
      disconnectError,
    );
  };
  connectedPort.onMessage.addListener(onPortMessage);
  connectedPort.onDisconnect.addListener(onDisconnect);
  detachExtensionPortListeners = () => {
    connectedPort.onMessage.removeListener(onPortMessage);
    connectedPort.onDisconnect.removeListener(onDisconnect);
  };
  extensionStream = new ExtensionPortStream(connectedPort);

  // create and connect channel muxers
  // so we can handle the channels individually
  extensionMux = new ObjectMultiplex();
  extensionMux.setMaxListeners(25);
  extensionMux.ignoreStream(EXTENSION_MESSAGES.CONNECTION_READY);

  pipeline(extensionMux, extensionStream, extensionMux, (err: Error | null) => {
    console.warn("QrlWeb3Wallet: Background Multiplex", err);
    streamFailureGuard.handlePipelineClose();
  });

  // forward communication across inpage-background for these channels only
  extensionChannel = extensionMux.createStream(QRL_WALLET_PROVIDER_NAME);
  extensionChannel.on("error", (error: Error) =>
    console.warn(
      `QrlWeb3Wallet: Muxed traffic for channel "${QRL_WALLET_PROVIDER_NAME}" failed.`,
      error,
    ),
  );
  disconnectProviderChannel =
    providerChannelBridge.attachExtensionChannel(extensionChannel);
};

const prepareListeners = () => {
  // listens to messages coming from the service worker(browser.tabs.sendMessage)
  browser.runtime.onMessage.addListener(
    async (message: MessageType, sender) => {
      if (message.name === EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL) {
        handleSidePanelOpenRequest(message, sender);
        return "";
      }
      if (message.name === EXTENSION_MESSAGES.READY) {
        if (!extensionStream) {
          setupExtensionStreams();
        }
        return "QrlWeb3Wallet: handled service worker ready message";
      }
      return "";
    },
  );
};

const initializeContentScript = () => {
  // Content scripts match <all_urls>, which (for content scripts
  // specifically) includes the chrome-extension: scheme - so this file
  // also runs on the wallet's own popup/side panel/tab pages. Those pages
  // never read window.qrlProvider and have no dApp to bridge to, so the
  // whole provider-bridge setup below - including startContentScriptKeepAlive()'s
  // unconditional interval and this file's own reconnect-on-disconnect
  // logic - would otherwise resurrect the service worker purely to serve a
  // page that never needed it (real-device regression, PR #71 audit): once
  // listeners register synchronously at SW startup (F4), those reconnect
  // attempts stopped being dropped-and-retried and started succeeding on
  // the first try, keeping a locked wallet's worker running indefinitely.
  if (window.location.href.startsWith(browser.runtime.getURL(""))) {
    return;
  }
  try {
    setupPageStreams();
    setupExtensionStreams();
    prepareListeners();
    window.addEventListener("pagehide", onPageCacheEntry);
    document.addEventListener("freeze", onPageCacheEntry);
    window.addEventListener("pageshow", onPageRestoreSignal);
    document.addEventListener("resume", onPageRestoreSignal);
    startContentScriptKeepAlive();
  } catch (error) {
    console.warn(
      "QrlWeb3Wallet: Failed to initialize the content script\n",
      error,
    );
  }
};

initializeContentScript();
