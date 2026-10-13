import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMessageListener } from "@/test-utils/runtime";
import type { TransactionNotificationData } from "./utils/transactionNotification";

/**
 * Security review finding L8: the SEND_TX_NOTIFICATION runtime.onMessage
 * listener accepted any sender, so a content script on any page could raise
 * an OS "Transaction Confirmed" notification for a transaction that never
 * happened. The dApp transaction watcher calls showTransactionNotification
 * directly inside the worker, so only extension pages have a reason to send
 * this message at all.
 *
 * The listener must also stay synchronous: returning a promise from
 * onMessage claims the message channel and stops lockManagerListener from
 * answering.
 */

const { mockShowTransactionNotification } = vi.hoisted(() => ({
  mockShowTransactionNotification: vi
    .fn<(data: TransactionNotificationData) => Promise<void>>()
    .mockResolvedValue(undefined),
}));

vi.mock("./utils/transactionNotification", () => ({
  showTransactionNotification: mockShowTransactionNotification,
}));

const {
  mockOnMessageAddListener,
  mockOnConnectAddListener,
  mockLockManagerListener,
  mockInitializeContentScriptProviderConnection,
} = vi.hoisted(() => ({
  mockOnMessageAddListener: vi.fn<(listener: RuntimeMessageListener) => void>(),
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

describe("SEND_TX_NOTIFICATION sender trust", () => {
  const loadNotificationListener = async () => {
    await import("./serviceWorker");
    expect(mockOnMessageAddListener).toHaveBeenCalledTimes(2);
    return mockOnMessageAddListener.mock.calls[1][0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("raises a notification for a message from an extension page", async () => {
    const listener = await loadNotificationListener();

    listener(
      { name: "SEND_TX_NOTIFICATION", data: { transactionHash: "0xabc" } },
      { id: "mock-id", url: "chrome-extension://mock-id/index.html?tab=true" },
    );

    expect(mockShowTransactionNotification).toHaveBeenCalledWith({
      transactionHash: "0xabc",
    });
  });

  it.each([
    [
      "a content script reporting the page origin",
      { id: "mock-id", url: "https://evil.example/app" },
    ],
    [
      "another extension",
      { id: "other-id", url: "chrome-extension://other-id/index.html" },
    ],
    ["a sender with no url", { id: "mock-id" }],
    ["no sender at all", undefined],
  ])("ignores a SEND_TX_NOTIFICATION from %s", async (_label, sender) => {
    const listener = await loadNotificationListener();

    listener(
      { name: "SEND_TX_NOTIFICATION", data: { transactionHash: "0xabc" } },
      sender,
    );

    expect(mockShowTransactionNotification).not.toHaveBeenCalled();
  });

  it("ignores an unrelated message from a trusted extension page", async () => {
    const listener = await loadNotificationListener();

    listener(
      { name: "LOCK_MANAGER_IS_LOCKED" },
      { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
    );

    expect(mockShowTransactionNotification).not.toHaveBeenCalled();
  });

  it("never claims the message channel, whoever the sender is", async () => {
    const listener = await loadNotificationListener();

    expect(
      listener(
        { name: "SEND_TX_NOTIFICATION", data: {} },
        { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
      ),
    ).toBeUndefined();
    expect(
      listener(
        { name: "SEND_TX_NOTIFICATION", data: {} },
        {
          id: "mock-id",
          url: "https://evil.example/app",
        },
      ),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    false,
    42,
    "SEND_TX_NOTIFICATION",
    [],
    {},
    { name: 1 },
    { name: "SEND_TX_NOTIFICATION", data: false },
    { name: "SEND_TX_NOTIFICATION", data: 42 },
    { name: "SEND_TX_NOTIFICATION", data: "invalid" },
    { name: "SEND_TX_NOTIFICATION", data: [] },
    { name: "SEND_TX_NOTIFICATION", data: { status: 1 } },
    { name: "SEND_TX_NOTIFICATION", data: { amount: {} } },
    { name: "SEND_TX_NOTIFICATION", data: { amount: null } },
    { name: "SEND_TX_NOTIFICATION", data: { tokenSymbol: false } },
    { name: "SEND_TX_NOTIFICATION", data: { txHash: [] } },
  ])("ignores malformed notification input %j", async (message) => {
    const listener = await loadNotificationListener();

    expect(
      listener(message, {
        id: "mock-id",
        url: "chrome-extension://mock-id/index.html",
      }),
    ).toBeUndefined();

    expect(mockShowTransactionNotification).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    {},
    {
      status: "confirmed",
      amount: "1",
      tokenSymbol: "QRL",
      txHash: "0xabc",
      extra: "preserved",
    },
    { status: "failed", amount: 0 },
  ])("preserves accepted notification data %j", async (data) => {
    const listener = await loadNotificationListener();

    expect(
      listener(
        { name: "SEND_TX_NOTIFICATION", data },
        { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
      ),
    ).toBeUndefined();

    expect(mockShowTransactionNotification).toHaveBeenCalledExactlyOnceWith(
      data ?? {},
    );
    if (data !== null && data !== undefined)
      expect(mockShowTransactionNotification.mock.calls[0][0]).toBe(data);
  });

  it("reports a notification rejection while leaving the message channel available", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("settings unavailable");
    mockShowTransactionNotification.mockRejectedValueOnce(error);
    const listener = await loadNotificationListener();

    expect(
      listener(
        { name: "SEND_TX_NOTIFICATION", data: {} },
        { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
      ),
    ).toBeUndefined();
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Failed to create notification:",
      error,
    );
  });
});
