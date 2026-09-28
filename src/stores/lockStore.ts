import {
  walletSessionStorage,
  profileStorageKey,
} from "@/utilities/profileStorage";
import {
  DecryptedKeyType,
  EncryptAccountType,
  LOCK_MANAGER_MESSAGES,
} from "@/scripts/lockManager/lockManager";
import type {
  ChangePasswordWorkerRequest,
  ChangePasswordWorkerResponse,
} from "@/scripts/workers/changePasswordWorker";
import type {
  UnlockWorkerRequest,
  UnlockWorkerResponse,
} from "@/scripts/workers/unlockWorker";
import {
  kdfWorkerCount,
  runWorkerJob,
  splitIntoChunks,
} from "@/scripts/workers/keystoreWorkerPool";
import StorageUtil, {
  LockState,
  PRICE_CACHE_IDENTIFIER,
} from "@/utilities/storageUtil";
import {
  isLegacyQrlAddress,
  isQrlAddress,
  LEGACY_QRL_ADDRESS_MIGRATION_ERROR,
} from "@/utilities/addressUtil";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { action, makeAutoObservable, runInAction } from "mobx";
import browser from "webextension-polyfill";

const PORT_RECONNECT_DELAY = 1000;

// Session-storage keys written by automated background traffic: a storage
// change limited to these keys must not trigger
// readLockState() (which polls the SW and can run the SET_DECRYPTED_KEYS
// resend path), or the ~30s keep-alive tick and the dApp transaction
// watcher's bookkeeping would keep this store busy for no reason. Mirrors
// LockManager's own SESSION_KEYS_KEY/keepAlive keys and
// dAppTransactionWatcher's watch-list key.
const AUTOMATED_SESSION_STORAGE_KEYS = new Set([
  profileStorageKey("keepAlive"),
  profileStorageKey("DAPP_TX_WATCHES"),
]);

// At most one USER_ACTIVITY ping per this many ms, so a user actively
// moving the mouse or typing in an open surface does not flood the SW with
// messages; see registerActivityPing().
const ACTIVITY_PING_THROTTLE_MS = 30_000;

/**
 * Outcome of a password verification (unlock() or changePassword()).
 *
 * "wrong-password" means the worker positively confirmed the typed
 * password does not decrypt the stored keystore(s) - the only outcome that
 * should ever count against the F7 unlock-attempt limiter.
 *
 * "failed" covers every other way a verification can come back negative
 * without confirming the password was wrong: an unreachable service
 * worker, an infrastructure failure in the decrypt workers, or - for
 * unlock() specifically - the final IS_LOCKED re-check still reporting
 * locked after a successful SET_DECRYPTED_KEYS. A correct password must
 * never earn a lockout because of one of these.
 */
export type PasswordCheckResult = "success" | "wrong-password" | "failed";

class LockStore {
  hasPasswordSet = true;
  isLoading = true;
  isLocked = true;
  /** 1-based service-worker wake attempt, surfaced by the boot loader. */
  bootAttempt = 1;
  private keepAlivePort?: browser.Runtime.Port;
  /**
   * Cached copy of decrypted keys so the popup can re-send them to the SW
   * if Chrome restarts it (losing its in-memory state).  Cleared on lock().
   */
  private cachedKeys?: DecryptedKeyType[];
  /**
   * Wallet password held in popup memory only - paired with cachedKeys so
   * the popup can re-arm the SW after a Chrome-driven restart without
   * re-prompting the user. Stored separately from `cachedKeys` so leaks of
   * either store do not necessarily leak both.
   */
  private cachedPassword?: string;
  /** Timestamp of the last USER_ACTIVITY ping sent, for throttling. */
  private lastActivityPingAt = 0;

  constructor() {
    makeAutoObservable(this, {
      getWalletPassword: action.bound,
      getMnemonicPhrases: action.bound,
      encryptAccount: action.bound,
      changePassword: action.bound,
      readLockState: action.bound,
      lock: action.bound,
      unlock: action.bound,
      removeAccountKey: action.bound,
      resetWallet: action.bound,
    });

    this.connectKeepAlive();
    this.initialize();
    this.registerActivityPing();
  }

