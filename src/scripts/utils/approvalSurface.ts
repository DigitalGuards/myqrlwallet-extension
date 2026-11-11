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
// behind another window: another wallet's confirmation window lands right on
// top of the panel. Only a window that is not the focused one needs the
// wallet's own approval window in front. The requesting tab's window is never
// focused from here: a page can send a request at any moment without a
// gesture, and focusing its window would hand it the keys the user is typing
// into the window in front. When the lookups fail the panel keeps the request
// alone.
const isRequestingWindowBehind = async (
  tabId: number | undefined,
): Promise<boolean> => {
  try {
    const windowId = await getTabWindowId(tabId);
    if (windowId === undefined) return false;
    const current = await browser.windows.getLastFocused();
    return !(current.focused && current.id === windowId);
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

// Registered lazily on first use: the listener is
// only meaningful once a notification window can exist.
let windowTrackingRegistered = false;
const ensureWindowTracking = () => {
  if (windowTrackingRegistered) return;
  windowTrackingRegistered = true;
  browser.windows.onRemoved.addListener(handleApprovalWindowRemoved);
};

// Focusing the wallet's own approval window is allowed: it is the surface the
// user answers in. Resolves true when the tracked window took the focus.
const focusTrackedWindow = async (): Promise<boolean> => {
  if (approvalWindowId === undefined) return false;
  try {
    await browser.windows.update(approvalWindowId, {
      focused: true,
      drawAttention: true,
    });
    return true;
  } catch {
    approvalWindowId = undefined;
    return false;
  }
};

const openApprovalWindow = async (): Promise<void> => {
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

/**
 * Bring an approval surface to the user for a pending dApp request.
 *
 * Order of preference:
 *  1. A side panel that is already open shows the request through its
 *     storage subscription, so nothing else may open next to it. When its
 *     browser window is not the one in front, the standalone window opens
 *     as well.
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
    // The panel's storage subscription surfaces the request. Behind another
    // window it is out of sight, so the wallet's own window comes forward
    // as well; either surface resolves the request and the other clears.
    if (
      (await isRequestingWindowBehind(tabId)) &&
      !(await focusTrackedWindow())
    ) {
      await openApprovalWindow();
    }
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

  if (await focusTrackedWindow()) return;

  try {
    await browser.action.openPopup();
    return;
  } catch {
    // Chrome refused the anchored popup; fall through to the window path.
  }

  if (await isActionPopupOpen()) {
    return;
  }

  await openApprovalWindow();
};
