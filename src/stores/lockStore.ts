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
import { checkForLastError } from "@/scripts/utils/scriptUtils";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { action, makeAutoObservable, runInAction } from "mobx";
import browser from "webextension-polyfill";

// Exponential backoff for the keep-alive port's reconnect, starting short
// (a cold SW is usually back within a couple hundred ms) and capping at
// PORT_RECONNECT_MAX_DELAY_MS, so a genuinely stuck worker settles into a
// gentle every-few-seconds retry.
const PORT_RECONNECT_BASE_DELAY_MS = 250;
const PORT_RECONNECT_MAX_DELAY_MS = 5_000;
// A port that stays connected this long is treated as a real, stable
// connection: the backoff resets, so a later, unrelated disconnect starts
// counting from the short delay again, unaffected by earlier failures from
// a previous cold start.
const PORT_STABLE_AFTER_MS = 5_000;

// Session-storage keys written by automated background traffic: a storage
// change limited to these keys must not trigger readLockState() (which
// polls the SW), or the keep-alive interval's own write and the dApp
// transaction watcher's bookkeeping would keep this store busy for no
// reason. Mirrors LockManager's keep-alive key and
// dAppTransactionWatcher's watch-list key. The legacy key is included too:
// LockManager's one-time startup scrub of a pre-upgrade plaintext key
// backup fires a single storage event for it, which is no more "the user
// did something" than the other two.
const AUTOMATED_SESSION_STORAGE_KEYS = new Set([
  profileStorageKey("keepAlive"),
  profileStorageKey("DAPP_TX_WATCHES"),
  profileStorageKey("_LM_CACHED_KEYS"),
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
  /** Consecutive keep-alive port reconnect attempts, for the backoff. */
  private portReconnectAttempt = 0;
  private portStabilityTimer?: ReturnType<typeof setTimeout>;
  /** Timestamp of the last USER_ACTIVITY ping sent, for throttling. */
  private lastActivityPingAt = 0;
  /**
   * Set once connectKeepAlive() has connected the port for the first time.
   * Distinguishes the constructor's initial connect (already covered by
   * initialize()'s own IS_LOCKED retry loop, right below it) from a real
   * reconnect after the worker dropped the port, which is the case M2's
   * extra readLockState() call exists for.
   */
  private hasConnectedKeepAliveOnce = false;

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
      // Riding the same throttle: a cheap IS_LOCKED re-check while this
      // store still believes it is unlocked (M2), catching a dead worker
      // even on the rare path where its port's onDisconnect never fires.
      // IS_LOCKED stays off lockManagerListener's auto-lock activity
      // allow-list, so this can never re-arm auto-lock itself - only the
      // USER_ACTIVITY ping above does that.
      if (!this.isLocked) {
        this.readLockState();
      }
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
   *
   * Kept even though LockManager now also keeps the worker alive on its
   * own (an in-worker setInterval, started on unlock): that interval only
   * runs while the wallet is unlocked, so a surface sitting on the lock
   * screen - deciding on a password, or just left open - would otherwise
   * have nothing keeping the worker warm between IS_LOCKED polls. This
   * port covers that case; the interval is the belt to this port's braces
   * once something is actually unlocked.
   */
  private connectKeepAlive() {
    try {
      this.keepAlivePort?.disconnect();
    } catch {
      /* already disconnected */
    }
    clearTimeout(this.portStabilityTimer);
    try {
      this.keepAlivePort = browser.runtime.connect({
        name: LOCK_MANAGER_MESSAGES.LOCK_MANAGER_KEEP_LIVE,
      });
      // A port that survives this long is a real connection to a running
      // worker - reset the backoff so a later, unrelated disconnect is not
      // penalised by earlier cold-start failures.
      this.portStabilityTimer = setTimeout(() => {
        this.portReconnectAttempt = 0;
      }, PORT_STABLE_AFTER_MS);
      // The worker's in-memory keys never survive its own restart (F4), so
      // a successful RECONNECT - proof the worker just answered again after
      // a real disconnect, whether or not it is the same instance as
      // before - is exactly when a stale isLocked=false belief needs
      // re-checking (M2): without this, an already-open surface that was
      // unlocked when the worker died keeps showing the dashboard, with
      // every action failing, until something else happens to trigger a
      // poll. The very first connect, from the constructor, is excluded:
      // initialize()'s own IS_LOCKED retry loop already covers it, and
      // firing a second, independent poll here at construction time has no
      // extra value.
      if (this.hasConnectedKeepAliveOnce) {
        this.readLockState();
      }
      this.hasConnectedKeepAliveOnce = true;
      this.keepAlivePort.onDisconnect.addListener(() => {
        // Read runtime.lastError so Chrome does not additionally log it as
        // an "Unchecked runtime.lastError" on top of this reconnect - a
        // dropped connect while the worker is between wake-ups ("Receiving
        // end does not exist") is expected here and already handled.
        checkForLastError();
        // The worker may still answer sendMessage for a moment even though
        // this specific port just dropped (M2); try now, and the reconnect
        // above covers the case where it does not.
        this.readLockState();
        this.scheduleReconnect();
      });
    } catch {
      checkForLastError();
      this.scheduleReconnect();
    }
  }

  /** Reconnects the keep-alive port after an exponential backoff. */
  private scheduleReconnect() {
    const delay = Math.min(
      PORT_RECONNECT_BASE_DELAY_MS * 2 ** this.portReconnectAttempt,
      PORT_RECONNECT_MAX_DELAY_MS,
    );
    this.portReconnectAttempt += 1;
    setTimeout(() => this.connectKeepAlive(), delay);
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
      // Same for the automated session-storage writes: the keep-alive
      // interval's tick and the dApp transaction watcher's bookkeeping are
      // not user activity either (F2). Auto-lock timing itself does not
      // depend on this listener - lockManagerListener's own activity
      // allow-list is authoritative - but calling readLockState() on every
      // such tick was still needless SW traffic (an IS_LOCKED poll) for no
      // observable effect.
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
    let password: string | undefined;
    try {
      // The SW rejects (not returns "") when it is locked or has no
      // password to give - a fresh service-worker restart looks the same
      // as an explicit lock from here: both mean re-unlocking is required.
      password = (await browser.runtime.sendMessage({
        name: LOCK_MANAGER_MESSAGES.GET_WALLET_PASSWORD,
      })) as string | undefined;
    } catch {
      password = undefined;
    }
    if (!password) {
      // Never let the caller encrypt with "": force a re-unlock instead.
      throw new Error("WALLET_PASSWORD_UNAVAILABLE");
    }
    return password;
  }

  async getMnemonicPhrases(accountAddress: string) {
    // Exactly the one requested account's key (F4), via the chokepoint
    // every signing caller shares.
    const key: DecryptedKeyType = await browser.runtime.sendMessage({
      name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEY_FOR_ADDRESS,
      data: accountAddress,
    });
    return key?.mnemonicPhrases ?? "";
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

    return "success";
  }

  /**
   * Reflects the service worker's own answer directly: no client-side
   * resend or timestamp comparison any more. Decrypted keys and the wallet
   * password now vanish together (see LockManager's class doc comment), so
   * there is nothing left for this store to try to resurrect - if the SW
   * says locked, the wallet is locked, and the only way forward is
   * unlock() with the password again.
   */
  async readLockState() {
    try {
      const { isLocked, hasPasswordSet } = await browser.runtime.sendMessage({
        name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
      });
      this.isLocked = isLocked;
      this.hasPasswordSet = hasPasswordSet;
      this.isLoading = false;
    } catch {
      // SW not reachable – will be retried via port reconnect or storage listener
    }
  }

  /**
   * Scrub one account's decrypted key after its keystore was removed. The
   * service worker owns the scrub; it is the only place decrypted keys
   * live at all now.
   */
  async removeAccountKey(accountAddress: string) {
    await this.sendWithRetry({
      name: LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY,
      data: accountAddress,
    });
  }

  /**
   * Factory reset. The wipe runs in the service worker so that in-memory
   * keys, session storage, the auto-lock alarm, and local storage all go
   * in one authoritative step.
   *
   * If the SW cannot be reached at all we still wipe what this context can
   * (session + local storage) rather than leaving the user with a wallet
   * they believe is gone.
   */
  async resetWallet() {
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
    // LockManager.lock() (F6) writes the LOCKED timestamp itself, durably,
    // before it clears anything, so by the time this message resolves
    // every other open surface's readLockState() already sees it.
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
