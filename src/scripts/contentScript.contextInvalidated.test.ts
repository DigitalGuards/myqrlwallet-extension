import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPort } from "@/test-utils/runtime";

/**
 * An extension update leaves the old content script running in every open
 * page with its extension context invalidated: the port disconnects and
 * runtime.connect throws. These tests load the real contentScript.ts with
 * its stream plumbing stubbed out and drive that sequence by hand.
 */

const {
  mockConnect,
  mockSendMessage,
  mockGetURL,
  runtime,
  disconnectPermanently,
} = vi.hoisted(() => {
  const connect = vi.fn();
  const sendMessage = vi.fn<(message: { name: string }) => Promise<void>>();
  const getURL = vi.fn();
  let runtimeId: string | undefined;
  return {
    mockConnect: connect,
    mockSendMessage: sendMessage,
    mockGetURL: getURL,
    disconnectPermanently: vi.fn(),
    // Chrome clears runtime.id once the extension context is invalidated.
    runtime: {
      get id() {
        return runtimeId;
      },
      set id(value: string | undefined) {
        runtimeId = value;
      },
      connect,
      sendMessage,
      getURL,
      onMessage: { addListener: vi.fn() },
      lastError: undefined,
    },
  };
});

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: { runtime },
}));

vi.mock("@theqrl/qrl-wallet-provider/object-multiplex", () => ({
  ObjectMultiplex: class {
    setMaxListeners() {}
    ignoreStream() {}
    createStream() {
      return { on: vi.fn(), removeAllListeners: vi.fn(), destroy: vi.fn() };
    }
    removeAllListeners() {}
    destroy() {}
  },
}));
vi.mock("@theqrl/qrl-wallet-provider/post-message-stream", () => ({
  WindowPostMessageStream: vi.fn(function () {}),
}));
vi.mock("extension-port-stream", () => ({
  ExtensionPortStream: vi.fn(function () {}),
}));
vi.mock("readable-stream", () => ({ pipeline: vi.fn() }));
vi.mock("./utils/providerConnectionLifecycle", () => ({
  createProviderChannelBridge: () => ({
    attachExtensionChannel: vi.fn(() => vi.fn()),
    markConnectionReady: vi.fn(),
    disconnectPermanently,
  }),
  createProviderStreamFailureGuard: () => ({
    markPortDisconnected: vi.fn(),
    handlePipelineClose: vi.fn(),
  }),
}));
vi.mock("./utils/sidePanelContentBridge", () => ({
  handleSidePanelOpenRequest: vi.fn(),
}));

import {
  QRL_POST_MESSAGE_STREAM,
  QRL_WALLET_PROVIDER_NAME,
} from "./constants/streamConstants";

type PortStub = ReturnType<typeof createPort>;

const openedPorts: PortStub[] = [];

const disconnectOf = (port: PortStub) => () => {
  port.onDisconnect.addListener.mock.calls[0][0](port);
};

const keepAliveCalls = () =>
  mockSendMessage.mock.calls.filter(
    ([message]) =>
      message.name === QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE,
  ).length;

describe("contentScript after the extension context is invalidated", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    openedPorts.length = 0;
    runtime.id = "mock-id";
    disconnectPermanently.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockConnect.mockReset().mockImplementation(() => {
      const port = createPort(QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT);
      openedPorts.push(port);
      return port;
    });
    mockSendMessage.mockReset().mockResolvedValue(undefined);
    mockGetURL
      .mockReset()
      .mockImplementation(
        (path: string) => `chrome-extension://mock-id/${path}`,
      );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const invalidateContext = (port: PortStub) => {
    runtime.id = undefined;
    mockConnect.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    port.error = { message: "Extension context invalidated." };
  };

  it("retires after an update: no throw, no reconnects, keep-alive and lifecycle listeners stop, waiting requests and the page are told", async () => {
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const postMessage = vi.spyOn(window, "postMessage");
    await import("./contentScript");
    expect(mockConnect).toHaveBeenCalledTimes(1);

    const port = openedPorts[0];
    invalidateContext(port);
    disconnectOf(port)();

    // The reconnect timer used to throw "Extension context invalidated." here.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(disconnectPermanently).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        target: QRL_POST_MESSAGE_STREAM.INPAGE,
        data: {
          name: QRL_WALLET_PROVIDER_NAME,
          data: { jsonrpc: "2.0", method: "QRL_WALLET_STREAM_FAILURE" },
        },
      },
      window.location.origin,
    );
    expect(removeWindowListener.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pagehide", "pageshow"]),
    );

    const keepAlivesAtRetirement = keepAliveCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(keepAliveCalls()).toBe(keepAlivesAtRetirement);
  });

  it("keeps running when connect throws while the extension context is still alive", async () => {
    await import("./contentScript");
    mockConnect.mockImplementation(() => {
      throw new Error("Unexpected connect failure");
    });
    disconnectOf(openedPorts[0])();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(disconnectPermanently).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Could not connect to the extension",
      expect.any(Error),
    );

    const keepAlives = keepAliveCalls();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(keepAliveCalls()).toBeGreaterThan(keepAlives);
  });

  it("keeps reconnecting after an ordinary disconnect while the context is valid", async () => {
    await import("./contentScript");
    disconnectOf(openedPorts[0])();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(openedPorts).toHaveLength(2);
  });
});
