import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An extension update leaves the old content script running in every open
 * page with its extension context invalidated: the port disconnects and
 * runtime.connect throws. These tests load the real contentScript.ts with
 * its stream plumbing stubbed out and drive that sequence by hand.
 */

const { mockConnect, mockSendMessage, mockGetURL } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetURL: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    runtime: {
      connect: mockConnect,
      sendMessage: mockSendMessage,
      getURL: mockGetURL,
      onMessage: { addListener: vi.fn() },
      lastError: undefined,
    },
  },
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
  });

  it("stops reconnecting and stops the keep-alive instead of throwing from the retry timer", async () => {
    await import("./contentScript");
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // The update invalidates the context: the port drops and connect throws.
    mockConnect.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    const port = openedPorts[0];
    port.error = { message: "Extension context invalidated." };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    disconnectOf(port)();

    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    expect(mockConnect).toHaveBeenCalledTimes(2);

    const keepAlivesAtRetirement = keepAliveCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(keepAliveCalls()).toBe(keepAlivesAtRetirement);
  });

  it("keeps reconnecting after an ordinary disconnect while the context is valid", async () => {
    await import("./contentScript");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    disconnectOf(openedPorts[0])();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(openedPorts).toHaveLength(2);
  });
});