  /**
   * Auto-lock semantics: the wallet locks after N minutes with no user
   * interaction in ANY open wallet surface (popup, side panel, or tab). A
   * surface left open and actively used - clicking, typing, scrolling a
   * list, or simply being the visible tab - sends this throttled ping so
   * the SW can tell that apart from an idle-but-open one. See
   * lockManager.ts's USER_ACTIVITY message and its auto-lock activity
   * allow-list.
   */
  private registerActivityPing() {
    if (typeof document === "undefined") return;
    const ping = () => {
      const now = Date.now();
      if (now - this.lastActivityPingAt < ACTIVITY_PING_THROTTLE_MS) {
        return;
      }
      this.lastActivityPingAt = now;
      browser.runtime
        .sendMessage({ name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY })
        .catch(() => {
          // SW not reachable right now - the next activity tick, or the
          // keep-alive port reconnect, will retry. Not worth surfacing.
        });
    };
    const passiveListener: AddEventListenerOptions = { passive: true };
    document.addEventListener("pointerdown", ping, passiveListener);
    document.addEventListener("keydown", ping, passiveListener);
    document.addEventListener("wheel", ping, passiveListener);
    document.addEventListener("focus", ping, true);
    // Capture: a scrolling container (e.g. the account/history list) fires
    // its own scroll event, which does not bubble. A capturing listener on
    // document still sees it.
    document.addEventListener("scroll", ping, { passive: true, capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") ping();
    });
  }

  /**
   * Keep a long-lived port open to the service worker.
   * As long as a port is connected, Chrome keeps the MV3 SW alive.
   * This prevents the "Receiving end does not exist" error that occurs
   * when Chrome fails to restart a module-type service worker.
   */
  private connectKeepAlive() {
    try {
      this.keepAlivePort?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      this.keepAlivePort = browser.runtime.connect({
        name: LOCK_MANAGER_MESSAGES.LOCK_MANAGER_KEEP_LIVE,
      });
      this.keepAlivePort.onDisconnect.addListener(() => {
        // SW dropped the port - reconnect to wake it back up
        setTimeout(() => this.connectKeepAlive(), PORT_RECONNECT_DELAY);
      });
    } catch {
      // Connection failed (SW not ready yet), retry
      setTimeout(() => this.connectKeepAlive(), PORT_RECONNECT_DELAY);
    }
  }

