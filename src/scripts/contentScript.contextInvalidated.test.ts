import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An extension update leaves the old content script running in every open
 * page with its extension context invalidated: the port disconnects and
 * runtime.connect throws. These tests load the real contentScript.ts with
 * its stream plumbing stubbed out and drive that sequence by hand.
 */

const { mockConnect, mockSendMessage, mockGetURL, runtime, disconnectPermanently } =
  vi.hoisted(() => {
    const connect = vi.fn();
    const sendMessage = vi.fn();
    const getURL = vi.fn();
    return {
      mockConnect: connect,
      mockSendMessage: sendMessage,
      mockGetURL: getURL,
      disconnectPermanently: vi.fn(),
      // Chrome clears runtime.id once the extension context is invalidated.
      runtime: {
        id: undefined as string | undefined,
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
  WindowPostMessageStream: class {},
}));
vi.mock("extension-port-stream", () => ({ ExtensionPortStream: class {} }));
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

import { QRL_POST_MESSAGE_STREAM } from "./constants/streamConstants";

const streamFailureNotices = (postMessage: { mock: { calls: unknown[][] } }) =>
  postMessage.mock.calls.filter(
    ([message]: unknown[]) =>
      (message as { data?: { data?: { method?: string } } })?.data?.data
        ?.method === "QRL_WALLET_STREAM_FAILURE",
  ).length;

type PortStub = {
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  disconnect: ReturnType<typeof vi.fn>;
  error?: { message: string };
};

const openedPorts: PortStub[] = [];

const disconnectOf = (port: PortStub) =>
  port.onDisconnect.addListener.mock.calls[0][0] as () => void;

const keepAliveCalls = () =>
  mockSendMessage.mock.calls.filter(
    ([message]) => message?.name === QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE,
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
      const port: PortStub = {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      };
      openedPorts.push(port);
      return port;
    });
    mockSendMessage.mockReset().mockResolvedValue(undefined);
    mockGetURL
      .mockReset()
      .mockImplementation((path: string) => `chrome-extension://mock-id/${path}`);
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
    expect(streamFailureNotices(postMessage)).toBe(1);
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
