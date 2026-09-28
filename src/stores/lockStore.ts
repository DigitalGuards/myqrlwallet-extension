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
const KEEP_ALIVE_RETRY_MS = 1_000;

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
  /**
   * Only ever open while this store believes the wallet is genuinely
   * unlocked (real-device regression fix, PR #71 audit): a worker restart
   * always drops the wallet's in-memory keys (F4), so a surface sitting on
   * the LOCK screen has nothing left to keep alive, and holding this port
   * there just resurrects the worker every time Chrome idle-kills it
   * (~30s), forever, running full startup (phishing detector init etc.)
   * each cycle for no reason. See connectKeepAlive()/disconnectKeepAlive().
   */
  private keepAlivePort?: browser.Runtime.Port;
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

    // A one-shot nudge here: the lock state is not known yet, so nothing
    // should linger and hold the worker awake before the persistent port
    // (connected later, once genuinely unlocked) has any reason to exist.
    this.wakeServiceWorker();
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
      // A locked surface has nothing to postpone (auto-lock timing is
      // moot once already locked) and nothing to re-verify via the
      // IS_LOCKED re-check below - and messaging the worker for either
      // reason would wake it right back up. A stray focus/scroll/etc.
      // event on a locked surface (real-device regression, PR #71 audit:
      // observed firing purely from another page opening elsewhere in
      // the same browser context) must never reach the worker at all.
      if (this.isLocked) return;
      const now = Date.now();
      if (now - this.lastActivityPingAt < ACTIVITY_PING_THROTTLE_MS) {
        return;
      }
      this.lastActivityPingAt = now;
      browser.runtime
        .sendMessage({ name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY })
        .catch(() => {
          // SW not reachable right now - the next activity tick will
          // retry. Not worth surfacing.
        });
      // Riding the same throttle: a cheap IS_LOCKED re-check (M2),
      // catching a dead worker even on the rare path where its port's
      // onDisconnect never fires. IS_LOCKED stays off
      // lockManagerListener's auto-lock activity allow-list, so this can
      // never re-arm auto-lock itself - only the USER_ACTIVITY ping above
      // does that.
      this.readLockState();
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
   * Connects the long-lived keep-alive port. As long as a port is
   * connected, Chrome keeps the MV3 SW alive, which is what stands between
   * a surface sitting on the wallet dashboard and a "Receiving end does
   * not exist" error the moment Chrome idle-kills a dormant worker.
   *
   * Only ever called once this store has just learned, from an
   * authoritative source (readLockState()'s own IS_LOCKED reply, or
   * unlock()'s success path), that the wallet is genuinely unlocked - see
   * applyLockState(). Calling it unconditionally used to be the real-device
   * regression this class doc now warns about: a LOCKED surface holding
   * this port open gets idle-killed and immediately resurrected by Chrome
   * every ~30s, running the worker's full startup sequence (phishing
   * detector init etc.) each cycle, forever, for a wallet with nothing to
   * protect.
   *
   * Idempotent: a second call while already connected is a no-op, so
   * nothing here fights a caller's own connect/disconnect bookkeeping.
   */
  private connectKeepAlive(isRetry = false) {
    if (this.keepAlivePort) return;
    try {
      this.keepAlivePort = browser.runtime.connect({
        name: LOCK_MANAGER_MESSAGES.LOCK_MANAGER_KEEP_LIVE,
      });
      this.keepAlivePort.onDisconnect.addListener(() => {
        // Read runtime.lastError so Chrome does not additionally log it as
        // an "Unchecked runtime.lastError" - a dropped port while the
        // worker is between wake-ups is expected and already handled here.
        checkForLastError();
        this.keepAlivePort = undefined;
        // Design invariant carried over from F4/M2: the worker's in-memory
        // keys never survive its own restart, so losing this port for any
        // reason means the wallet is locked from here until a real
        // unlock. Apply that state transition directly - the same one
        // readLockState() would apply, so ScreenLoader's existing effect
        // still swaps to the lock screen - with no message sent to a
        // worker that may or may not even be running right now, and no
        // reconnect: reconnecting immediately is exactly the resurrection
        // loop this design exists to avoid. If the worker actually is
        // still alive for some unrelated reason, the user simply sees the
        // lock screen and a real unlock() call still succeeds against it.
        runInAction(() => {
          this.isLocked = true;
        });
      });
    } catch {
      checkForLastError();
      // One retry, so a transient connect failure does not leave an
      // unlocked surface without its worker-death signal until the next
      // 30 s activity poll. The retry only runs while still unlocked and
      // unconnected, so it cannot hold a locked wallet's worker awake.
      if (!isRetry) {
        setTimeout(() => {
          if (!this.isLocked && !this.keepAlivePort) {
            this.connectKeepAlive(true);
          }
        }, KEEP_ALIVE_RETRY_MS);
      }
    }
  }

  /** Closes the keep-alive port, if one is open. Idempotent. */
  private disconnectKeepAlive() {
    const port = this.keepAlivePort;
    this.keepAlivePort = undefined;
    try {
      port?.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /**
   * One-shot nudge to wake a possibly-cold worker: connects a port, then
   * immediately lets it go. Deliberately not the persistent keep-alive
   * port above - this needs to run in ANY lock state (a message retry, or
   * the very first contact from a freshly opened surface, can happen
   * before the lock state is even known), and must never linger and hold
   * a locked wallet's worker awake.
   */
  private wakeServiceWorker() {
    try {
      browser.runtime
        .connect({ name: LOCK_MANAGER_MESSAGES.LOCK_MANAGER_KEEP_LIVE })
        .disconnect();
    } catch {
      /* read below */
    }
    // Disconnecting our own end fires no onDisconnect for us, so a nudge at
    // a dormant worker would otherwise log "Unchecked runtime.lastError".
    checkForLastError();
  }

  /**
   * Single chokepoint for applying a freshly learned lock state (from
   * readLockState()'s IS_LOCKED reply, the boot-time retry ladder, or
   * unlock()'s own success path): updates the observables ScreenLoader
   * reacts to, and connects or disconnects the keep-alive port to match,
   * so the port can never end up open while this store believes the
   * wallet is locked.
   */
  private applyLockState(isLocked: boolean, hasPasswordSet: boolean) {
    runInAction(() => {
      this.isLocked = isLocked;
      this.hasPasswordSet = hasPasswordSet;
      this.isLoading = false;
    });
    if (!isLocked && hasPasswordSet) {
      this.connectKeepAlive();
    } else {
      this.disconnectKeepAlive();
    }
  }

  /**
   * Boot sequence: try to reach the service worker with quick retries,
   * then start the storage listener.
   */
  private async initialize() {
    // Give the wake nudge a moment to reach the SW. Kept short: on a warm
    // SW every ms here is pure added latency before first paint.
    await new Promise((r) => setTimeout(r, 50));

    for (let i = 0; i < 14; i++) {
      runInAction(() => {
        this.bootAttempt = i + 1;
      });
      try {
        const { isLocked, hasPasswordSet } = await browser.runtime.sendMessage({
          name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
        });
        this.applyLockState(isLocked, hasPasswordSet);
        break;
      } catch {
        // Nudge again to wake the SW. Backoff starts at 150ms so a cold SW
        // is caught quickly; 14 tries keeps the same ~16s overall window
        // the old 10x300ms ladder had.
        this.wakeServiceWorker();
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
      this.applyLockState(isLocked, hasPasswordSet);
    } catch {
      // SW not reachable - will be retried via the storage listener or the
      // next activity poll. If a keep-alive port is open, its own
      // onDisconnect handles the case where the worker is genuinely gone.
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
    // lock() closes the keep-alive port itself immediately here, on
    // purpose: waiting on the port's own onDisconnect (or Chrome's idle
    // timer) to eventually drop it would leave it open for a while after
    // an explicit lock.
    this.disconnectKeepAlive();
  }

  /**
   * Send a message to the service worker with automatic retries. Each
   * retry also nudges the worker awake with wakeServiceWorker(); this
   * runs in any lock state (e.g. Reset the wallet from the lock screen),
   * which is why it goes through the one-shot nudge here and never the
   * persistent keep-alive port.
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
        this.wakeServiceWorker();
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
        // Genuinely unlocked now: reopen the keep-alive port (real-device
        // fix, PR #71 audit) so Chrome does not idle-kill this worker
        // instance out from under an active session.
        this.connectKeepAlive();
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