  /**
   * Boot sequence: try to reach the service worker with quick retries,
   * then start the storage listener.
   */
  private async initialize() {
    // Give the port connection a moment to wake the SW. Kept short: on a
    // warm SW every ms here is pure added latency before first paint.
    await new Promise((r) => setTimeout(r, 50));

    for (let i = 0; i < 14; i++) {
      runInAction(() => {
        this.bootAttempt = i + 1;
      });
      try {
        const { isLocked, hasPasswordSet } = await browser.runtime.sendMessage({
          name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
        });
        runInAction(() => {
          this.isLocked = isLocked;
          this.hasPasswordSet = hasPasswordSet;
          this.isLoading = false;
        });
        break;
      } catch {
        // Also try reconnecting the port to wake the SW. Backoff starts at
        // 150ms so a cold SW is caught quickly; 14 tries keeps the same
        // ~16s overall window the old 10x300ms ladder had.
        this.connectKeepAlive();
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }

    if (this.isLoading) {
      runInAction(() => {
        this.isLoading = false;
      });
    }

    this.initializeStorageListener();
  }

  initializeStorageListener() {
    browser.storage.onChanged.addListener(async (changes, areaName) => {
      const changedKeys = Object.keys(changes);
      if (changedKeys.length === 0) return;
      // Ignore the automated 60s price-cache refresh. It is not user
      // activity, so letting it drive readLockState (which pings the SW)
      // would be needless traffic on every tick.
      if (
        areaName === "local" &&
        changedKeys.every(
          (key) => key === profileStorageKey(PRICE_CACHE_IDENTIFIER),
        )
      ) {
        return;
      }
      // Same for the automated session-storage writes: the keep-alive tick
      // and the dApp transaction watcher's bookkeeping are not user
      // activity either (F2). Auto-lock timing itself no longer depends on
      // this listener - lockManagerListener's own activity allow-list is
      // authoritative - but calling readLockState() on every such tick was
      // still needless SW traffic (an IS_LOCKED poll, and potentially the
      // SET_DECRYPTED_KEYS resend path) for no observable effect.
      if (
        areaName === "session" &&
        changedKeys.every((key) => AUTOMATED_SESSION_STORAGE_KEYS.has(key))
      ) {
        return;
      }
      await this.readLockState();
    });
  }

  async getWalletPassword(): Promise<string> {
    const requestPassword = async (): Promise<string | undefined> => {
      try {
        // The SW rejects (not returns "") when its memory-only password was
        // lost to a restart; treat both a reject and a falsy value as "gone".
        return (await browser.runtime.sendMessage({
          name: LOCK_MANAGER_MESSAGES.GET_WALLET_PASSWORD,
        })) as string | undefined;
      } catch {
        return undefined;
      }
    };

    let password = await requestPassword();
    // If this popup still holds the password + keys from unlock, re-arm the SW
    // and retry once so adding an account stays a no-friction path after a SW
    // restart. Only when cachedKeys is present, so we never overwrite the SW's
    // session-restored keys with an empty set.
    if (!password && this.cachedPassword && this.cachedKeys) {
      try {
        await this.sendWithRetry({
          name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
          data: { keys: this.cachedKeys, walletPassword: this.cachedPassword },
        });
        password = await requestPassword();
      } catch {
        // fall through to the guard below
      }
    }
    if (!password) {
      // Never let the caller encrypt with "": force a re-unlock instead.
      throw new Error("WALLET_PASSWORD_UNAVAILABLE");
    }
    return password;
  }

  async getMnemonicPhrases(accountAddress: string) {
    const decryptedKeys: DecryptedKeyType[] = await browser.runtime.sendMessage(
      {
        name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEYS,
      },
    );
    const accountKey = decryptedKeys?.find(
      (key) => key?.address?.toLowerCase() === accountAddress?.toLowerCase(),
    );
    const mnemonicPhrases: string = accountKey?.mnemonicPhrases ?? "";
    return mnemonicPhrases;
  }

  async encryptAccount(account: Web3BaseWalletAccount, password: string) {
    // Never persist a keystore under an empty password (the SW rejects it too;
    // this stops the round-trip early and keeps the guarantee visible here).
    if (!password) {
      throw new Error("WALLET_PASSWORD_UNAVAILABLE");
    }
    const accountData: EncryptAccountType = {
      seed: account?.seed ?? "",
      password,
    };
    await browser.runtime.sendMessage({
      name: LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT,
      data: accountData,
    });
  }

  /**
   * Change the wallet password.  Decrypts all keystores with the old password,
   * re-encrypts them with the new password in a Web Worker, then persists the
   * new keystores and updates the in-memory keys in the service worker.
   *
   * Returns a PasswordCheckResult: "wrong-password" only when a worker
   * positively confirmed the old password does not decrypt a keystore;
   * anything else that stops the change short (no keystores present, an
   * infrastructure failure in the workers) is "failed".
   */
  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<PasswordCheckResult> {
    const keyStores = await StorageUtil.getKeystores();
    if (!keyStores.length) return "failed";
    if (keyStores.some((keyStore) => isLegacyQrlAddress(keyStore.address))) {
      throw new Error(LEGACY_QRL_ADDRESS_MIGRATION_ERROR);
    }
    if (keyStores.some((keyStore) => !isQrlAddress(keyStore.address))) {
      throw new Error("The wallet contains a keystore with an invalid address");
    }

    // Fan the keystores out over several workers so the argon2id runs
    // execute concurrently (contiguous chunks keep the original order when
    // the per-chunk results are concatenated back together).
    const runChangeChunks = (chunks: (typeof keyStores)[]) =>
      Promise.all(
        chunks.map((chunk) =>
          runWorkerJob<
            ChangePasswordWorkerRequest,
            ChangePasswordWorkerResponse
          >(
            () =>
              new Worker(
                new URL(
                  "../scripts/workers/changePasswordWorker.ts",
                  import.meta.url,
                ),
                { type: "module" },
              ),
            { keystores: chunk, oldPassword, newPassword },
            { success: false, wrongPassword: false },
          ),
        ),
      );

    let responses = await runChangeChunks(
      splitIntoChunks(keyStores, kdfWorkerCount(keyStores.length)),
    );
    if (responses.some((r) => !r.success && r.wrongPassword)) {
      return "wrong-password";
    }
    if (responses.some((r) => !r.success)) {
      // An infrastructure failure: retry sequentially in one worker (peak
      // memory of the old single-worker path).
      responses = await runChangeChunks([keyStores]);
    }

    const succeeded = responses.filter(
      (r): r is Extract<ChangePasswordWorkerResponse, { success: true }> =>
        r.success,
    );
    if (succeeded.length !== responses.length) {
      // The sequential retry (or, defensively, the original fan-out) still
      // has a failure. Report it as a confirmed wrong password only when a
      // worker actually said so; treat anything else as an infrastructure
      // failure.
      return responses.some((r) => !r.success && r.wrongPassword)
        ? "wrong-password"
        : "failed";
    }
    const result = {
      newKeystores: succeeded.flatMap((r) => r.newKeystores),
      newKeys: succeeded.flatMap((r) => r.newKeys),
    };

    // Persist re-encrypted keystores.
    await StorageUtil.setKeystores(result.newKeystores);

    // Update in-memory keys + walletPassword in the service worker.
    const normalisedNewPassword = newPassword.normalize("NFC");
    try {
      await this.sendWithRetry({
        name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
        data: {
          keys: result.newKeys,
          walletPassword: normalisedNewPassword,
        },
      });
    } catch {
      // Keys are persisted - SW will pick them up on next unlock.
    }

    this.cachedKeys = result.newKeys as DecryptedKeyType[];
    this.cachedPassword = normalisedNewPassword;
    return "success";
  }

  async readLockState() {
    try {
      let { isLocked, hasPasswordSet } = await browser.runtime.sendMessage({
        name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
      });

      // A wallet that no longer has keystores + accounts cannot be recovered
      // by re-sending keys, and doing so would resurrect a wallet another
      // surface just reset (this store's cache is per-document, so the
      // surface that ran the reset is not the only one holding keys). Drop
      // the cache instead.
      if (!hasPasswordSet && this.cachedKeys) {
        this.cachedKeys = undefined;
        this.cachedPassword = undefined;
      }

      // If the SW lost its in-memory keys (e.g. Chrome restarted it) but we
      // still have a cached copy from the last successful unlock, re-send them
      // so the wallet stays unlocked while the popup is open.
      if (isLocked && hasPasswordSet && this.cachedKeys) {
        const lockedTs = await StorageUtil.getLockStateTimeStamp(
          LockState.LOCKED,
        );
        const unlockedTs = await StorageUtil.getLockStateTimeStamp(
          LockState.UNLOCKED,
        );
        if (lockedTs > unlockedTs) {
          // Intentional lock (manual or auto-lock) - don't re-send
          this.cachedKeys = undefined;
          this.cachedPassword = undefined;
        } else {
          // SW restart - re-send cached keys (and password if known) to
          // recover. Tagged `recovery: true` (F2/N6): a storage-change
          // listener triggers this automatically, so it must be excluded
          // from postponing the auto-lock timer - see
          // lockManagerListener's allow-list.
          try {
            await browser.runtime.sendMessage({
              name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
              data: this.cachedPassword
                ? {
                    keys: this.cachedKeys,
                    walletPassword: this.cachedPassword,
                  }
                : this.cachedKeys,
              recovery: true,
            });
            const recheck = await browser.runtime.sendMessage({
              name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
            });
            isLocked = recheck.isLocked;
            hasPasswordSet = recheck.hasPasswordSet;
          } catch {
            // Re-send failed - accept the locked state
          }
        }
      }

      this.isLocked = isLocked;
      this.hasPasswordSet = hasPasswordSet;
      this.isLoading = false;
    } catch {
      // SW not reachable – will be retried via port reconnect or storage listener
    }
  }

  /**
   * Scrub one account's decrypted key after its keystore was removed. The
   * service worker owns the scrub (it is the only context that can rewrite
   * the session-storage key backup); this side only drops its own cached
   * copy, which would otherwise be re-sent to the SW on the next restart
   * recovery and resurrect the removed account's mnemonic.
   *
   * Throws if the SW cannot be reached, so callers can abort before
   * deleting the keystore rather than leaving plaintext behind.
   */
  async removeAccountKey(accountAddress: string) {
    const target = accountAddress.toLowerCase();
    if (this.cachedKeys) {
      this.cachedKeys = this.cachedKeys.filter(
        (key) => key?.address?.toLowerCase() !== target,
      );
    }
    await this.sendWithRetry({
      name: LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY,
      data: accountAddress,
    });
  }

  /**
   * Factory reset. The wipe runs in the service worker so that in-memory
   * keys, the session-storage key backup, the alarms, and local storage all
   * go in one authoritative step; doing it from here would leave the
   * session backup (which survives SW restarts by design) holding every
   * account's plaintext mnemonic.
   *
   * If the SW cannot be reached at all we still wipe what this context can
   * (session + local storage) rather than leaving the user with a wallet
   * they believe is gone.
   */
  async resetWallet() {
    this.cachedKeys = undefined;
    this.cachedPassword = undefined;
    try {
      await this.sendWithRetry({
        name: LOCK_MANAGER_MESSAGES.RESET_WALLET,
      });
    } catch {
      await walletSessionStorage.clear();
      await StorageUtil.clearAllData();
      await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    }
    await this.readLockState();
  }

  async lock() {
    this.cachedKeys = undefined;
    this.cachedPassword = undefined;
    // LockManager.lock() (F6) writes the LOCKED timestamp itself, durably,
    // before it clears anything - by the time this message resolves every
    // other open surface's readLockState() already sees it. Writing it a
    // second time here, unawaited, was a race: this fire-and-forget write
    // could land after another surface had already read the (still stale)
    // timestamp and mistaken the lock for a service-worker restart.
    await browser.runtime.sendMessage({
      name: LOCK_MANAGER_MESSAGES.LOCK,
    });
    const { isLocked } = await browser.runtime.sendMessage({
      name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
    });
    this.isLocked = isLocked;
  }

  /**
   * Send a message to the service worker with automatic retries.
   * Each retry also reconnects the keep-alive port to ensure the SW is awake.
   */
  private async sendWithRetry(
    message: Record<string, unknown>,
    maxRetries = 3,
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await browser.runtime.sendMessage(message);
      } catch (error) {
        if (attempt === maxRetries) throw error;
        this.connectKeepAlive();
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  /**
   * Unlock the wallet.  The CPU-heavy argon2id decryption runs in dedicated
   * Web Worker threads (one per keystore chunk, capped by
   * keystoreWorkerPool) so the popup UI stays fully responsive and multiple
   * keystores decrypt concurrently.
   * After decryption the keys are sent to the SW for in-memory storage.
   *
   * Returns a PasswordCheckResult: "wrong-password" only when a worker
   * positively confirmed the typed password does not decrypt a keystore -
   * the only outcome the F7 unlock-attempt limiter should ever record.
   * "failed" covers no keystores being present, and the final IS_LOCKED
   * re-check below still reporting locked after a successful
   * SET_DECRYPTED_KEYS: a communication/timing outcome, given the worker
   * already confirmed the password by that point. Throws on communication
   * errors so the UI can show a distinct message.
   */
  async unlock(password: string): Promise<PasswordCheckResult> {
    // Read keystores and decrypt in Web Workers (separate threads).
    const keyStores = await StorageUtil.getKeystores();
    if (!keyStores.length) return "failed";
    if (keyStores.some((keyStore) => isLegacyQrlAddress(keyStore.address))) {
      throw new Error(LEGACY_QRL_ADDRESS_MIGRATION_ERROR);
    }
    if (keyStores.some((keyStore) => !isQrlAddress(keyStore.address))) {
      throw new Error("The wallet contains a keystore with an invalid address");
    }

    // Contiguous chunks keep the original keystore order when the per-chunk
    // results are concatenated back together.
    const runUnlockChunks = (chunks: (typeof keyStores)[]) =>
      Promise.all(
        chunks.map((chunk) =>
          runWorkerJob<UnlockWorkerRequest, UnlockWorkerResponse>(
            () =>
              new Worker(
                new URL("../scripts/workers/unlockWorker.ts", import.meta.url),
                { type: "module" },
              ),
            { keystores: chunk, password },
            { success: false, wrongPassword: false },
          ),
        ),
      );

    let responses = await runUnlockChunks(
      splitIntoChunks(keyStores, kdfWorkerCount(keyStores.length)),
    );
    if (responses.some((r) => !r.success && r.wrongPassword)) {
      return "wrong-password";
    }
    if (responses.some((r) => !r.success)) {
      // An infrastructure failure (e.g. concurrent WASM argon2id instances
      // exhausted memory). Retry everything in one sequential worker, whose
      // peak memory matches the old single-worker path, before giving up.
      responses = await runUnlockChunks([keyStores]);
      const retry = responses[0];
      if (retry && !retry.success) {
        if (retry.wrongPassword) return "wrong-password";
        throw new Error(
          "Unable to decrypt the wallet on this device right now. Close other tabs or apps to free memory and try again.",
        );
      }
    }

    const succeeded = responses.filter(
      (r): r is Extract<UnlockWorkerResponse, { success: true }> => r.success,
    );
    if (succeeded.length !== responses.length) {
      // Defensive: reachable only if a future change adds a path that ends
      // up here with a failure not already handled above. Treat it the
      // same way - a confirmed wrong password only if a worker said so.
      return responses.some((r) => !r.success && r.wrongPassword)
        ? "wrong-password"
        : "failed";
    }
    const decryptedKeys: DecryptedKeyType[] = succeeded.flatMap((r) => r.keys);

    // If a worker re-encrypted any keystores with stronger KDF parameters,
    // persist them in place of the previous keystores so the user benefits
    // automatically without re-entering their password. The flattened
    // upgraded list is index-aligned with keyStores.
    const upgradedFlat = succeeded.flatMap((r) => r.upgraded);
    if (upgradedFlat.some((k) => k !== null)) {
      const mergedKeystores = keyStores.map(
        (original, index) => upgradedFlat[index] ?? original,
      );
      try {
        await StorageUtil.setKeystores(mergedKeystores);
      } catch (error) {
        console.warn(
          "QrlWeb3Wallet: failed to persist upgraded keystores",
          error,
        );
      }
    }

    // Send decrypted keys + walletPassword to the service worker.
    const normalisedPassword = password.normalize("NFC");
    try {
      await this.sendWithRetry({
        name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
        data: { keys: decryptedKeys, walletPassword: normalisedPassword },
      });
    } catch {
      throw new Error(
        "Unable to communicate with the wallet service. Please check your connection and try again.",
      );
    }

    // Verify the SW now considers us unlocked.
    try {
      const { isLocked } = await browser.runtime.sendMessage({
        name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
      });
      if (!isLocked) {
        runInAction(() => {
          this.isLocked = false;
        });
        this.cachedKeys = decryptedKeys;
        this.cachedPassword = normalisedPassword;
        StorageUtil.updateLockStateTimeStamp(LockState.UNLOCKED);
        return "success";
      }
      // Still reports locked despite a successful SET_DECRYPTED_KEYS: the
      // worker already confirmed this password decrypts the keystore, so
      // this reports as "failed" here. This also deliberately leaves
      // `isLocked` untouched: a caller re-arming the session mid-flow
      // (SessionPasswordPrompt) may currently have `isLocked` false from an
      // earlier session, and flipping this observable would unmount
      // whatever screen is showing for no confirmed reason (see F1/N8).
      return "failed";
    } catch {
      // Verification failed, but keys were sent successfully and the typed
      // password already decrypted the keystore: reports as "failed" here
      // too, leaving `isLocked` untouched for the same reason as above.
      return "failed";
    }
  }
}

export default LockStore;
