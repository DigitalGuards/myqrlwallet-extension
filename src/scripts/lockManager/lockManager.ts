import { walletSessionStorage } from "@/utilities/profileStorage";
import StorageUtil, { LockState } from "@/utilities/storageUtil";
import { Bytes } from "@theqrl/web3";
import { encryptKeystore } from "@/crypto/keystoreCrypto";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import { isQrlAddress } from "@/utilities/addressUtil";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import browser from "webextension-polyfill";

type MessageType = {
  name?: string;
  // A dApp approval/rejection response uses `action` as its discriminator
  // - see EXTENSION_MESSAGES.DAPP_RESPONSE in dAppRequestStore.ts.
  action?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
};

export type EncryptAccountType = {
  seed: Bytes;
  password: string;
};

export type DecryptedKeyType = {
  address: string;
  mnemonicPhrases: string;
};

// SET_DECRYPTED_KEYS payload: keys are stored alongside the wallet password
// so the SW can re-encrypt new accounts during the unlock session, but the
// password is held in a separate field (not interleaved with each key) and
// is excluded from the session-storage backup.
export type SetDecryptedKeysPayload = {
  keys: DecryptedKeyType[];
  walletPassword: string;
};

export const LOCK_MANAGER_MESSAGES = {
  PORT: "LOCK_MANGER_PORT",
  IS_LOCK_MANAGER_READY: "IS_LOCK_MANAGER_READY",
  IS_LOCKED: "LOCK_MANAGER_IS_LOCKED",
  ENCRYPT_ACCOUNT: "ENCRYPT_ACCOUNT",
  LOCK: "LOCK_MANAGER_LOCK",
  LOCK_MANAGER_KEEP_LIVE: "LOCK_MANAGER_KEEP_LIVE",
  GET_DECRYPTED_KEYS: "GET_DECRYPTED_KEYS",
  GET_WALLET_PASSWORD: "GET_WALLET_PASSWORD",
  SET_DECRYPTED_KEYS: "SET_DECRYPTED_KEYS",
  REMOVE_ACCOUNT_KEY: "LOCK_MANAGER_REMOVE_ACCOUNT_KEY",
  RESET_WALLET: "LOCK_MANAGER_RESET_WALLET",
  UPDATE_AUTO_LOCK: "LOCK_MANAGER_UPDATE_AUTO_LOCK",
  SEND_TX_NOTIFICATION: "SEND_TX_NOTIFICATION",
  // A throttled ping the open surfaces send on pointer/keyboard/focus
  // activity, purely so the auto-lock timer can tell "the user is actively
  // using an open surface" apart from automated traffic (keep-alive ticks,
  // IS_LOCKED polling, background notifications). Carries no data.
  USER_ACTIVITY: "LOCK_MANAGER_USER_ACTIVITY",
} as const;

// Message names that represent a deliberate user action or a user-initiated
// write, and therefore postpone the inactivity auto-lock. Everything else -
// reads (GET_*, IS_LOCKED), automated background traffic (keep-alive ticks,
// SEND_TX_NOTIFICATION), and unrelated messages this listener merely
// overhears - must NOT postpone it, or the wallet never locks while any
// surface is left open. See lockManagerListener() below for the dApp
// approval/rejection exception, which is keyed by its own `action` field.
const AUTO_LOCK_ACTIVITY_MESSAGE_NAMES: ReadonlySet<string> = new Set([
  LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
  LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT,
  LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK,
  LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY,
  LOCK_MANAGER_MESSAGES.USER_ACTIVITY,
]);

/**
 * The lock manager, which is part of the extension service worker handles lock related data and functions.
 *
 * IMPORTANT: CPU-heavy keystore decryption (argon2id) is performed in the
 * popup's worker pool, NOT in the service worker.  The popup sends the
 * resulting keys to the SW via the SET_DECRYPTED_KEYS message so that the SW
 * only stores them in memory.  This avoids Chrome killing the SW mid-decrypt.
 * The one KDF the SW does run itself is encryptAccount (new account
 * create/import); it goes through the hash-wasm-backed encryptKeystore, ~2 s
 * instead of the ~20 s the pure-JS KDF took.
 */
