import StorageUtil from "@/utilities/storageUtil";
import browser from "webextension-polyfill";
import { isSidePanelSupported } from "./sidePanelPreference";

// The notification id carries the window whose panel is hidden, so a click
// that wakes a dormant worker still knows where to open the panel without
// reading anything first: sidePanel.open has to run inside the click event.
const ID_PREFIX = "approval-waiting-";

const extensionGlobals: {
  chrome?: { sidePanel?: Partial<(typeof globalThis)["chrome"]["sidePanel"]> };
} = globalThis;

/**
 * Posts one system notification saying an approval waits behind another
 * panel. The id is fixed per window, so a second request replaces the first
 * notification and never adds another. Never throws.
 */
export const showApprovalWaitingNotification = async (
  windowId: number,
): Promise<void> => {
  try {
    const settings = await StorageUtil.getSettings();
    if (settings.notificationsEnabled === false) {
      return;
    }
    await browser.notifications.create(`${ID_PREFIX}${windowId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/qrl/48.png"),
      title: "Approval waiting",
      message:
        "A request is waiting in MyQRLWallet. Select this notification to open it.",
    });
  } catch (error) {
    console.warn("QrlWeb3Wallet: Failed to create notification:", error);
  }
};

/**
 * Removes the "approval waiting" notifications once the approval is over.
 * Best effort: never throws and never touches the response.
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
  if (!notificationId.startsWith(ID_PREFIX)) {
    return;
  }
  const windowId = Number(notificationId.slice(ID_PREFIX.length));
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
