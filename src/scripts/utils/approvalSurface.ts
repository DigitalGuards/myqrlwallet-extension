import browser from "webextension-polyfill";
import StorageUtil from "@/utilities/storageUtil";

// Chrome lets the user dock ANY extension in the side panel manually,
// without the wallet's sidePanelPreferred setting ever being flipped. When a
// panel context is live, opening another surface would spawn a second,
// competing approval surface next to it; the storage subscription already
// surfaces the request in the open panel. runtime.getContexts needs Chrome
// 116+, so this is feature-detected and fails open to the popup path.
export const isSidePanelOpen = async (): Promise<boolean> => {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.getContexts) {
      return false;
    }
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
};

// If the action popup is already open, the request is surfaced there by the
// dAppRequestStore session-storage subscription; creating a notification
// window as well would give the user two competing approval surfaces.
const isActionPopupOpen = async (): Promise<boolean> => {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.getContexts) {
      return false;
    }
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.POPUP],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
};

// Bare index.html classifies as the popup surface (settingsStore reads the
// URL params), which gives the notification window the 600px height pin and
// DAppRequest's self-close-on-resolve behavior for free.
const WINDOW_WIDTH = 396; // 368px popup CSS width + window frame
const WINDOW_HEIGHT = 640; // 600px pinned content + titlebar

let approvalWindowId: number | undefined;

// The onRemoved listener body, exported so tests can simulate the user
// closing the notification window without reaching into the mock registry.
export const handleApprovalWindowRemoved = (windowId: number) => {
  if (windowId === approvalWindowId) {
    approvalWindowId = undefined;
  }
};

// Registered lazily on first use rather than at import time: the listener is
// only meaningful once a notification window can exist.
let windowTrackingRegistered = false;
const ensureWindowTracking = () => {
  if (windowTrackingRegistered) return;
  windowTrackingRegistered = true;
  browser.windows.onRemoved.addListener(handleApprovalWindowRemoved);
};

/**
 * Bring an approval surface to the user for a pending dApp request. Tries
 * the toolbar-anchored action popup first; when Chrome refuses openPopup()
 * (it fails silently on some setups), falls back to a MetaMask-style
 * standalone notification window near the top-right of the focused browser
 * window. Re-invocations focus the existing notification window instead of
 * stacking new ones. Never throws.
 */
export const openApprovalSurface = async (): Promise<void> => {
  ensureWindowTracking();
  const settings = await StorageUtil.getSettings();
  if (settings.sidePanelPreferred || (await isSidePanelOpen())) {
    // Side-panel mode: the badge + the panel's storage subscription surface
    // the request; opening a popup/window would compete with the panel.
    return;
  }

  if (approvalWindowId !== undefined) {
    try {
      await browser.windows.update(approvalWindowId, {
        focused: true,
        drawAttention: true,
      });
      return;
    } catch {
      approvalWindowId = undefined;
    }
  }

  try {
    await browser.action.openPopup();
    return;
  } catch {
    // Chrome refused the anchored popup; fall through to the window path.
  }

  if (await isActionPopupOpen()) {
    return;
  }

  try {
    const anchor = await browser.windows.getLastFocused().catch(() => undefined);
    const left =
      anchor?.left !== undefined && anchor?.width !== undefined
        ? Math.max(anchor.left + anchor.width - WINDOW_WIDTH - 16, 0)
        : undefined;
    const top = anchor?.top !== undefined ? anchor.top + 76 : undefined;
    const win = await browser.windows.create({
      url: browser.runtime.getURL("index.html"),
      type: "popup",
      focused: true,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      left,
      top,
    });
    approvalWindowId = win.id;
  } catch {
    console.warn("QrlWeb3Wallet: Could not open the wallet");
  }
};
