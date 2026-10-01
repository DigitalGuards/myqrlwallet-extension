import StorageUtil from "@/utilities/storageUtil";
import { walletSessionStorage } from "@/utilities/profileStorage";
import { transactionFailureUpdate } from "@/functions/transactionOutcome";
import { withTimeout } from "@/functions/withTimeout";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import browser from "webextension-polyfill";
import LockManager from "../lockManager/lockManager";
import { showTransactionNotification } from "./transactionNotification";
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
// Caps a single receipt fetch so one stuck RPC call cannot stall an entire
// tick (and, transitively, every other watch in it) well past the next one.
const RECEIPT_FETCH_TIMEOUT_MS = 10 * 1000;

// Guards against two ticks running at once: the alarm period (30 s) can be
// shorter than a slow tick (many watches, or a slow RPC), and the alarms
// API does not wait for a previous firing to finish before scheduling the
// next. A second run interleaving with the first would double-fetch
// receipts and race on the read-modify-write of the watch list.
let isAlarmHandlerRunning = false;

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
  entry: TransactionHistoryEntry | undefined,
  status: "confirmed" | "failed",
): Promise<void> {
  // While locked, history is still updated (the caller does that before
  // calling here); only the notification is withheld. Checked the same way
  // the rest of the service worker does, and read-only: it reports on the
  // keys the worker currently holds in memory and never prompts for or
  // accepts a password.
  const { isLocked } = await LockManager.isLocked();
  if (isLocked) return;
  // Called directly. This runs in the service worker, and Chrome drops a
  // context's own runtime messages, so a posted SEND_TX_NOTIFICATION would
  // reach no listener at all. The wallet surfaces still reach that
  // listener by message (transactionHistoryStore.ts startPolling), and
  // both paths end up in the same function.
  await showTransactionNotification({
    status,
    amount: entry?.amount,
    tokenSymbol: entry?.tokenSymbol,
    txHash: watch.hash,
  });
}

/**
 * Fires on the watch alarm. For each watched hash: fetch its receipt from
 * the active chain's RPC, apply the same transactionFailureUpdate the
 * history store's own poller applies, and either persist a confirmed/failed
 * update and notify, or leave it queued for the next tick.
 */
export async function handleDAppTransactionWatchAlarm(): Promise<void> {
  if (isAlarmHandlerRunning) return;
  isAlarmHandlerRunning = true;
  try {
    const watches = await getWatches();
    if (watches.length === 0) {
      await browser.alarms.clear(DAPP_TX_WATCH_ALARM_NAME);
      return;
    }
    const now = Date.now();
    const resolvedHashes = new Set<string>();
    // Hoisted out of the loop: every watch checked this tick shares the
    // same RPC endpoint and the same "is the active chain still the one it
    // was registered against" question, so both are fetched once rather
    // than once per watch.
    let qrlProperties: Awaited<ReturnType<typeof getQrlProperties>> | undefined;
    let activeChainId: string | undefined;

    for (const watch of watches) {
      // Expired: dropped silently. The history screen's own poller still
      // reconciles it once it is next opened.
      if (now - watch.startedAt > WATCH_MAX_AGE_MS) {
        resolvedHashes.add(watch.hash.toLowerCase());
        continue;
      }
      try {
        activeChainId ??= (await StorageUtil.getActiveBlockChain()).chainId;
        if (activeChainId.toLowerCase() !== watch.chainId.toLowerCase()) {
          // Wrong network right now: left queued for the next tick, in
          // case the user switches back before it expires.
          continue;
        }
        qrlProperties ??= await getQrlProperties();
        const receipt = await withTimeout(
          qrlProperties.qrl.getTransactionReceipt(watch.hash),
          RECEIPT_FETCH_TIMEOUT_MS,
          `Fetching the receipt for ${watch.hash}`,
        );
        const update = transactionFailureUpdate({ receipt }, watch.hash);
        if (!update.receiptStatusVerified) continue;

        // Read before writing: the history screen's own poller may have
        // confirmed this hash first. If it already has, the update below
        // is a harmless no-op repeat of the same outcome, but the
        // notification for it must not fire twice.
        const history = await StorageUtil.getTransactionHistory(watch.account);
        const entry = history.find(
          (tx) => tx.transactionHash.toLowerCase() === watch.hash.toLowerCase(),
        );
        const alreadyTerminal =
          entry?.pendingStatus === "confirmed" ||
          entry?.pendingStatus === "failed";

        await StorageUtil.updateTransactionHistoryEntry(
          watch.account,
          watch.hash,
          update,
        );
        if (!alreadyTerminal) {
          await notifyWatchOutcome(
            watch,
            entry,
            update.pendingStatus === "confirmed" ? "confirmed" : "failed",
          );
        }
        resolvedHashes.add(watch.hash.toLowerCase());
      } catch (error) {
        console.error(
          `QrlWeb3Wallet: dApp transaction watch failed for ${watch.hash}:`,
          error,
        );
      }
    }

    // Re-reads the list fresh here: a registerDAppTransactionWatch call
    // landing while this tick was still running (a fresh
    // qrl_sendTransaction approved mid-tick) is not in `watches` above, and
    // writing that snapshot back would silently drop it. Only the hashes
    // this tick actually resolved are removed.
    const currentWatches = await getWatches();
    const remaining = currentWatches.filter(
      (watch) => !resolvedHashes.has(watch.hash.toLowerCase()),
    );
    await saveWatches(remaining);
  } finally {
    isAlarmHandlerRunning = false;
  }
}
