import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the real-device fix for a side-panel "Unchecked runtime.lastError:
 * Could not establish connection. Receiving end does not exist." console
 * error: initializeServiceWorker() used to register runtime.onMessage,
 * runtime.onConnect, storage.onChanged, and runtime.onInstalled listeners
 * only AFTER its first `await` (applyEarlySidePanelToolbarBehavior()). A
 * message or port connect that woke a dormant worker in that window (the
 * lockStore keep-alive port, the activity ping, IS_LOCKED, ENCRYPT_ACCOUNT,
 * a dApp's content-script connection) found zero listeners attached and was
 * silently dropped, surfacing to the caller as exactly that error.
 *
 * These tests hold `applyEarlySidePanelToolbarBehavior()` (and therefore
 * the whole rest of initializeServiceWorker()'s async chain) on a promise
 * that never resolves, to prove listener registration does not depend on
 * that chain completing - or even progressing past its first `await` - at
 * all.
 */

const {
  mockOnMessageAddListener,
  mockOnConnectAddListener,
  mockLockManagerListener,
  mockInitializeContentScriptProviderConnection,
} = vi.hoisted(() => ({
  mockOnMessageAddListener: vi.fn(),
  mockOnConnectAddListener: vi.fn(),
  mockLockManagerListener: vi.fn().mockResolvedValue({ success: true }),
  mockInitializeContentScriptProviderConnection: vi
    .fn()
    .mockResolvedValue(undefined),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    alarms: {
      onAlarm: { addListener: vi.fn() },
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true),
    },
    storage: {
      onChanged: { addListener: vi.fn() },
      local: { get: vi.fn().mockResolvedValue({}) },
    },
    runtime: {
      onMessage: { addListener: mockOnMessageAddListener },
      onConnect: { addListener: mockOnConnectAddListener },
      onInstalled: { addListener: vi.fn() },
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
      id: "mock-id",
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    sidePanel: {
      setOptions: vi.fn().mockResolvedValue(undefined),
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    notifications: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("./lockManager/lockManager", () => ({
  __esModule: true,
  default: {
    AUTO_LOCK_ALARM: "QRL_AUTO_LOCK",
    handleAutoLockAlarm: vi.fn().mockResolvedValue(undefined),
    lockManagerListener: mockLockManagerListener,
    scrubLegacySessionSecrets: vi.fn().mockResolvedValue(undefined),
  },
  LOCK_MANAGER_MESSAGES: {
    PORT: "LOCK_MANGER_PORT",
    IS_LOCK_MANAGER_READY: "IS_LOCK_MANAGER_READY",
    SEND_TX_NOTIFICATION: "SEND_TX_NOTIFICATION",
  },
}));

vi.mock("./phishing/phishingDetector", () => ({
  PHISHING_ALARM_NAME: "QRL_PHISHING_REFRESH",
  handlePhishingRefreshAlarm: vi.fn().mockResolvedValue(undefined),
  initializePhishingDetector: vi.fn().mockResolvedValue(undefined),
  setupPhishingRefreshAlarm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./utils/dAppTransactionWatcher", () => ({
  DAPP_TX_WATCH_ALARM_NAME: "QRL_DAPP_TX_WATCH",
  handleDAppTransactionWatchAlarm: vi.fn().mockResolvedValue(undefined),
}));

// The crux of the test: this never resolves, holding
// initializeServiceWorker() at its very first `await` forever.
vi.mock("./utils/sidePanelSurface", () => ({
  applyEarlySidePanelToolbarBehavior: vi.fn(() => new Promise(() => {})),
  applySidePanelToolbarBehavior: vi.fn().mockResolvedValue(undefined),
  handleSidePanelInstalled: vi.fn().mockResolvedValue(undefined),
  registerSidePanelOpenListener: vi.fn(),
}));

vi.mock("./utils/dAppAccountNotifications", () => ({
  notifyDAppAccountsChanged: vi.fn(),
  registerDAppAccountNotificationStream: vi.fn(() => () => {}),
  resolveTrustedSenderOrigin: vi.fn(),
}));

vi.mock("./utils/providerConnectionLifecycle", () => ({
  initializeContentScriptProviderConnection:
    mockInitializeContentScriptProviderConnection,
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getDAppsRequestData: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({}),
  },
}));

describe("serviceWorker listener registration survives a stuck async init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers runtime.onMessage and runtime.onConnect listeners synchronously, even though initializeServiceWorker() never gets past its first await", async () => {
    await import("./serviceWorker");

    // Two onMessage listeners (lockManagerListener, SEND_TX_NOTIFICATION)
    // and two onConnect listeners (content script, lock manager port).
    expect(mockOnMessageAddListener).toHaveBeenCalledTimes(2);
    expect(mockOnConnectAddListener).toHaveBeenCalledTimes(2);
  });

  it("a message dispatched before init resolves is still handled by lockManagerListener", async () => {
    await import("./serviceWorker");
    const listener = mockOnMessageAddListener.mock.calls.find(
      (call: any) => call[0] === mockLockManagerListener,
    )?.[0];

    expect(listener).toBe(mockLockManagerListener);
    // Directly exercising the registered function, matching how the real
    // onMessage event would invoke it.
    await expect(
      listener({ name: "LOCK_MANAGER_IS_LOCKED" }, { id: "mock-id" }),
    ).resolves.toEqual({ success: true });
  });

  it("the LOCK_MANAGER_PORT connect is answered even before init resolves", async () => {
    await import("./serviceWorker");
    const connectListeners = mockOnConnectAddListener.mock.calls.map(
      (call: any) => call[0],
    );

    const postMessage = vi.fn();
    for (const listener of connectListeners) {
      listener({ name: "LOCK_MANGER_PORT", postMessage });
    }

    expect(postMessage).toHaveBeenCalledWith({
      name: "IS_LOCK_MANAGER_READY",
    });
  });

  it("the content-script connection is captured immediately but defers its real work until init resolves", async () => {
    await import("./serviceWorker");
    const connectListeners = mockOnConnectAddListener.mock.calls.map(
      (call: any) => call[0],
    );

    const disconnectListeners: Array<() => void> = [];
    const mockPort = {
      name: "myqrlwallet-content-script",
      onDisconnect: {
        addListener: (cb: () => void) => disconnectListeners.push(cb),
      },
    };
    for (const listener of connectListeners) {
      listener(mockPort);
    }

    // The disconnect handler is attached at once, before init resolves, so
    // a tab that closes or enters the back/forward cache in that window
    // still has its runtime.lastError read.
    expect(disconnectListeners).toHaveLength(1);
    expect(() => disconnectListeners[0]()).not.toThrow();

    // The event was accepted: the listener ran, and is now awaiting
    // serviceWorkerReady internally. Since initializeServiceWorker() never
    // resolves in this test, the actual provider wiring must not have run
    // yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      mockInitializeContentScriptProviderConnection,
    ).not.toHaveBeenCalled();
  });
});
