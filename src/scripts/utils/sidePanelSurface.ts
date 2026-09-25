import StorageUtil from "@/utilities/storageUtil";
import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  isSidePanelSupported,
  resolveSidePanelPreferred,
  SIDE_PANEL_PATH,
} from "./sidePanelPreference";

// How long the service worker waits for a tab to forward the user gesture
// before giving up and using the popup / notification-window path. Chrome
// only honours sidePanel.open() while the gesture is still fresh, so a long
// wait would fail anyway.
export const SIDE_PANEL_ROUNDTRIP_TIMEOUT_MS = 500;

type MaybeRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is MaybeRecord =>
  typeof value === "object" && value !== null;

const hasPanelBehaviorApi = (): boolean =>
  isSidePanelSupported() &&
  typeof chrome.sidePanel?.setPanelBehavior === "function";

/**
 * Runs before the rest of service-worker startup so the FIRST toolbar click
 * after a cold start lands on the right surface. Two things make this
 * necessary: a fresh profile falls back to the manifest `default_popup`
 * until the behaviour is set, and Chrome persists the last behaviour across
 * sessions, so a user who switched to the popup would otherwise get the
 * panel until the reconcile pass below lands.
 *
 * Deliberately no setOptions() call: the path is pinned by the reconcile
 * pass, and this one stays down to a single storage read.
 */
export const applyEarlySidePanelToolbarBehavior = async (): Promise<void> => {
  if (!hasPanelBehaviorApi()) {
    return;
  }
  try {
    const settings = await StorageUtil.getSettings();
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: resolveSidePanelPreferred(settings),
    });
  } catch {
    // Non-fatal: the reconcile pass applies the persisted preference.
  }
};

/**
 * Authoritative pass: re-applies the persisted preference and pins the panel
 * path. Runs once service-worker initialisation is done.
 */
export const applySidePanelToolbarBehavior = async (): Promise<void> => {
  if (!hasPanelBehaviorApi()) {
    return;
  }
  try {
    const settings = await StorageUtil.getSettings();
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: resolveSidePanelPreferred(settings),
    });
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH });
  } catch {
    // sidePanel API may not be available in all browsers.
  }
};

/**
 * Arms the one-time "we moved to the side panel" notice for installs that
 * existed before this version. A fresh install never sees it, and neither
 * does anyone who already made an explicit surface choice.
 */
export const handleSidePanelInstalled = async (
  reason: string,
): Promise<void> => {
  if (reason !== "update") {
    return;
  }
  const settings = await StorageUtil.getSettings();
  if (settings.sidePanelSurface !== undefined || settings.sidePanelNoticeSeen) {
    return;
  }
  await StorageUtil.setSettings({ ...settings, sidePanelNoticePending: true });
};

type PendingOpen = {
  // The tab the request was sent to. The answering content script must be in
  // that same tab, so a compromised frame elsewhere cannot spend the nonce.
  tabId: number;
  resolve: (opened: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingOpens = new Map<string, PendingOpen>();

const mintNonce = (): string => {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const settlePending = (nonce: string, opened: boolean) => {
  const entry = pendingOpens.get(nonce);
  if (!entry) {
    return;
  }
  clearTimeout(entry.timer);
  pendingOpens.delete(nonce);
  entry.resolve(opened);
};

/**
 * Service-worker half of the gesture roundtrip. Returns true when the
 * message was one of ours and has been consumed, so the caller knows not to
 * treat it as anything else. Never returns a value to the messaging layer:
 * claiming the channel would starve the lock-manager listener.
 */
export const handleSidePanelOpenMessage = (
  message: unknown,
  sender: browser.Runtime.MessageSender,
): boolean => {
  if (!isRecord(message) || message.name !== EXTENSION_MESSAGES.OPEN_SIDE_PANEL)
    return false;

  const { nonce } = message;
  if (typeof nonce !== "string") {
    return false;
  }
  // Only this extension's own content script, running in a real tab, may
  // spend a nonce. Extension pages (sender.tab undefined) and anything with
  // a foreign sender.id are rejected before the nonce is looked up.
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return false;
  }
  const entry = pendingOpens.get(nonce);
  if (!entry || entry.tabId !== tabId) {
    return false;
  }
  clearTimeout(entry.timer);
  pendingOpens.delete(nonce);

  if (!isSidePanelSupported()) {
    entry.resolve(false);
    return true;
  }

  // open() must be called synchronously here: it consumes the user gesture
  // the content script just forwarded, and awaiting anything first spends it.
  chrome.sidePanel
    .open({ tabId })
    .then(() => entry.resolve(true))
    .catch(() => entry.resolve(false));
  return true;
};

let openListenerRegistered = false;

export const registerSidePanelOpenListener = (): void => {
  if (openListenerRegistered) {
    return;
  }
  openListenerRegistered = true;
  browser.runtime.onMessage.addListener((message, sender) => {
    handleSidePanelOpenMessage(message, sender);
  });
};

/**
 * Asks the requesting tab to forward its user gesture, then opens the side
 * panel for that tab. Resolves false on any failure or after the roundtrip
 * timeout so the caller can fall back to the popup surface.
 */
export const requestSidePanelOpen = async (tabId: number): Promise<boolean> => {
  if (!isSidePanelSupported()) {
    return false;
  }
  registerSidePanelOpenListener();

  const nonce = mintNonce();
  const opened = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingOpens.delete(nonce);
      resolve(false);
    }, SIDE_PANEL_ROUNDTRIP_TIMEOUT_MS);
    pendingOpens.set(nonce, { tabId, resolve, timer });
  });

  browser.tabs
    .sendMessage(tabId, {
      name: EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL,
      nonce,
    })
    .catch(() => {
      // No content script in that tab; fail fast so the popup path runs.
      settlePending(nonce, false);
    });

  return opened;
};

// Test seam: the pending map is module state that outlives a single case.
export const resetSidePanelOpenerForTests = (): void => {
  for (const [nonce] of pendingOpens) {
    settlePending(nonce, false);
  }
  openListenerRegistered = false;
};
