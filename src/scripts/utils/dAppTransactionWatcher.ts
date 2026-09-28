import StorageUtil from "@/utilities/storageUtil";
import { walletSessionStorage } from "@/utilities/profileStorage";
import { transactionFailureUpdate } from "@/functions/transactionOutcome";
import browser from "webextension-polyfill";
import { LOCK_MANAGER_MESSAGES } from "../lockManager/lockManager";
import { getQrlProperties } from "./unrestrictedMethodExecutor";

/**
 * Confirms dApp-originated transactions from the always-on service worker,
 * on behalf of the approval surface that submitted them.
 *
 * QrlSendTransactionForContent answers qrl_sendTransaction as soon as the
 * node accepts the broadcast (see its own comment for why), and the
 * popup/panel/notification window it renders in is then free to close for
 * the approval UX. Its transactionHistoryStore poller lives in that closing
 * document, so left alone it never gets to run: the pending entry, and the
 * desktop notification for it, would sit unconfirmed until the history
 * screen happens to be opened again. This watcher does that same
 * confirm-and-notify step here, for exactly the hashes
 * restrictedMethodsMiddleware registered at approval time.
 *
 * State lives in session storage: it is a "confirm this one hash soon" todo
 * list, worthless once the browser closes (the history screen's own poller
 * reconciles anything left stale), and TRUSTED_CONTEXTS-restricted session
 * storage keeps it out of reach of content scripts, matching how
 * LockManager already treats other SW-restart-survivable,
 * browser-session-scoped state. The chrome.alarms entry that drives it, like
 * every other alarm in this wallet, survives a service-worker restart on its
 * own; handleDAppTransactionWatchAlarm re-reads its state from session
 * storage from scratch on every tick, so a restart mid-watch loses nothing.
 */

export type DAppTransactionWatch = {
  hash: string;
  account: string;
  chainId: string;
  startedAt: number;
};

export const DAPP_TX_WATCH_ALARM_NAME = "QRL_DAPP_TX_WATCH";
const WATCH_STORAGE_KEY = "DAPP_TX_WATCHES";
// 30 s: the alarms API's documented floor, and short enough that a 60 s
// slot transaction is confirmed on, or shortly after, the block after next.
const WATCH_ALARM_PERIOD_MINUTES = 0.5;
// The history screen's own poller reconciles anything still pending after
// this; this watcher exists for prompt confirmation, kept deliberately
// short-lived.
const WATCH_MAX_AGE_MS = 30 * 60 * 1000;

async function getWatches(): Promise<DAppTransactionWatch[]> {
  const stored = await walletSessionStorage.get(WATCH_STORAGE_KEY);
  return (
    (stored?.[WATCH_STORAGE_KEY] as DAppTransactionWatch[] | undefined) ?? []
  );
}

/** Arms the alarm only if it is not already scheduled: re-creating an alarm
 *  of the same name resets its schedule, which would push a watch already
 *  in flight further away from confirmation every time a new one arrives. */
async function ensureWatchAlarm(): Promise<void> {
  const existing = await browser.alarms.get(DAPP_TX_WATCH_ALARM_NAME);
  if (existing) return;
  await browser.alarms.create(DAPP_TX_WATCH_ALARM_NAME, {
    periodInMinutes: WATCH_ALARM_PERIOD_MINUTES,
  });
}

async function saveWatches(watches: DAppTransactionWatch[]): Promise<void> {
  if (watches.length === 0) {
    await walletSessionStorage.remove(WATCH_STORAGE_KEY);
    await browser.alarms.clear(DAPP_TX_WATCH_ALARM_NAME);
    return;
  }
  await walletSessionStorage.set({ [WATCH_STORAGE_KEY]: watches });
  await ensureWatchAlarm();
}

/**
 * Registers a hash for confirmation. Idempotent: re-registering the same
 * hash (a duplicate/late middleware resolution) replaces its startedAt, so
 * only one watch is ever queued for a given hash.
 */
export async function registerDAppTransactionWatch(watch: {
  hash: string;
  account: string;
  chainId: string;
}): Promise<void> {
  const watches = await getWatches();
  const deduped = watches.filter(
    (existing) => existing.hash.toLowerCase() !== watch.hash.toLowerCase(),
  );
  deduped.push({ ...watch, startedAt: Date.now() });
  await saveWatches(deduped);
}

async function notifyWatchOutcome(
  watch: DAppTransactionWatch,
  status: "confirmed" | "failed",
): Promise<void> {
  const history = await StorageUtil.getTransactionHistory(watch.account);
  const entry = history.find(
    (tx) => tx.transactionHash.toLowerCase() === watch.hash.toLowerCase(),
  );
  // Same message shape and recipient the history store's own poller uses
  // (transactionHistoryStore.ts startPolling), so serviceWorker.ts's
  // existing SEND_TX_NOTIFICATION handler covers both without change.
  browser.runtime
    .sendMessage({
      name: LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION,
      data: {
        status,
        amount: entry?.amount,
        tokenSymbol: entry?.tokenSymbol,
        txHash: watch.hash,
      },
    })
    .catch(() => {});
}

/**
 * Fires on the watch alarm. For each watched hash: fetch its receipt from
 * the active chain's RPC, apply the same transactionFailureUpdate the
 * history store's own poller applies, and either persist a confirmed/failed
 * update and notify, or leave it queued for the next tick.
 */
export async function handleDAppTransactionWatchAlarm(): Promise<void> {
  const watches = await getWatches();
  if (watches.length === 0) {
    await browser.alarms.clear(DAPP_TX_WATCH_ALARM_NAME);
    return;
  }
  const now = Date.now();
  const remaining: DAppTransactionWatch[] = [];
  for (const watch of watches) {
    // Expired: dropped silently. The history screen's own poller still
    // reconciles it once it is next opened.
    if (now - watch.startedAt > WATCH_MAX_AGE_MS) continue;
    try {
      const activeChain = await StorageUtil.getActiveBlockChain();
      if (activeChain.chainId.toLowerCase() !== watch.chainId.toLowerCase()) {
        // Wrong network right now: the watch stays queued for the next
        // tick, in case the user switches back before it expires.
        remaining.push(watch);
        continue;
      }
      const { qrl } = await getQrlProperties();
      const receipt = await qrl.getTransactionReceipt(watch.hash);
      const update = transactionFailureUpdate({ receipt }, watch.hash);
      if (!update.receiptStatusVerified) {
        remaining.push(watch);
        continue;
      }
      await StorageUtil.updateTransactionHistoryEntry(
        watch.account,
        watch.hash,
        update,
      );
      await notifyWatchOutcome(
        watch,
        update.pendingStatus === "confirmed" ? "confirmed" : "failed",
      );
      // Resolved: not carried into `remaining`, so it is dropped.
    } catch (error) {
      console.error(
        `QrlWeb3Wallet: dApp transaction watch failed for ${watch.hash}:`,
        error,
      );
      remaining.push(watch);
    }
  }
  await saveWatches(remaining);
}
