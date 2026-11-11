import browser from "webextension-polyfill";
import StorageUtil from "@/utilities/storageUtil";
import { resolveSidePanelPreferred } from "./sidePanelPreference";
import { requestSidePanelOpen } from "./sidePanelSurface";

const extensionGlobals: {
  chrome?: { runtime?: Partial<(typeof globalThis)["chrome"]["runtime"]> };
} = globalThis;

// Chrome lets the user dock ANY extension in the side panel manually,
// without the wallet's own surface preference ever being flipped. When a
// panel context is live, opening another surface would spawn a second,
// competing approval surface next to it; the storage subscription already
// surfaces the request in the open panel. runtime.getContexts needs Chrome
// 116+, so this is feature-detected and fails open to the popup path.
export const isSidePanelOpen = async (): Promise<boolean> => {
  try {
    const runtime = extensionGlobals.chrome?.runtime;
    if (!runtime?.getContexts || !runtime.ContextType) {
      return false;
    }
    const contexts: unknown = await runtime.getContexts({
      contextTypes: [runtime.ContextType.SIDE_PANEL],
    });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
};

// If the action popup is already open, the request is surfaced there by the
// dAppRequestStore session-storage subscription; creating a notification
// window as well would give the user two competing approval surfaces.
const isActionPopupOpen = async (): Promise<boolean> => {
  try {
    const runtime = extensionGlobals.chrome?.runtime;
    if (!runtime?.getContexts || !runtime.ContextType) {
      return false;
    }
    const contexts: unknown = await runtime.getContexts({
      contextTypes: [runtime.ContextType.POPUP],
    });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
};

const getTabWindowId = async (
  tabId: number | undefined,
): Promise<number | undefined> => {
  if (tabId === undefined) return undefined;
  try {
    const tab = await browser.tabs.get(tabId);
    return tab.windowId;
  } catch {
    return undefined;
  }
};

// An open side panel shows the request, but its browser window can sit
// behind another wallet's confirmation window, which lands right on top of
// the panel. Only then is the requesting tab's window brought forward: a
// focused popup-type window cannot host the panel itself. In every other
// case (another browser window, another application) the window only asks
// for attention, because the panel may be open somewhere else and the user
// chose where to work. Never while the action popup is open: activating its
// window closes the popup, and a closed popup rejects the request it shows.
const revealRequestingWindow = async (
  tabId: number | undefined,
): Promise<void> => {
  try {
    const windowId = await getTabWindowId(tabId);
    if (windowId === undefined || (await isActionPopupOpen())) return;
    const current = await browser.windows.getLastFocused();
    if (current.focused && current.id === windowId) return;
    await browser.windows.update(
      windowId,
      current.focused && current.type === "popup"
        ? { focused: true }
        : { drawAttention: true },
    );
  } catch {
    // Best effort: the panel still shows the request.
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

// Registered lazily on first use: the listener is
// only meaningful once a notification window can exist.
let windowTrackingRegistered = false;
const ensureWindowTracking = () => {
  if (windowTrackingRegistered) return;
  windowTrackingRegistered = true;
  browser.windows.onRemoved.addListener(handleApprovalWindowRemoved);
};

/**
 * Bring an approval surface to the user for a pending dApp request.
 *
 * Order of preference:
 *  1. A side panel that is already open shows the request through its
 *     storage subscription, so nothing else may open next to it.
 *  2. The side panel, when it is the preferred surface and the requesting
 *     tab can forward its user gesture.
 *  3. The toolbar-anchored action popup.
 *  4. A standalone notification window near the top-right of the focused
 *     browser window, when Chrome refuses openPopup() (it does while a
 *     window without a toolbar has focus, and fails silently on some
 *     setups). Re-invocations focus the one existing window, so windows
 *     never stack.
 *
 * The badge is set by the storage listener in the service worker either way.
 * Never throws.
 */
export const openApprovalSurface = async ({
  tabId,
}: { tabId?: number } = {}): Promise<void> => {
  ensureWindowTracking();
  const settings = await StorageUtil.getSettings();
  if (await isSidePanelOpen()) {
    // The panel's storage subscription surfaces the request; opening a
    // popup or window would compete with it.
    await revealRequestingWindow(tabId);
    return;
  }

  if (resolveSidePanelPreferred(settings) && tabId !== undefined) {
    if (await requestSidePanelOpen(tabId)) {
      return;
    }
    // The gesture roundtrip failed or timed out (no content script, a
    // background tab, a stale gesture). Fall through to the popup path so
    // the request still reaches the user.
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
    const anchor = await browser.windows
      .getLastFocused()
      .catch(() => undefined);
    const left =
      anchor?.left !== undefined && anchor.width !== undefined
        ? Math.max(anchor.left + anchor.width - WINDOW_WIDTH - 16, 0)
        : undefined;
    const top = anchor?.top !== undefined ? anchor.top + 76 : undefined;
    const options = {
      url: browser.runtime.getURL("index.html"),
      type: "popup",
      focused: true,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    } as const;
    let win: browser.Windows.Window;
    try {
      win = await browser.windows.create({ ...options, left, top });
    } catch {
      // Chrome rejects a position that is not mostly on a visible screen;
      // let it place the window.
      win = await browser.windows.create(options);
    }
    approvalWindowId = win.id;
  } catch (error) {
    console.warn("QrlWeb3Wallet: Could not open the wallet", error);
  }
};
