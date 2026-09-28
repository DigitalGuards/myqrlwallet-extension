import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the synchronous top-level `browser.alarms.onAlarm` listener in
 * serviceWorker.ts (F3): QRL_AUTO_LOCK must be dispatched from the listener
 * registered before the module's first `await`. A listener registered
 * later, inside prepareListeners() (which sits behind an `await` in
 * initializeServiceWorker()), can miss an alarm that fires while a cold
 * service worker is still starting up. QRL_KEEP_ALIVE is gone: keeping the
 * worker alive is now an in-worker setInterval started on unlock
 * (LockManager.startKeepAliveInterval).
 *
 * Everything downstream of module evaluation (provider engine wiring,
 * phishing detector, side panel behaviour) is stubbed out: this test's
 * scope is only the alarm dispatch, ahead of the rest of the service
 * worker's boot sequence.
 */

const { mockAddAlarmListener, mockHandleAutoLockAlarm } = vi.hoisted(() => ({
  mockAddAlarmListener: vi.fn(),
  mockHandleAutoLockAlarm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    alarms: {
      onAlarm: { addListener: mockAddAlarmListener },
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true),
    },
    storage: {
      onChanged: { addListener: vi.fn() },
      local: { get: vi.fn().mockResolvedValue({}) },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
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
  },
}));

vi.mock("./lockManager/lockManager", () => ({
  __esModule: true,
  default: {
    AUTO_LOCK_ALARM: "QRL_AUTO_LOCK",
    handleAutoLockAlarm: mockHandleAutoLockAlarm,
    lockManagerListener: vi.fn(),
    scrubLegacySessionSecrets: vi.fn().mockResolvedValue(undefined),
  },
  LOCK_MANAGER_MESSAGES: {
    PORT: "LOCK_MANGER_PORT",
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

vi.mock("./utils/sidePanelSurface", () => ({
  applyEarlySidePanelToolbarBehavior: vi.fn().mockResolvedValue(undefined),
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
  initializeContentScriptProviderConnection: vi
    .fn()
    .mockResolvedValue(undefined),
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getDAppsRequestData: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({}),
  },
}));

describe("serviceWorker alarm dispatch (F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const loadModuleAndGetListener = async () => {
    await import("./serviceWorker");
    expect(mockAddAlarmListener).toHaveBeenCalledTimes(1);
    return mockAddAlarmListener.mock.calls[0][0] as (alarm: {
      name: string;
    }) => void;
  };

  it("registers exactly one alarm listener for the module, at the top level (not inside prepareListeners)", async () => {
    // serviceWorker.ts registers this listener in its module body, before
    // initializeServiceWorker()'s first `await`. prepareListeners() (called
    // from inside that async function) used to register a second, competing
    // listener for the same alarms; asserting a single registration call
    // pins that it does not come back.
    await loadModuleAndGetListener();
  });

  it("dispatches QRL_AUTO_LOCK to LockManager.handleAutoLockAlarm", async () => {
    const listener = await loadModuleAndGetListener();

    listener({ name: "QRL_AUTO_LOCK" });

    expect(mockHandleAutoLockAlarm).toHaveBeenCalledTimes(1);
  });

  it("no longer registers or dispatches a QRL_KEEP_ALIVE alarm", async () => {
    const listener = await loadModuleAndGetListener();

    // Should be a plain no-op: nothing throws, nothing dispatches.
    expect(() => listener({ name: "QRL_KEEP_ALIVE" })).not.toThrow();
    expect(mockHandleAutoLockAlarm).not.toHaveBeenCalled();
  });

  it("ignores unrelated alarm names", async () => {
    const listener = await loadModuleAndGetListener();

    listener({ name: "SOME_OTHER_ALARM" });

    expect(mockHandleAutoLockAlarm).not.toHaveBeenCalled();
  });

  it("scrubs any legacy session-storage key backup and clears a leftover QRL_KEEP_ALIVE alarm on startup", async () => {
    const module = await import("./lockManager/lockManager");
    const lockManagerMock = module.default as unknown as {
      scrubLegacySessionSecrets: ReturnType<typeof vi.fn>;
    };
    const browserModule = await import("webextension-polyfill");
    const alarmsClear = (browserModule.default as any).alarms.clear;

    await import("./serviceWorker");
    // initializeServiceWorker() runs unawaited at module scope; give its
    // microtask chain a turn to reach the startup-hygiene step.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lockManagerMock.scrubLegacySessionSecrets).toHaveBeenCalled();
    expect(alarmsClear).toHaveBeenCalledWith("QRL_KEEP_ALIVE");
  });
});
