import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chrome closes a page's extension ports when the page enters the
 * back/forward cache and reports the close only to the service worker, so
 * the content script has to treat the restore itself as the disconnect.
 * These tests load the real contentScript.ts with its stream plumbing
 * stubbed out, capture the listeners it registers and drive them by hand.
 *
 * The events are supplied as plain objects because jsdom defines isTrusted
 * as a non-configurable accessor, so a dispatched event can never claim to
 * come from the browser. e2e/bfcacheProvider.spec.ts covers the real
 * wiring with an actual back/forward-cache round trip.
 */

const {
  mockConnect,
  mockSendMessage,
  mockGetURL,
  mockOnMessageAddListener,
  markConnectionReady,
  attachExtensionChannel,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetURL: vi.fn(),
  mockOnMessageAddListener: vi.fn(),
  markConnectionReady: vi.fn(),
  attachExtensionChannel: vi.fn(() => vi.fn()),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    runtime: {
      connect: mockConnect,
      sendMessage: mockSendMessage,
      getURL: mockGetURL,
      onMessage: { addListener: mockOnMessageAddListener },
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
    attachExtensionChannel,
    markConnectionReady,
  }),
  createProviderStreamFailureGuard: () => ({
    markPortDisconnected: vi.fn(),
    handlePipelineClose: vi.fn(),
  }),
}));
vi.mock("./utils/sidePanelContentBridge", () => ({
  handleSidePanelOpenRequest: vi.fn(),
}));

import { EXTENSION_MESSAGES } from "./constants/streamConstants";

type PortStub = {
  onMessage: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
  onDisconnect: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
  disconnect: ReturnType<typeof vi.fn>;
};

type RestoreSignal = { isTrusted: boolean; persisted?: boolean };

const openedPorts: PortStub[] = [];
const restoreListeners: Array<(event: RestoreSignal) => void> = [];
const resumeListeners: Array<(event: RestoreSignal) => void> = [];

const loadContentScript = async () => {
  const onWindow = vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListener,
  ) => {
    if (type === "pageshow")
      restoreListeners.push(listener as unknown as (e: RestoreSignal) => void);
  }) as typeof window.addEventListener);
  const onDocument = vi
    .spyOn(document, "addEventListener")
    .mockImplementation(((type: string, listener: EventListener) => {
      if (type === "resume")
        resumeListeners.push(listener as unknown as (e: RestoreSignal) => void);
    }) as typeof document.addEventListener);
  try {
    await import("./contentScript");
  } finally {
    onWindow.mockRestore();
    onDocument.mockRestore();
  }
};

const firePageShow = (event: RestoreSignal) =>
  restoreListeners.forEach((listener) => listener(event));
const fireResume = (event: RestoreSignal) =>
  resumeListeners.forEach((listener) => listener(event));

const lastPort = () => openedPorts[openedPorts.length - 1];

const retiredDisconnectOf = (port: PortStub) =>
  port.onDisconnect.addListener.mock.calls[0][0] as () => void;

describe("contentScript back/forward-cache restore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    openedPorts.length = 0;
    restoreListeners.length = 0;
    resumeListeners.length = 0;
    attachExtensionChannel.mockClear().mockImplementation(() => vi.fn());
    markConnectionReady.mockClear();
    mockOnMessageAddListener.mockReset();
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
      .mockImplementation(
        (path: string) => `chrome-extension://mock-id/${path}`,
      );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("registers for both restore signals", async () => {
    await loadContentScript();

    expect(restoreListeners).toHaveLength(1);
    expect(resumeListeners).toHaveLength(1);
  });

  it("ignores a pageshow the page dispatched itself", async () => {
    await loadContentScript();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      firePageShow({ isTrusted: false, persisted: true });
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("ignores a resume the page dispatched itself", async () => {
    await loadContentScript();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      fireResume({ isTrusted: false });
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("ignores a pageshow that is not a restore", async () => {
    await loadContentScript();

    firePageShow({ isTrusted: true, persisted: false });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("rebuilds once for a real restore and rate-limits a burst", async () => {
    await loadContentScript();
    const firstPort = lastPort();

    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(firstPort.disconnect).toHaveBeenCalledTimes(1);

    // The pair of events one genuine restore fires, then a burst: neither
    // opens another port inside the rate-limit window.
    fireResume({ isTrusted: true });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      firePageShow({ isTrusted: true, persisted: true });
    }
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600);
    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it("rebuilds on a resume from a frozen or discarded tab", async () => {
    await loadContentScript();

    fireResume({ isTrusted: true });

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("ignores a late disconnect for the port the restore retired", async () => {
    await loadContentScript();
    const retiredDisconnect = retiredDisconnectOf(lastPort());

    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);

    // Chrome delivering the bfcache disconnect after the restore must not
    // tear down the connection that replaced it, nor schedule another.
    retiredDisconnect();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("drops a reconnect timer left over from the retired generation", async () => {
    await loadContentScript();
    const retiredDisconnect = retiredDisconnectOf(lastPort());

    // A disconnect arrives first and schedules the 1 s reconnect, then the
    // restore rebuilds ahead of it.
    retiredDisconnect();
    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("leaves the ready broadcast alone once the restore has rebuilt", async () => {
    await loadContentScript();
    const onRuntimeMessage = mockOnMessageAddListener.mock
      .calls[0][0] as (message: { name: string }) => Promise<string>;

    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);

    // The worker announces itself to every tab after it starts; the tab that
    // already rebuilt has a live stream and must keep it.
    await expect(
      onRuntimeMessage({ name: EXTENSION_MESSAGES.READY }),
    ).resolves.toContain("ready message");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("lets the ready broadcast reconnect a tab with no stream", async () => {
    await loadContentScript();
    const retiredDisconnect = retiredDisconnectOf(lastPort());
    const onRuntimeMessage = mockOnMessageAddListener.mock
      .calls[0][0] as (message: { name: string }) => Promise<string>;

    retiredDisconnect();
    await onRuntimeMessage({ name: EXTENSION_MESSAGES.READY });

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });
});
