import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPort } from "@/test-utils/runtime";
import type { Runtime } from "webextension-polyfill";

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

let localStore: Record<string, unknown> = {};

const {
  mockScrubLegacySessionSecrets,
  mockInitializeContentScriptProviderConnection,
  mockOnConnectAddListener,
  mockGetRegisteredContentScripts,
  mockRegisterContentScripts,
} = vi.hoisted(() => ({
  mockScrubLegacySessionSecrets: vi.fn().mockResolvedValue(undefined),
  mockInitializeContentScriptProviderConnection: vi
    .fn<
      (
        port: Runtime.Port,
        setupConnection: (port: Runtime.Port) => Promise<void>,
        announceReady: () => Promise<void>,
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined),
  mockOnConnectAddListener:
    vi.fn<(listener: (port: Runtime.Port) => void) => void>(),
  mockGetRegisteredContentScripts: vi.fn().mockResolvedValue([]),
  mockRegisterContentScripts: vi.fn().mockResolvedValue(undefined),
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
      onConnect: { addListener: mockOnConnectAddListener },
      onInstalled: { addListener: vi.fn() },
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
      id: "mock-id",
    },
    scripting: {
      getRegisteredContentScripts: mockGetRegisteredContentScripts,
      registerContentScripts: mockRegisterContentScripts,
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
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
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
  const port = createPort("myqrlwallet-content-script", {
    url: "https://dapp.example",
  });
  for (const [listener] of mockOnConnectAddListener.mock.calls) {
    listener(port);
  }
  await vi.waitFor(() => {
    expect(mockInitializeContentScriptProviderConnection).toHaveBeenCalled();
  });
  return port;
}

describe("serviceWorker startup resilience (H1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    localStore = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a throwing storage call in one startup step still resolves readiness and a provider connection gets answered", async () => {
    mockScrubLegacySessionSecrets.mockRejectedValueOnce(
      new Error("storage exploded"),
    );

    await import("./serviceWorker");
    await connectContentScriptAndWait();

    expect(mockInitializeContentScriptProviderConnection).toHaveBeenCalled();
  });

  it("a content-script port that disconnects while waiting for readiness is not wired up", async () => {
    await import("./serviceWorker");
    const mockPort = createPort("myqrlwallet-content-script");

    for (const [listener] of mockOnConnectAddListener.mock.calls)
      listener(mockPort);
    // The tab closes before the worker finishes starting up.
    for (const [listener] of mockPort.onDisconnect.addListener.mock.calls)
      listener(mockPort);
    await vi.waitFor(() => {
      expect(mockRegisterContentScripts).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      mockInitializeContentScriptProviderConnection,
    ).not.toHaveBeenCalled();
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

  it("reports a rejected provider connection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("connection failed");
    mockInitializeContentScriptProviderConnection.mockRejectedValueOnce(error);
    await import("./serviceWorker");

    await connectContentScriptAndWait();

    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Failed to initialize the provider connection",
      error,
    );
  });

  it("rejects a content-script port with no sender before setting up its streams", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInitializeContentScriptProviderConnection.mockImplementationOnce(
      async (port, setup) => {
        await setup(port);
      },
    );
    await import("./serviceWorker");
    const port = createPort("myqrlwallet-content-script");

    for (const [listener] of mockOnConnectAddListener.mock.calls)
      listener(port);
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        "QrlWeb3Wallet: Failed to initialize the provider connection",
        new Error("Content-script port is missing its sender"),
      );
    });

    expect(port.postMessage).not.toHaveBeenCalled();
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("cleans up middleware when a connected port closes", async () => {
    await import("./serviceWorker");
    const middlewareModule =
      await import("./middlewares/appendSenderDataMiddleware");
    const appendSenderData = middlewareModule.appendSenderDataMiddleware;
    const cleanup = vi.fn<() => void>();
    vi.spyOn(
      middlewareModule,
      "appendSenderDataMiddleware",
    ).mockImplementationOnce((params) => {
      const middleware = appendSenderData(params);
      middleware.destroy = cleanup;
      return middleware;
    });
    mockInitializeContentScriptProviderConnection.mockImplementationOnce(
      async (port, setup, announce) => {
        await setup(port);
        await announce();
      },
    );

    const port = await connectContentScriptAndWait();
    expect(port.postMessage).toHaveBeenCalledWith({
      name: "QRL_WALLET_CONNECTION_READY",
    });
    for (const [listener] of port.onDisconnect.addListener.mock.calls)
      listener(port);

    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  it("pins native session storage access before the legacy scrub", async () => {
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);
    const session = { setAccessLevel };
    vi.stubGlobal("chrome", { storage: { session } });

    await import("./serviceWorker");
    await vi.waitFor(() => {
      expect(mockScrubLegacySessionSecrets).toHaveBeenCalled();
    });

    expect(setAccessLevel).toHaveBeenCalledExactlyOnceWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(setAccessLevel.mock.contexts[0]).toBe(session);
    expect(setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(
      mockScrubLegacySessionSecrets.mock.invocationCallOrder[0],
    );
  });

  it("continues startup if the native session access setter rejects", async () => {
    const setAccessLevel = vi
      .fn()
      .mockRejectedValue(new Error("access level unavailable"));
    vi.stubGlobal("chrome", { storage: { session: { setAccessLevel } } });

    await import("./serviceWorker");
    await connectContentScriptAndWait();

    expect(setAccessLevel).toHaveBeenCalledExactlyOnceWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(mockScrubLegacySessionSecrets).toHaveBeenCalled();
  });

  it("registers the in-page script in MAIN with its original options", async () => {
    await import("./serviceWorker");
    await vi.waitFor(() => {
      expect(mockRegisterContentScripts).toHaveBeenCalledExactlyOnceWith([
        {
          id: "qrlInPageScript",
          matches: ["<all_urls>"],
          js: ["src/scripts/inPageScript.js"],
          runAt: "document_start",
          allFrames: true,
          world: "MAIN",
        },
      ]);
    });
  });

  it("keeps existing content scripts registered", async () => {
    mockGetRegisteredContentScripts.mockResolvedValueOnce([
      { id: "qrlInPageScript" },
      { id: "other" },
    ]);
    await import("./serviceWorker");
    await vi.waitFor(() => {
      expect(mockRegisterContentScripts).toHaveBeenCalledExactlyOnceWith([]);
    });
  });
});
