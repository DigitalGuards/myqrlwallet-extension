import StorageUtil from "@/utilities/storageUtil";
import browser from "webextension-polyfill";
import { isSidePanelSupported } from "./sidePanelPreference";

// The notification id carries the window whose panel is hidden, so a click
// that wakes a dormant worker still knows where to open the panel without
// reading anything first: sidePanel.open has to run inside the click event.
// A counter makes the id unique per announced approval.
const ID_PREFIX = "approval-waiting-";
const ID_PATTERN = /^approval-waiting-(\d+)(?:-\d+)?$/;

let announceCounter = 0;
// The id of the notification the pending approval posted, if any.
let announcedId: string | undefined;

const extensionGlobals: {
  chrome?: { sidePanel?: Partial<(typeof globalThis)["chrome"]["sidePanel"]> };
} = globalThis;

/**
 * Posts one system notification saying an approval waits behind another
 * panel. The id is remembered so the release of the approval clears exactly
 * this notification. Never throws.
 */
export const showApprovalWaitingNotification = async (
  windowId: number,
): Promise<void> => {
  try {
    const settings = await StorageUtil.getSettings();
    if (settings.notificationsEnabled === false) {
      return;
    }
    announceCounter += 1;
    const id = `${ID_PREFIX}${windowId}-${announceCounter}`;
    await browser.notifications.create(id, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/qrl/48.png"),
      title: "Approval waiting",
      message:
        "A request is waiting in MyQRLWallet. Select this notification to open it.",
    });
    announcedId = id;
  } catch (error) {
    console.warn("QrlWeb3Wallet: Failed to create notification:", error);
  }
};

/**
 * Clears the notification the finished approval posted, and nothing else.
 * Synchronous up to the clear call, so the next approval's notification is
 * never touched. Best effort: never throws.
 */
export const clearAnnouncedApprovalNotification = (): void => {
  const id = announcedId;
  announcedId = undefined;
  if (id === undefined) return;
  try {
    browser.notifications.clear(id).catch(() => {
      // Already dismissed.
    });
  } catch {
    // The API is unavailable.
  }
};

/**
 * Removes every "approval waiting" notification. Runs once at worker start:
 * a worker that died mid-approval left the request, and so the
 * notification, without an owner. Best effort: never throws.
 */
export const clearApprovalWaitingNotifications = async (): Promise<void> => {
  try {
    const all = await browser.notifications.getAll();
    await Promise.all(
      Object.keys(all)
        .filter((id) => id.startsWith(ID_PREFIX))
        .map((id) => browser.notifications.clear(id)),
    );
  } catch {
    // Nothing to clear, or the API is unavailable.
  }
};

/**
 * notifications.onClicked handler. Chrome treats the click as a user gesture,
 * so the panel opens for the window named in the id. Must stay synchronous up
 * to the open() call.
 */
export const handleApprovalNotificationClicked = (
  notificationId: string,
): void => {
  const match = ID_PATTERN.exec(notificationId);
  if (match === null) {
    return;
  }
  const windowId = Number(match[1]);
  const panel = extensionGlobals.chrome?.sidePanel;
  if (!Number.isInteger(windowId) || !isSidePanelSupported() || !panel?.open) {
    return;
  }
  panel
    .open({ windowId })
    .catch(() => {
      // The window may be gone; the request stays pending in the wallet.
    })
    .finally(() => {
      browser.notifications.clear(notificationId).catch(() => {
        // Already dismissed.
      });
    });
};

// Test seam: the remembered id is module state.
export const resetApprovalNotificationForTests = (): void => {
  announcedId = undefined;
  announceCounter = 0;
};
