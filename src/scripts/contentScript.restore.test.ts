import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPort, type RuntimeMessageListener } from "@/test-utils/runtime";
import { malformed } from "@/test-utils/malformed";

/**
 * Chrome closes a page's extension ports when the page enters the
 * back/forward cache and reports the close only to the service worker, so
 * the content script has to treat the restore itself as the disconnect.
 * These tests load the real contentScript.ts with its stream plumbing
 * stubbed out, capture the listeners it registers and drive them by hand.
 *
 * Event proxies supply isTrusted because jsdom defines it as a
 * non-configurable accessor. e2e/bfcacheProvider.spec.ts covers the real
 * wiring with an actual back/forward-cache round trip.
 */

const {
  mockConnect,
  mockSendMessage,
  mockGetURL,
  mockOnMessageAddListener,
  markConnectionReady,
  attachExtensionChannel,
  mockHandleSidePanelOpenRequest,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetURL: vi.fn(),
  mockOnMessageAddListener: vi.fn<(listener: RuntimeMessageListener) => void>(),
  markConnectionReady: vi.fn(),
  attachExtensionChannel: vi.fn(() => vi.fn()),
  mockHandleSidePanelOpenRequest: vi.fn(),
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
  WindowPostMessageStream: vi.fn(function () {}),
}));
vi.mock("extension-port-stream", () => ({
  ExtensionPortStream: vi.fn(function () {}),
}));
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
  handleSidePanelOpenRequest: mockHandleSidePanelOpenRequest,
}));

import { EXTENSION_MESSAGES } from "./constants/streamConstants";

type PortStub = ReturnType<typeof createPort>;

type RestoreSignal = { isTrusted: boolean; persisted?: boolean };

const openedPorts: PortStub[] = [];
const listenersByType = new Map<string, EventListenerOrEventListenerObject[]>();

const captureListener = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
) => {
  if (listener === null) return;
  const listeners = listenersByType.get(type) ?? [];
  listeners.push(listener);
  listenersByType.set(type, listeners);
};

const loadContentScript = async () => {
  const onWindow = vi
    .spyOn(window, "addEventListener")
    .mockImplementation(captureListener);
  const onDocument = vi
    .spyOn(document, "addEventListener")
    .mockImplementation(captureListener);
  try {
    await import("./contentScript");
  } finally {
    onWindow.mockRestore();
    onDocument.mockRestore();
  }
};

const fire = (type: string, signal: RestoreSignal) => {
  const event = new Proxy(new Event(type), {
    get(target, property): unknown {
      if (property === "isTrusted") return signal.isTrusted;
      return Reflect.get(target, property);
    },
  });
  if ("persisted" in signal) {
    Object.defineProperty(event, "persisted", { value: signal.persisted });
  }
  for (const listener of listenersByType.get(type) ?? []) {
    if (typeof listener === "function") listener(event);
    else listener.handleEvent(event);
  }
};

const firePageShow = (event: RestoreSignal) => {
  fire("pageshow", event);
};
const fireResume = (event: RestoreSignal) => {
  fire("resume", event);
};
const firePageHide = (event: RestoreSignal) => {
  fire("pagehide", event);
};
const fireFreeze = (event: RestoreSignal) => {
  fire("freeze", event);
};

/** One genuine back/forward-cache round trip, as the browser fires it. */
const fireCacheRoundTrip = () => {
  firePageHide({ isTrusted: true, persisted: true });
  fireResume({ isTrusted: true });
  firePageShow({ isTrusted: true, persisted: true });
};

const lastPort = () => openedPorts[openedPorts.length - 1];

const retiredDisconnectOf = (port: PortStub) => {
  const listener = port.onDisconnect.addListener.mock.calls[0][0];
  return () => {
    listener(port);
  };
};

describe("contentScript back/forward-cache restore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    openedPorts.length = 0;
    listenersByType.clear();
    attachExtensionChannel.mockClear().mockImplementation(() => vi.fn());
    markConnectionReady.mockClear();
    mockOnMessageAddListener.mockReset();
    mockHandleSidePanelOpenRequest.mockReset();
    mockConnect.mockReset().mockImplementation(() => {
      const port = createPort("myqrlwallet-content-script");
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
    const onRuntimeMessage = mockOnMessageAddListener.mock.calls[0][0];

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
    const onRuntimeMessage = mockOnMessageAddListener.mock.calls[0][0];

    retiredDisconnect();
    await onRuntimeMessage({ name: EXTENSION_MESSAGES.READY });

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, false, 42, "ready", [], {}, { name: 1 }])(
    "ignores malformed port and runtime messages %j",
    async (message) => {
      await loadContentScript();
      const port = lastPort();
      const onPortMessage = port.onMessage.addListener.mock.calls[0][0];
      const onRuntimeMessage = mockOnMessageAddListener.mock.calls[0][0];

      expect(() => {
        onPortMessage(message, port);
      }).not.toThrow();
      await expect(onRuntimeMessage(message)).resolves.toBe("");

      expect(markConnectionReady).not.toHaveBeenCalled();
      expect(mockHandleSidePanelOpenRequest).not.toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    },
  );

  it("marks only the current port ready", async () => {
    await loadContentScript();
    const oldPort = lastPort();
    const onOldPortMessage = oldPort.onMessage.addListener.mock.calls[0][0];
    fireCacheRoundTrip();
    const port = lastPort();

    onOldPortMessage({ name: EXTENSION_MESSAGES.CONNECTION_READY }, oldPort);
    expect(markConnectionReady).not.toHaveBeenCalled();
    port.onMessage.addListener.mock.calls[0][0](
      { name: EXTENSION_MESSAGES.CONNECTION_READY },
      port,
    );
    expect(markConnectionReady).toHaveBeenCalledTimes(1);
  });

  it("forwards a side-panel request synchronously and resolves the same reply", async () => {
    await loadContentScript();
    const onRuntimeMessage = mockOnMessageAddListener.mock.calls[0][0];
    const message = {
      name: EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL,
      nonce: "gesture",
    };
    const sender = { id: "mock-id" };

    const reply = onRuntimeMessage(message, sender);

    expect(mockHandleSidePanelOpenRequest).toHaveBeenCalledExactlyOnceWith(
      message,
      sender,
    );
    await expect(reply).resolves.toBe("");
  });

  it("keeps side-panel handler errors as rejected replies", async () => {
    await loadContentScript();
    const onRuntimeMessage = mockOnMessageAddListener.mock.calls[0][0];
    const error = new Error("context invalidated");
    mockHandleSidePanelOpenRequest.mockImplementationOnce(() => {
      throw error;
    });

    await expect(
      onRuntimeMessage({ name: EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL }),
    ).rejects.toBe(error);
  });

  it("ignores a non-boolean persisted flag", async () => {
    await loadContentScript();

    firePageShow(
      malformed<RestoreSignal>({ isTrusted: true, persisted: "true" }),
    );

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
