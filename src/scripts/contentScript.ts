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
import { checkForLastError } from "./utils/scriptUtils";

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
let extensionConnectionGeneration = 0;

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

  extensionMux.removeAllListeners();
  extensionMux.destroy();

  extensionChannel.removeAllListeners();
  extensionChannel.destroy();

  extensionStream = null;
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
  browser.runtime.onMessage.addListener(async (message: MessageType) => {
    if (message.name === EXTENSION_MESSAGES.READY) {
      if (!extensionStream) {
        setupExtensionStreams();
      }
      return "QrlWeb3Wallet: handled service worker ready message";
    }
    return "";
  });
};

const keepServiceWorkerActive = () => {
  setInterval(() => {
    browser.runtime
      .connect({
        name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE,
      })
      .postMessage(QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE);
  }, 3000);
};

const initializeContentScript = () => {
  try {
    setupPageStreams();
    setupExtensionStreams();
    prepareListeners();
    keepServiceWorkerActive();
  } catch (error) {
    console.warn(
      "QrlWeb3Wallet: Failed to initialize the content script\n",
      error,
    );
  }
};

initializeContentScript();
