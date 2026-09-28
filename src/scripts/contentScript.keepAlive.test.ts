import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The content script used to open a new runtime port on every keep-alive
 * tick and never close it. These tests load the real contentScript.ts with
 * its stream plumbing stubbed out and count what it asks the runtime for.
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

describe("contentScript keep-alive", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockConnect.mockReset().mockImplementation(() => ({
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      postMessage: vi.fn(),
    }));
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
  });

  it("on a web page opens only the provider port and keeps the worker alive with messages", async () => {
    await import("./contentScript");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith({
      name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT,
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(10);
    expect(mockSendMessage).toHaveBeenCalledWith({
      name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE,
    });
  });

  it("on the extension's own pages does nothing at all", async () => {
    mockGetURL.mockImplementation(
      (path: string) => `${window.location.origin}/${path}`,
    );

    await import("./contentScript");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