class LockManager {
  private static decryptedKeys?: DecryptedKeyType[];
  // Held in memory only - never written to session storage. Separating the
  // password from `decryptedKeys` reduces blast radius if either store leaks.
  private static walletPassword?: string;
  static readonly AUTO_LOCK_ALARM = "QRL_AUTO_LOCK";
  static readonly KEEP_ALIVE_ALARM = "QRL_KEEP_ALIVE";
  private static readonly SESSION_KEYS_KEY = "_LM_CACHED_KEYS";
  // Every read/write against the session-storage key backup runs through
  // this chain, one at a time, in call order. Without it a lock() that
  // clears the backup can race a slightly earlier, still-in-flight
  // backupKeysToSession() write: the clear finishes first, the stale write
  // lands after, and the wallet reads as unlocked again on the next SW
  // restart even though the user just locked it.
  private static sessionOpQueue: Promise<unknown> = Promise.resolve();

  private static queueSessionOp<T>(op: () => Promise<T>): Promise<T> {
    const result = this.sessionOpQueue.then(op, op);
    // Keep the chain alive even if this op rejected, so later ops still
    // run; the rejection itself still reaches whoever awaited `result`.
    this.sessionOpQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Locking is the one path every other surface's restart-recovery logic
   * has to trust, so the LOCKED timestamp is written first, durably, before
   * anything else: readLockState() on another open surface compares it
   * against the UNLOCKED timestamp to tell an intentional lock from a
   * service-worker restart, and by the time this returns that comparison
   * can no longer see a stale (pre-lock) answer.
   */
  static async lock() {
    await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    this.clearDecryptedKeys();
    this.walletPassword = undefined;
    await this.clearSessionKeys();
    await this.stopKeepAlive();
    await this.clearAutoLockAlarm();
  }

  /**
   * Drop one account's decrypted key. Runs here rather than as a popup-side
   * get-filter-set because the session backup must be rewritten too: after a
   * service-worker restart the popup cannot read the keys (getDecryptedKeys
   * throws) yet `_LM_CACHED_KEYS` still holds the removed account's
   * mnemonic, which the next keep-alive tick would load straight back into
   * memory. Restoring from session first makes the scrub authoritative in
   * every state.
   */
  static async removeAccountKey(accountAddress: string) {
    const target = accountAddress.toLowerCase();
    if (this.decryptedKeys === undefined) {
      await this.restoreKeysFromSession();
    }
    if (this.decryptedKeys === undefined) {
      // Nothing in memory and nothing backed up: no plaintext to scrub.
      await this.clearSessionKeys();
      return { success: true };
    }
    // Awaited: the caller (and the popup's ack) must not resolve before the
    // scrub of the session backup is durable, or a service-worker restart
    // right after could still restore the removed account's mnemonic.
    await this.setDecryptedKeys(
      this.decryptedKeys.filter(
        (key) => key?.address?.toLowerCase() !== target,
      ),
    );
    return { success: true };
  }

  /**
   * Factory reset, authoritative in the worker: in-memory keys, the wallet
   * password, the whole of session storage (the decrypted-key backup lives
   * there, as does pending dApp-request data), both alarms, and finally all
   * local storage.
   *
   * The LOCKED timestamp is written *after* the wipe. readLockState uses
   * locked-vs-unlocked timestamps to tell an intentional lock from a
   * service-worker restart; if the wipe erased that marker, both would read
   * 0 and every other open surface would "recover" the wallet by re-sending
   * its cached keys.
   */
  static async resetWallet() {
    this.clearDecryptedKeys();
    this.walletPassword = undefined;
    // Routed through the same queue as backupKeysToSession()/
    // clearSessionKeys(): an in-flight backup write from just before the
    // reset is ordered strictly before the clear, so the clear is always
    // the last write and a key backup cannot resurrect for a wallet that
    // no longer exists.
    await this.queueSessionOp(() => walletSessionStorage.clear());
    await this.stopKeepAlive();
    await this.clearAutoLockAlarm();
    await StorageUtil.clearAllData();
    await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    return { success: true };
  }

  static async startKeepAlive() {
    await browser.alarms.create(this.KEEP_ALIVE_ALARM, {
      // Chrome's alarms API clamps periodInMinutes below 30 seconds (0.5)
      // up to 0.5 in packaged extensions anyway; asking for less than the
      // floor just made the requested period read wrong.
      periodInMinutes: 0.5,
    });
  }

  static async stopKeepAlive() {
    await browser.alarms.clear(this.KEEP_ALIVE_ALARM);
  }

  /**
   * Called when the keep-alive alarm fires.
   * Writes to session storage to reset Chrome's inactivity timer, restores
   * keys from the session backup if the SW was restarted, and defensively
   * recreates the auto-lock alarm if it is missing while unlocked (guards
   * the gap where an alarm fires during a still-cold start; see
   * serviceWorker.ts's synchronous top-level listener for the primary fix).
   *
   * Locked wallets (including a wiped wallet, one never unlocked this
   * session, or "auto-lock: Never" after a browser restart where session
   * storage is already empty) have nothing left to keep alive: the alarm
   * stops itself here. A later SET_DECRYPTED_KEYS starts it again.
   */
  static async handleKeepAliveAlarm() {
    if (this.decryptedKeys === undefined) {
      await this.restoreKeysFromSession();
    }
    if (this.decryptedKeys === undefined) {
      await this.stopKeepAlive();
      return;
    }
    const existingAutoLockAlarm = await browser.alarms.get(
      this.AUTO_LOCK_ALARM,
    );
    if (!existingAutoLockAlarm) {
      await this.setupAutoLockAlarm();
    }
    // Write to session storage to keep the SW alive
    await walletSessionStorage.set({ keepAlive: Date.now() });
  }

  static async setupAutoLockAlarm() {
    const settings = await StorageUtil.getSettings();
    const minutes = settings.autoLockMinutes ?? 15;
    if (minutes > 0) {
      await browser.alarms.create(this.AUTO_LOCK_ALARM, {
        delayInMinutes: minutes,
      });
    } else {
      await this.clearAutoLockAlarm();
    }
  }

  static async clearAutoLockAlarm() {
    await browser.alarms.clear(this.AUTO_LOCK_ALARM);
  }

  static async handleAutoLockAlarm() {
    // lock() writes the LOCKED timestamp itself, first, before anything
    // else - no need to duplicate the write here.
    await this.lock();
  }

  /**
   * Backup decrypted keys to session storage.
   * Session storage survives SW restarts but clears on browser close.
   * Queued: see sessionOpQueue.
   */
  private static async backupKeysToSession() {
    const snapshot = this.decryptedKeys;
    if (!snapshot) return;
    await this.queueSessionOp(() =>
      walletSessionStorage.set({ [this.SESSION_KEYS_KEY]: snapshot }),
    );
  }

  private static async clearSessionKeys() {
    await this.queueSessionOp(() =>
      walletSessionStorage.remove(this.SESSION_KEYS_KEY),
    );
  }

  /**
   * Restore keys from session storage after SW restart.
   * Returns true if keys were restored.
   *
   * Refuses to restore into a wallet that no longer exists, and scrubs the
   * backup when it finds one. Session storage outlives a factory reset by
   * design (it is what survives service-worker restarts), so if anything
   * re-armed the worker after the wipe, the keep-alive tick would otherwise
   * keep reviving the destroyed wallet's plaintext mnemonics every ~24s.
   */
  static async restoreKeysFromSession(): Promise<boolean> {
    try {
      const data = await walletSessionStorage.get(this.SESSION_KEYS_KEY);
      const keys = data?.[this.SESSION_KEYS_KEY] as
        | DecryptedKeyType[]
        | undefined;
      if (keys?.length) {
        const [keyStores, accounts] = await Promise.all([
          StorageUtil.getKeystores(),
          StorageUtil.getAllAccounts(),
        ]);
        if (
          keyStores.length === 0 ||
          accounts.length === 0 ||
          keys.some((key) => !isQrlAddress(key?.address))
        ) {
          await this.clearSessionKeys();
          return false;
        }
        this.decryptedKeys = keys;
        return true;
      }
    } catch {
      // Session storage read failed - accept locked state
    }
    return false;
  }

  static async isLocked() {
    const keyStores = await StorageUtil.getKeystores();
    const accounts = await StorageUtil.getStoredAccounts();
    const hasPasswordSet = keyStores.length > 0 && accounts.length > 0;
    if (!hasPasswordSet) {
      // Storage looks like a first-run / partial-reset state. Drop any
      // in-memory keys but do NOT wipe persistent storage from a query
      // path - the popup's onboarding flow will guide the user. An
      // explicit factory-reset action lives in settings for intentional
      // wipes.
      this.clearDecryptedKeys();
      this.walletPassword = undefined;
      // Drop the decrypted-key backup too. Clearing only the in-memory copy
      // left plaintext mnemonics in session storage after a factory reset,
      // ready for the next restore to pick back up.
      await this.clearSessionKeys();
    }
    // If SW restarted (lost in-memory keys), try restoring from session backup.
    if (this.decryptedKeys === undefined && hasPasswordSet) {
      await this.restoreKeysFromSession();
    }
    return {
      isLocked: this.decryptedKeys === undefined,
      hasPasswordSet,
    };
  }

  /**
   * Accept pre-decrypted keys from the popup.
   * The popup performs the CPU-heavy decrypt, then sends the results here.
   * Accepts either the new {keys, walletPassword} payload or a bare keys
   * array (the latter for SW-restart re-sends, where the popup may have
   * lost the password but still has cached keys).
   */
  static async setDecryptedKeysFromPopup(
    payload: SetDecryptedKeysPayload | DecryptedKeyType[],
  ): Promise<void> {
    const keys = Array.isArray(payload) ? payload : payload.keys;
    if (keys.some((key) => !isQrlAddress(key?.address))) {
      throw new Error("Refusing to cache a key with an invalid QIP-55 address");
    }
    if (!Array.isArray(payload) && payload.walletPassword) {
      this.walletPassword = payload.walletPassword;
    }
    // Awaited: the caller must not report success before the session
    // backup write for these keys is durable (see sessionOpQueue).
    await this.setDecryptedKeys(
      Array.from(
        new Map(
          keys.map((item) => [item.address.toLowerCase(), item]),
        ).values(),
      ),
    );
  }

  static async encryptAccount(accountData: EncryptAccountType) {
    const { password: rawPassword, seed } = accountData;
    const password = rawPassword.normalize("NFC");
    // Never persist a keystore under an empty password: the Argon2id KDF
    // accepts "" and the ciphertext is then trivially recomputable from the
    // cleartext salt stored beside it. Defence in depth behind
    // getWalletPassword's own guard.
    if (!password) {
      throw new Error("Refusing to encrypt an account without a password");
    }
    const keystores = await StorageUtil.getKeystores();
    const encryptedKeyStore = await encryptKeystore(seed, password);
    const updatedKeyStores = [...keystores, encryptedKeyStore];
    await StorageUtil.setKeystores(
      Array.from(
        new Map(
          updatedKeyStores.map((item) => [item.address.toLowerCase(), item]),
        ).values(),
      ),
    );
    // Add the new account key directly to in-memory keys
    // instead of re-decrypting everything (which would block the SW).
    const newKey: DecryptedKeyType = {
      address: encryptedKeyStore.address,
      mnemonicPhrases: getMnemonicFromHexSeed(seed as string),
    };
    this.walletPassword = password;
    const existingKeys = this.decryptedKeys ?? [];
    await this.setDecryptedKeys(
      Array.from(
        new Map(
          [...existingKeys, newKey].map((item) => [
            item.address.toLowerCase(),
            item,
          ]),
        ).values(),
      ),
    );
  }

  private static async setDecryptedKeys(
    decryptedKeys: DecryptedKeyType[],
  ): Promise<void> {
    this.decryptedKeys = decryptedKeys;
    await this.backupKeysToSession();
  }

  static getWalletPassword() {
    // Force the locked-state error if keys are gone.
    this.getDecryptedKeys();
    // After a service-worker restart the decrypted keys self-heal from
    // session storage but the password does NOT (it is memory-only). If we
    // returned "" here, adding or importing an account would silently
    // encrypt the new keystore under an empty password, which anyone who
    // reads the stored keystore could recompute. Fail closed instead: the
    // popup re-arms us from its cached password, or the user re-unlocks.
    if (!this.walletPassword) {
      throw new Error("MyQRLWallet password is unavailable");
    }
    return this.walletPassword;
  }

  static getDecryptedKeys() {
    if (!this.decryptedKeys) {
      this.clearDecryptedKeys();
      throw new Error("MyQRLWallet is locked");
    }
    return this.decryptedKeys;
  }

  private static clearDecryptedKeys() {
    this.decryptedKeys = undefined;
  }

  static async lockManagerListener(
    message: MessageType,
    sender?: browser.Runtime.MessageSender,
  ) {
    // Fail closed: the only legitimate callers are same-extension code
    // running in an extension-origin document (popup, options, side panel,
    // approval window) or the service worker's own context sending a
    // message to itself. Both report `sender.id` equal to this extension's
    // own id and a `sender.url` under the extension's own origin. A caller
    // missing either - undefined sender (should not happen for the real
    // onMessage listener), a different extension, or a content script
    // running with the page's origin - never reaches decrypted keys or the
    // wallet password. Model: sidePanelContentBridge.ts's sender check.
    const extensionUrlPrefix = browser.runtime.getURL("");
    if (
      sender === undefined ||
      typeof sender.id !== "string" ||
      sender.id !== browser.runtime.id ||
      typeof sender.url !== "string" ||
      !sender.url.startsWith(extensionUrlPrefix)
    ) {
      return undefined;
    }
    let result;
    if (message.name === LOCK_MANAGER_MESSAGES.IS_LOCKED) {
      result = await LockManager.isLocked();
    } else if (message.name === LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS) {
      // The popup decrypted the keystores locally and is sending us the results.
      await LockManager.setDecryptedKeysFromPopup(message?.data ?? []);
      await LockManager.startKeepAlive();
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (message.name === LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY) {
      result = await LockManager.removeAccountKey(
        typeof message?.data === "string" ? message.data : "",
      );
    } else if (message.name === LOCK_MANAGER_MESSAGES.RESET_WALLET) {
      result = await LockManager.resetWallet();
    } else if (message.name === LOCK_MANAGER_MESSAGES.LOCK) {
      result = await LockManager.lock();
    } else if (message.name === LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK) {
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (message.name === LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEYS) {
      result = LockManager.getDecryptedKeys();
    } else if (message.name === LOCK_MANAGER_MESSAGES.GET_WALLET_PASSWORD) {
      result = LockManager.getWalletPassword();
    } else if (message.name === LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT) {
      result = await LockManager.encryptAccount(message?.data ?? {});
    } else if (message.name === LOCK_MANAGER_MESSAGES.USER_ACTIVITY) {
      result = { success: true };
    }

    // Only a deliberate user action or user-initiated write postpones the
    // inactivity auto-lock: the allow-list above, plus the dApp
    // approval/rejection response, the one activity signal carrying an
    // `action` field (see MessageType above) as its discriminator.
    // Everything else this global listener happens to overhear - reads
    // (IS_LOCKED, GET_*), keep-alive ticks (which land on their own alarm
    // path), SEND_TX_NOTIFICATION, and any other message - leaves the
    // timer alone.
    const isUserActivity =
      (typeof message.name === "string" &&
        AUTO_LOCK_ACTIVITY_MESSAGE_NAMES.has(message.name)) ||
      message.action === EXTENSION_MESSAGES.DAPP_RESPONSE;
    if (isUserActivity && LockManager.decryptedKeys !== undefined) {
      await LockManager.setupAutoLockAlarm();
    }

    return result;
  }
}

export default LockManager;
