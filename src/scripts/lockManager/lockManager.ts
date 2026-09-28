import { walletSessionStorage } from "@/utilities/profileStorage";
import StorageUtil, { LockState } from "@/utilities/storageUtil";
import { Bytes } from "@theqrl/web3";
import { DEFAULT_AUTO_LOCK_MINUTES } from "@/configuration/autoLockConfig";
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
// so the SW can re-encrypt new accounts during the unlock session. Both
// fields live in memory only - see the class doc comment below.
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
  // Returns exactly one account's decrypted key. Signing flows (and
  // getMnemonicPhrases) use this so a page that only ever needs one
  // account's mnemonic per signature is never handed the rest of the
  // wallet's.
  GET_DECRYPTED_KEY_FOR_ADDRESS: "GET_DECRYPTED_KEY_FOR_ADDRESS",
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
// reads (GET_*, IS_LOCKED), automated background traffic (the keep-alive
// interval's session write, SEND_TX_NOTIFICATION), and unrelated messages
// this listener merely overhears - must NOT postpone it, or the wallet
// never locks while any surface is left open. See lockManagerListener()
// below for the dApp approval/rejection exception, which is keyed by its
// own `action` field.
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
 *
 * No secret ever leaves this in-memory state (decryptedKeys, walletPassword)
 * for storage.session or anywhere else. Earlier versions kept a plaintext
 * key backup there so the wallet could self-heal across a service-worker
 * restart without asking the user to unlock again; current MetaMask (as of
 * v13.50.0) does not do this either - it removed its equivalent session key
 * cache in 2023 (upstream PR #21672) and simply locks on a worker restart,
 * matching what this class now does. A worker that starts with no keys in
 * memory is locked, full stop; see startKeepAliveInterval() for how it
 * stays alive for as long as it can while unlocked instead.
 */
class LockManager {
  private static decryptedKeys?: DecryptedKeyType[];
  // Held in memory only. Separating the password from `decryptedKeys`
  // reduces blast radius if either store leaks.
  private static walletPassword?: string;
  static readonly AUTO_LOCK_ALARM = "QRL_AUTO_LOCK";
  // Key an old build may have left behind in storage.session before secrets
  // were removed from it entirely; see scrubLegacySessionSecrets().
  private static readonly LEGACY_SESSION_KEYS_KEY = "_LM_CACHED_KEYS";

  // Chrome shuts an idle MV3 service worker down ~30s after its last
  // extension event; a storage.session write counts as one. Writing a
  // fresh timestamp on this interval, while unlocked, keeps the worker (and
  // the in-memory keys/password) alive for as long as any surface needs it.
  //
  // 10s leaves a 3x safety margin under the 30s floor: even a tick delayed
  // by CPU contention for a full extra interval still lands with 10-20s to
  // spare. Current MetaMask writes its equivalent session ping every 2s,
  // 5x more often; that number most likely reflects worst-case telemetry
  // from a far larger install base than this wallet has. Absent that data,
  // a wider-but-still-comfortable margin trades a small amount of restart
  // risk (only reachable under sustained, severe event-loop starvation)
  // for meaningfully less chatter on a worker that has nothing else
  // keeping it warm.
  static readonly KEEP_ALIVE_INTERVAL_MS = 10_000;
  private static keepAliveIntervalId?: ReturnType<typeof setInterval>;

  /**
   * Starts the in-worker keep-alive interval if it is not already running.
   * Idempotent, so every path that can populate `decryptedKeys`
   * (setDecryptedKeys, the single chokepoint below) can call it
   * unconditionally.
   */
  static startKeepAliveInterval(): void {
    if (this.keepAliveIntervalId !== undefined) return;
    this.keepAliveIntervalId = setInterval(() => {
      this.keepAliveTick();
    }, this.KEEP_ALIVE_INTERVAL_MS);
  }

  static stopKeepAliveInterval(): void {
    if (this.keepAliveIntervalId !== undefined) {
      clearInterval(this.keepAliveIntervalId);
      this.keepAliveIntervalId = undefined;
    }
  }

  /** True while the keep-alive interval is running, for tests. */
  static isKeepAliveIntervalRunning(): boolean {
    return this.keepAliveIntervalId !== undefined;
  }

  /**
   * One keep-alive tick: defensively recreates the auto-lock alarm if it is
   * missing while unlocked (guards the gap where an alarm fires during a
   * still-cold start; see serviceWorker.ts's synchronous top-level
   * listener for the primary fix), then writes the session timestamp that
   * keeps the worker alive.
   *
   * Re-checks `decryptedKeys` after every await: a concurrent lock() or
   * resetWallet() can complete while this is still resolving, and touching
   * the auto-lock alarm or writing a fresh keep-alive timestamp for a
   * wallet that is no longer unlocked would be wrong. Detects that itself
   * and stops the interval the moment it finds the wallet locked.
   */
  private static async keepAliveTick(): Promise<void> {
    if (this.decryptedKeys === undefined) {
      this.stopKeepAliveInterval();
      return;
    }

    // "auto-lock: Never" has nothing here to defend against - skip the
    // alarm read/create work on every tick and go straight to the
    // keep-alive write.
    const settings = await StorageUtil.getSettings();
    if (this.decryptedKeys === undefined) {
      this.stopKeepAliveInterval();
      return;
    }
    const autoLockMinutes =
      settings.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
    if (autoLockMinutes > 0) {
      const existingAutoLockAlarm = await browser.alarms.get(
        this.AUTO_LOCK_ALARM,
      );
      if (this.decryptedKeys === undefined) {
        this.stopKeepAliveInterval();
        return;
      }
      if (!existingAutoLockAlarm) {
        await browser.alarms.create(this.AUTO_LOCK_ALARM, {
          delayInMinutes: autoLockMinutes,
        });
        if (this.decryptedKeys === undefined) {
          this.stopKeepAliveInterval();
          return;
        }
      }
    }

    // Write to session storage to keep the SW alive. Never anything but a
    // timestamp - see the class doc comment.
    await walletSessionStorage.set({ keepAlive: Date.now() });
  }

  /**
   * Best-effort cleanup of the plaintext key backup an older build may
   * have left in storage.session before secrets were removed from it
   * entirely. Called once at service-worker startup (serviceWorker.ts).
   * storage.session already clears on browser close, so this only matters
   * within a single browser session that started before an upgrade.
   */
  static async scrubLegacySessionSecrets(): Promise<void> {
    try {
      await walletSessionStorage.remove(this.LEGACY_SESSION_KEYS_KEY);
    } catch {
      // Best effort - nothing to scrub if session storage is not available.
    }
  }

  /**
   * Locking is the one path every other surface's state has to trust, so
   * the LOCKED timestamp is written first, durably, before anything else.
   * Safe to call on an already-locked wallet: clearing already-undefined
   * keys and an already-cleared alarm are both no-ops.
   */
  static async lock(): Promise<void> {
    await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    this.clearDecryptedKeys();
    this.walletPassword = undefined;
    await this.clearAutoLockAlarm();
  }

  /**
   * Drop one account's decrypted key from memory. With no session backup to
   * keep in sync, this is now just an in-memory filter; a locked wallet
   * (nothing in memory) has nothing to scrub.
   */
  static removeAccountKey(accountAddress: string): { success: true } {
    const target = accountAddress.toLowerCase();
    if (this.decryptedKeys === undefined) {
      return { success: true };
    }
    this.setDecryptedKeys(
      this.decryptedKeys.filter(
        (key) => key?.address?.toLowerCase() !== target,
      ),
    );
    return { success: true };
  }

  /**
   * Factory reset, authoritative in the worker: in-memory keys, the wallet
   * password, all of session storage (pending dApp-request data lives
   * there too), the auto-lock alarm and keep-alive interval, and finally
   * all local storage.
   *
   * The LOCKED timestamp is written *after* the wipe. readLockState uses
   * it to confirm an intentional lock; if the wipe erased that marker, a
   * peer surface reading a blank timestamp would have nothing to compare
   * against.
   */
  static async resetWallet(): Promise<{ success: true }> {
    this.clearDecryptedKeys();
    this.walletPassword = undefined;
    await walletSessionStorage.clear();
    await this.clearAutoLockAlarm();
    await StorageUtil.clearAllData();
    await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    return { success: true };
  }

  static async setupAutoLockAlarm(): Promise<void> {
    const settings = await StorageUtil.getSettings();
    const minutes = settings.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
    if (minutes > 0) {
      await browser.alarms.create(this.AUTO_LOCK_ALARM, {
        delayInMinutes: minutes,
      });
    } else {
      await this.clearAutoLockAlarm();
    }
  }

  static async clearAutoLockAlarm(): Promise<void> {
    await browser.alarms.clear(this.AUTO_LOCK_ALARM);
  }

  static async handleAutoLockAlarm(): Promise<void> {
    // lock() writes the LOCKED timestamp itself, first, before anything
    // else - no need to duplicate the write here.
    await this.lock();
  }

  /**
   * A cold worker (or one that has never been unlocked this browser
   * session) always has `decryptedKeys === undefined`, so this reports
   * locked without any restore step: nothing outside this class's own
   * memory can answer otherwise any more.
   */
  static async isLocked(): Promise<{
    isLocked: boolean;
    hasPasswordSet: boolean;
  }> {
    const keyStores = await StorageUtil.getKeystores();
    const accounts = await StorageUtil.getStoredAccounts();

    // Onboarding.tsx (the only account-creation path that can ever run
    // against an empty wallet) writes the account pointer before the
    // keystore that backs it, so accounts.length > 0 with keyStores still
    // at 0 is a normal in-flight write: the wallet has an account pending,
    // it has not been wiped (L2, PR #71 audit). M2's extra IS_LOCKED
    // polling made landing an isLocked() call in that window far more
    // likely. Answering from memory here, with no
    // clear, keeps a concurrent write from self-locking the worker
    // mid-onboarding. hasPasswordSet reports true: an account pointer
    // already exists, and reporting false here would route every OTHER
    // open surface's LockPassword screen into onboarding too. If the
    // write never completes (the keystore write, or Onboarding's own
    // rollback of the pointer on failure, both fail), lockStore.unlock()
    // already fails closed against zero keystores regardless of this
    // flag - see its own `if (!keyStores.length) return "failed"` guard -
    // and the lock screen's "Reset the wallet" action is always there as
    // an escape hatch. CreateAccount.tsx and ImportAccount.tsx persist in
    // the opposite order (keystore first) and never run against an empty
    // wallet, so neither can hit this window at all.
    if (accounts.length > 0 && keyStores.length === 0) {
      return {
        isLocked: this.decryptedKeys === undefined,
        hasPasswordSet: true,
      };
    }

    const hasPasswordSet = keyStores.length > 0 && accounts.length > 0;
    if (!hasPasswordSet) {
      // Both empty: a genuine first-run / factory-reset state. Drop any
      // in-memory keys but do NOT wipe persistent storage from a query
      // path - the popup's onboarding flow will guide the user. An
      // explicit factory-reset action lives in settings for intentional
      // wipes.
      this.clearDecryptedKeys();
      this.walletPassword = undefined;
    }
    return {
      isLocked: this.decryptedKeys === undefined,
      hasPasswordSet,
    };
  }

  /**
   * Accept pre-decrypted keys and the wallet password from the popup. The
   * popup performs the CPU-heavy decrypt, then sends the results here; both
   * fields are required, since a key without a usable password to
   * re-encrypt with is not a state this class accepts any more (there is
   * no recovery path that sends keys alone - see the F1/N8 history in
   * SessionPasswordPrompt.tsx for why that used to exist).
   */
  static setDecryptedKeysFromPopup(payload: SetDecryptedKeysPayload): void {
    const { keys, walletPassword } = payload;
    if (keys.some((key) => !isQrlAddress(key?.address))) {
      throw new Error("Refusing to cache a key with an invalid QIP-55 address");
    }
    if (!walletPassword) {
      throw new Error(
        "Refusing to cache decrypted keys without a wallet password",
      );
    }
    this.walletPassword = walletPassword;
    this.setDecryptedKeys(
      Array.from(
        new Map(
          keys.map((item) => [item.address.toLowerCase(), item]),
        ).values(),
      ),
    );
  }

  static async encryptAccount(accountData: EncryptAccountType): Promise<void> {
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
    this.setDecryptedKeys(
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

  /**
   * Single chokepoint for populating in-memory keys: starts the keep-alive
   * interval unconditionally (idempotent) so every path that can make the
   * wallet go from locked to unlocked - a fresh unlock, a recovered
   * mid-flow re-arm, or the first account created during onboarding -
   * keeps the worker alive the same way.
   */
  private static setDecryptedKeys(decryptedKeys: DecryptedKeyType[]): void {
    this.decryptedKeys = decryptedKeys;
    this.startKeepAliveInterval();
  }

  static getWalletPassword(): string {
    // Force the locked-state error if keys are gone.
    this.getDecryptedKeys();
    if (!this.walletPassword) {
      throw new Error("MyQRLWallet password is unavailable");
    }
    return this.walletPassword;
  }

  static getDecryptedKeys(): DecryptedKeyType[] {
    if (!this.decryptedKeys) {
      this.clearDecryptedKeys();
      throw new Error("MyQRLWallet is locked");
    }
    return this.decryptedKeys;
  }

  /**
   * Returns exactly one account's decrypted key (F4/phase 1 of moving
   * toward a background-only keyring: signing still runs in the calling
   * surface for now, but no longer needs every other account's mnemonic to
   * do it).
   */
  static getDecryptedKeyForAddress(address: string): DecryptedKeyType {
    const keys = this.getDecryptedKeys();
    const target = address?.toLowerCase();
    const match = keys.find((key) => key?.address?.toLowerCase() === target);
    if (!match) {
      throw new Error("No decrypted key found for this account");
    }
    return match;
  }

  /**
   * Single chokepoint for dropping in-memory keys: stops the keep-alive
   * interval unconditionally (idempotent) so every path that can lock the
   * wallet - lock(), resetWallet(), isLocked()'s no-password-set branch,
   * or getDecryptedKeys() finding nothing - leaves nothing keeping the
   * worker warm for a wallet with nothing left to protect.
   */
  private static clearDecryptedKeys(): void {
    this.decryptedKeys = undefined;
    this.stopKeepAliveInterval();
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
      LockManager.setDecryptedKeysFromPopup(
        message?.data ?? { keys: [], walletPassword: "" },
      );
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (message.name === LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY) {
      result = LockManager.removeAccountKey(
        typeof message?.data === "string" ? message.data : "",
      );
    } else if (message.name === LOCK_MANAGER_MESSAGES.RESET_WALLET) {
      result = await LockManager.resetWallet();
    } else if (message.name === LOCK_MANAGER_MESSAGES.LOCK) {
      result = await LockManager.lock();
    } else if (message.name === LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK) {
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (
      message.name === LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEY_FOR_ADDRESS
    ) {
      result = LockManager.getDecryptedKeyForAddress(
        typeof message?.data === "string" ? message.data : "",
      );
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
    // (IS_LOCKED, GET_*), the keep-alive interval's own session write
    // (which never goes through this listener at all), SEND_TX_NOTIFICATION,
    // and any other message - leaves the timer alone.
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
