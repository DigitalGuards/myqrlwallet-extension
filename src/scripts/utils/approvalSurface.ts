import browser from "webextension-polyfill";
import { isRecord } from "@/utilities/storageGuards";
import StorageUtil from "@/utilities/storageUtil";
import { resolveSidePanelPreferred } from "./sidePanelPreference";
import { requestSidePanelOpen } from "./sidePanelSurface";

const extensionGlobals: {
  chrome?: { runtime?: Partial<(typeof globalThis)["chrome"]["runtime"]> };
} = globalThis;

// Resolves the window that hosts the requesting tab, or undefined when the
// tab or its window cannot be determined.
const resolveTabWindowId = async (
  tabId: number | undefined,
): Promise<number | undefined> => {
  if (tabId === undefined) return undefined;
  try {
    const tab = await browser.tabs.get(tabId);
    return typeof tab.windowId === "number" ? tab.windowId : undefined;
  } catch {
    return undefined;
  }
};

// Chrome lets the user dock ANY extension in the side panel manually,
// without the wallet's own surface preference ever being flipped. When a
// panel context is live in the window the user is looking at, opening
// another surface would spawn a second, competing approval surface next to
// it; the storage subscription already surfaces the request in the open
// panel. A panel that belongs to a different browser window does not help
// the requesting window, so when the requesting tab's window is known only
// a panel in that window counts. runtime.getContexts needs Chrome 116+, so
// this is feature-detected and fails open to the popup path.
export const isSidePanelOpen = async (tabId?: number): Promise<boolean> => {
  try {
    const runtime = extensionGlobals.chrome?.runtime;
    if (!runtime?.getContexts || !runtime.ContextType) {
      return false;
    }
    const contexts: unknown = await runtime.getContexts({
      contextTypes: [runtime.ContextType.SIDE_PANEL],
    });
    if (!Array.isArray(contexts) || contexts.length === 0) {
      return false;
    }
    const windowId = await resolveTabWindowId(tabId);
    if (windowId === undefined) {
      return true;
    }
    return contexts.some(
      (context: unknown) =>
        isRecord(context) &&
        (typeof context.windowId !== "number" || context.windowId === windowId),
    );
  } catch {
    return false;
  }
};

// Whether an action popup context exists. undefined when runtime.getContexts
// is unavailable or fails, so callers can keep their older behaviour.
const queryActionPopup = async (): Promise<boolean | undefined> => {
  try {
    const runtime = extensionGlobals.chrome?.runtime;
    if (!runtime?.getContexts || !runtime.ContextType) {
      return undefined;
    }
    const contexts: unknown = await runtime.getContexts({
      contextTypes: [runtime.ContextType.POPUP],
    });
    return Array.isArray(contexts) ? contexts.length > 0 : undefined;
  } catch {
    return undefined;
  }
};

// If the action popup is already open, the request is surfaced there by the
// dAppRequestStore session-storage subscription; creating a notification
// window as well would give the user two competing approval surfaces.
const isActionPopupOpen = async (): Promise<boolean> =>
  (await queryActionPopup()) === true;

const POPUP_CONFIRM_INTERVAL_MS = 100;
const POPUP_CONFIRM_TIMEOUT_MS = 1000;

// openPopup() can resolve without a popup appearing. Polls briefly for the
// popup context. Returns true when it appeared, or when contexts cannot be
// queried (the resolved promise is then all there is to go on).
const confirmActionPopup = async (): Promise<boolean> => {
  for (
    let waited = 0;
    waited <= POPUP_CONFIRM_TIMEOUT_MS;
    waited += POPUP_CONFIRM_INTERVAL_MS
  ) {
    const open = await queryActionPopup();
    if (open === undefined || open) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POPUP_CONFIRM_INTERVAL_MS);
    });
  }
  return false;
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

// Focuses the notification window when one is tracked. Returns false when
// there is none or Chrome no longer has it.
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

/**
 * Bring an approval surface to the user for a pending dApp request.
 *
 * Order of preference:
 *  1. A side panel that is already open in the requesting tab's window
 *     (any window when that cannot be resolved) shows the request through its
 *     storage subscription, so nothing else may open next to it.
 *  2. The side panel, when it is the preferred surface and the requesting
 *     tab can forward its user gesture.
 *  3. The toolbar-anchored action popup, confirmed by a popup context
 *     appearing shortly after openPopup() resolves.
 *  4. A standalone notification window near the top-right of the focused
 *     browser window, when Chrome refuses openPopup() (it fails silently on
 *     some setups). Re-invocations focus the one existing window, so
 *     windows never stack.
 *
 * The badge is set by the storage listener in the service worker either way.
 * Never throws.
 */
export const openApprovalSurface = async ({
  tabId,
}: { tabId?: number } = {}): Promise<void> => {
  ensureWindowTracking();
  const settings = await StorageUtil.getSettings();
  if (await isSidePanelOpen(tabId)) {
    // The panel's storage subscription surfaces the request; opening a
    // popup or window would compete with it.
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

  if (await focusTrackedWindow()) {
    return;
  }

  try {
    await browser.action.openPopup();
    if (await confirmActionPopup()) {
      return;
    }
    // openPopup() resolved but no popup appeared; use the window path.
  } catch {
    // Chrome refused the anchored popup; fall through to the window path.
  }

  if (await isActionPopupOpen()) {
    return;
  }
  if (await focusTrackedWindow()) {
    // A concurrent request created the window while this one waited.
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
