import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers H1 (PR #71 audit): serviceWorkerReady used to only resolve on
 * initializeServiceWorker()'s success path, so an unguarded throw in any
 * startup step (a storage call, an invalid cached phishing blocklist
 * reaching createDetector) left the promise unsettled forever, and every
 * content-script connection awaiting it (see establishContenScriptConnection
 * in serviceWorker.ts) hung with no answer.
 *
 * Each test here breaks one startup step in a way that used to throw, then
 * confirms readiness still resolves and a provider connection still gets
 * processed.
 */

const localStore: Record<string, unknown> = {};

const {
  mockScrubLegacySessionSecrets,
  mockInitializeContentScriptProviderConnection,
} = vi.hoisted(() => ({
  mockScrubLegacySessionSecrets: vi.fn().mockResolvedValue(undefined),
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
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
      },
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
    lockManagerListener: vi.fn().mockResolvedValue({ success: true }),
    scrubLegacySessionSecrets: mockScrubLegacySessionSecrets,
  },
  LOCK_MANAGER_MESSAGES: {
    PORT: "LOCK_MANGER_PORT",
    IS_LOCK_MANAGER_READY: "IS_LOCK_MANAGER_READY",
    SEND_TX_NOTIFICATION: "SEND_TX_NOTIFICATION",
  },
}));

// The phishing detector module is left unmocked here: the "malformed
// cached blocklist" test needs its actual validation/fallback logic to
// run.
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

/** Drives a content-script connection through the real onConnect listener
 * and waits long enough for a resolved serviceWorkerReady to unblock it. */
async function connectContentScriptAndWait() {
  const browserModule = await import("webextension-polyfill");
  const onConnectAddListener = (browserModule.default as any).runtime.onConnect
    .addListener as ReturnType<typeof vi.fn>;
  const connectListeners = onConnectAddListener.mock.calls.map(
    (call: any) => call[0],
  );
  const mockPort = {
    name: "myqrlwallet-content-script",
    onDisconnect: { addListener: vi.fn() },
  };
  for (const listener of connectListeners) {
    await listener(mockPort);
  }
}

describe("serviceWorker startup resilience (H1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    for (const key of Object.keys(localStore)) delete localStore[key];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a throwing storage call in one startup step still resolves readiness and a provider connection gets answered", async () => {
    mockScrubLegacySessionSecrets.mockRejectedValueOnce(
      new Error("storage exploded"),
    );

    await import("./serviceWorker");
    await connectContentScriptAndWait();

    expect(mockInitializeContentScriptProviderConnection).toHaveBeenCalled();
  });

  it("a malformed cached phishing blocklist still resolves readiness and a provider connection gets answered", async () => {
    // Shape createDetector cannot use: blacklist is not an array. Without
    // H1's validation this reaches PhishingDetector's constructor; with it,
    // getCachedConfig() discards the entry before it ever gets there.
    localStore.PHISHING_BLOCKLIST_CACHE = {
      config: { blacklist: "not-an-array" },
      timestamp: Date.now(),
    };

    await import("./serviceWorker");
    await connectContentScriptAndWait();

    expect(mockInitializeContentScriptProviderConnection).toHaveBeenCalled();
  });
});
