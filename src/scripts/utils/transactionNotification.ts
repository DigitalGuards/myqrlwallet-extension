import StorageUtil from "@/utilities/storageUtil";
import browser from "webextension-polyfill";

export type TransactionNotificationData = {
  status?: string;
  amount?: string | number;
  tokenSymbol?: string;
  txHash?: string;
};

/**
 * Raises the desktop notification for a settled transaction.
 *
 * Callers inside the service worker invoke this directly. Chrome never
 * delivers a context's own `runtime.sendMessage` back to that context, so a
 * service-worker caller that posted SEND_TX_NOTIFICATION to itself would
 * reach no listener at all; the message path exists purely for the wallet
 * surfaces (popup, side panel, tab), whose own poller still sends it.
 */
export async function showTransactionNotification(
  data: TransactionNotificationData,
): Promise<void> {
  const settings = await StorageUtil.getSettings();
  if (
    !settings.notificationsEnabled &&
    settings.notificationsEnabled !== undefined
  ) {
    return;
  }
  const { status, amount, tokenSymbol, txHash } = data;
  const isConfirmed = status === "confirmed";
  const title = isConfirmed ? "Transaction Confirmed" : "Transaction Failed";
  const body =
    amount !== undefined && tokenSymbol
      ? `Your transaction of ${amount} ${tokenSymbol} ${isConfirmed ? "was confirmed" : "failed"}.`
      : `Your transaction ${isConfirmed ? "was confirmed" : "failed"}.`;
  try {
    await browser.notifications.create(`tx-${txHash ?? Date.now()}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/qrl/48.png"),
      title,
      message: body,
    });
  } catch (error) {
    console.error("QrlWeb3Wallet: Failed to create notification:", error);
  }
}
