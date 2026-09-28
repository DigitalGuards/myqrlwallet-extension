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
const listenersByType = new Map<
  string,
  Array<(event: RestoreSignal) => void>
>();

const captureListener = (type: string, listener: EventListener) => {
  const listeners = listenersByType.get(type) ?? [];
  listeners.push(listener as unknown as (event: RestoreSignal) => void);
  listenersByType.set(type, listeners);
};

const loadContentScript = async () => {
  const onWindow = vi
    .spyOn(window, "addEventListener")
    .mockImplementation(
      captureListener as unknown as typeof window.addEventListener,
    );
  const onDocument = vi
    .spyOn(document, "addEventListener")
    .mockImplementation(
      captureListener as unknown as typeof document.addEventListener,
    );
  try {
    await import("./contentScript");
  } finally {
    onWindow.mockRestore();
    onDocument.mockRestore();
  }
};

const fire = (type: string, event: RestoreSignal) =>
  (listenersByType.get(type) ?? []).forEach((listener) => listener(event));

const firePageShow = (event: RestoreSignal) => fire("pageshow", event);
const fireResume = (event: RestoreSignal) => fire("resume", event);
const firePageHide = (event: RestoreSignal) => fire("pagehide", event);
const fireFreeze = (event: RestoreSignal) => fire("freeze", event);

/** One genuine back/forward-cache round trip, as the browser fires it. */
const fireCacheRoundTrip = () => {
  firePageHide({ isTrusted: true, persisted: true });
  fireResume({ isTrusted: true });
  firePageShow({ isTrusted: true, persisted: true });
};

const lastPort = () => openedPorts[openedPorts.length - 1];

const retiredDisconnectOf = (port: PortStub) =>
  port.onDisconnect.addListener.mock.calls[0][0] as () => void;

describe("contentScript back/forward-cache restore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    openedPorts.length = 0;
    listenersByType.clear();
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

  it("registers for both cache-entry and both restore signals", async () => {
    await loadContentScript();

    expect(listenersByType.get("pagehide")).toHaveLength(1);
    expect(listenersByType.get("freeze")).toHaveLength(1);
    expect(listenersByType.get("pageshow")).toHaveLength(1);
    expect(listenersByType.get("resume")).toHaveLength(1);
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

  it("rebuilds once for the pair of events one restore fires", async () => {
    await loadContentScript();
    const firstPort = lastPort();

    fireCacheRoundTrip();

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(firstPort.disconnect).toHaveBeenCalledTimes(1);
  });

  it("rebuilds for each of two restores milliseconds apart", async () => {
    await loadContentScript();

    // Back, Forward, Back on one tab: the same page is cached and restored
    // twice about 20 ms apart. The second cache entry closes the port the
    // first restore opened, so skipping the second rebuild would leave the
    // page on a dead port with no disconnect ever delivered.
    fireCacheRoundTrip();
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20);
    fireCacheRoundTrip();

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(openedPorts[1].disconnect).toHaveBeenCalledTimes(1);
  });

  it("rate-limits a restore signal with no cache entry behind it", async () => {
    await loadContentScript();

    // Nothing recorded a cache entry, so only the backstop applies.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      firePageShow({ isTrusted: true, persisted: true });
    }
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600);
    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it("ignores a cache entry the page dispatched itself", async () => {
    await loadContentScript();

    // An untrusted pagehide must not arm a rebuild that an untrusted
    // pageshow can then spend.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      firePageHide({ isTrusted: false, persisted: true });
      firePageShow({ isTrusted: false, persisted: true });
    }
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // An untrusted cache entry must not arm a rebuild for a later trusted
    // signal either: that one still answers to the backstop alone.
    firePageHide({ isTrusted: false, persisted: true });
    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);
    firePageShow({ isTrusted: true, persisted: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after a freeze and resume with no navigation", async () => {
    await loadContentScript();

    fireFreeze({ isTrusted: true });
    fireResume({ isTrusted: true });

    expect(mockConnect).toHaveBeenCalledTimes(2);
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
