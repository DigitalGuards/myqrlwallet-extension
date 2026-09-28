import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Plain object stores (hoisting-safe) ────────────────────────────
const localStore: Record<string, any> = {};
const sessionStore: Record<string, any> = {};
const alarmsStore: Record<string, any> = {};

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? { ...localStore }
              : key in localStore
                ? { [key]: localStore[key] }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete localStore[item];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? { ...sessionStore }
              : key in sessionStore
                ? { [key]: sessionStore[key] }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(sessionStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete sessionStore[item];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(sessionStore)) delete sessionStore[k];
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: vi.fn((name: string, info: any) => {
        alarmsStore[name] = info;
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => {
        delete alarmsStore[name];
        return Promise.resolve(true);
      }),
      get: vi.fn((name: string) => Promise.resolve(alarmsStore[name] ?? null)),
    },
    runtime: {
      id: "mock-extension-id",
      getURL: vi.fn(
        (path: string) => `chrome-extension://mock-extension-id/${path}`,
      ),
    },
  },
}));

vi.mock("@theqrl/web3", () => ({ Bytes: class {} }));
vi.mock("@/crypto/keystoreCrypto", () => ({
  encryptKeystore: vi.fn((_seed: unknown, _password: string) =>
    Promise.resolve({ address: `Q${"c".repeat(128)}`, crypto: {} }),
  ),
}));
vi.mock("@/functions/getMnemonicFromHexSeed", () => ({
  getMnemonicFromHexSeed: vi.fn(() => "mocked mnemonic"),
}));

import browser from "webextension-polyfill";
import LockManager, { LOCK_MANAGER_MESSAGES } from "./lockManager";
import type { DecryptedKeyType } from "./lockManager";
import StorageUtil from "@/utilities/storageUtil";

const mockAlarms = browser.alarms as any;

const clearStore = (store: Record<string, any>) => {
  for (const k of Object.keys(store)) delete store[k];
};

const MOCK_KEYS: DecryptedKeyType[] = [
  {
    address: `Q${"a".repeat(128)}`,
    mnemonicPhrases: "mocked mnemonic",
  },
];
const KEY_B: DecryptedKeyType = {
  address: `Q${"b".repeat(128)}`,
  mnemonicPhrases: "second mnemonic",
};

// A legitimate caller: an extension page (popup/side panel/approval
// window), matching both the extension id and an extension-origin URL that
// lockManagerListener's sender guard requires (F9).
const TRUSTED_SENDER = {
  id: "mock-extension-id",
  url: "chrome-extension://mock-extension-id/index.html",
} as any;

const seedWallet = () => {
  localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
    { address: MOCK_KEYS[0].address },
    { address: KEY_B.address },
  ]);
  localStore[profileStorageKey("ACCOUNTS")] = {
    ALL_ACCOUNTS: [MOCK_KEYS[0].address, KEY_B.address],
  };
};

const unlock = (keys: DecryptedKeyType[] = MOCK_KEYS, password = "test-pw") =>
  LockManager.setDecryptedKeysFromPopup({ keys, walletPassword: password });

describe("LockManager", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearStore(localStore);
    clearStore(sessionStore);
    clearStore(alarmsStore);
    LockManager.stopKeepAliveInterval();
    await LockManager.lock();
  });

  afterEach(() => {
    LockManager.stopKeepAliveInterval();
  });

  // ── No plaintext secret ever lands in storage.session ──────────

  describe("secrets never reach storage.session", () => {
    it("does not write any key/mnemonic/password material across unlock, encryptAccount, removeAccountKey, lock", async () => {
      seedWallet();

      await unlock();
      await LockManager.encryptAccount({
        seed: "0xseed" as any,
        password: "test-pw",
      });
      LockManager.removeAccountKey(KEY_B.address);
      await LockManager.lock();

      const sessionSetCalls = (browser.storage.session.set as any).mock.calls;
      for (const [data] of sessionSetCalls) {
        const keys = Object.keys(data);
        for (const key of keys) {
          // The only value ever written to storage.session by this class is
          // the keep-alive timestamp; assert every single set() call wrote
          // nothing else.
          expect(key.endsWith("keepAlive")).toBe(true);
          expect(typeof data[key]).toBe("number");
        }
      }
    });
  });

  // ── Cold start: no keys in memory means locked ─────────────────

  describe("isLocked", () => {
    it("reports locked with no restore path when decryptedKeys is undefined (F4)", async () => {
      seedWallet();
      // A cold worker: nothing was ever unlocked this session.
      const { isLocked, hasPasswordSet } = await LockManager.isLocked();

      expect(isLocked).toBe(true);
      expect(hasPasswordSet).toBe(true);
    });

    it("reports unlocked once keys are set", async () => {
      seedWallet();
      await unlock();

      const { isLocked } = await LockManager.isLocked();

      expect(isLocked).toBe(false);
    });

    it("reports first-run/reset state and clears in-memory keys when no keystores exist (both empty)", async () => {
      await unlock();

      const { isLocked, hasPasswordSet } = await LockManager.isLocked();

      expect(isLocked).toBe(true);
      expect(hasPasswordSet).toBe(false);
      expect(() => LockManager.getDecryptedKeys()).toThrow();
    });

    describe("account pointer written before its keystore (L2)", () => {
      const seedAccountPointerOnly = () => {
        // Onboarding.tsx's own write order: setActiveAccount() lands before
        // encryptAccount()'s keystore write, so this combination (an
        // account pointer with no matching keystore yet) is a normal
        // in-flight write during the very first account's creation.
        localStore[profileStorageKey("ACCOUNTS")] = {
          ALL_ACCOUNTS: [MOCK_KEYS[0].address],
        };
      };

      it("does not clear in-memory keys or report locked while the write is in flight", async () => {
        seedAccountPointerOnly();
        await unlock();

        const { isLocked, hasPasswordSet } = await LockManager.isLocked();

        expect(isLocked).toBe(false);
        expect(hasPasswordSet).toBe(true);
        // The keys survived: getDecryptedKeys() would throw if they had
        // been cleared.
        expect(() => LockManager.getDecryptedKeys()).not.toThrow();
      });

      it("reports locked (not first-run) with no keys in memory yet", async () => {
        seedAccountPointerOnly();
        // A cold worker mid-onboarding: encryptAccount() has not reached
        // setDecryptedKeys() yet, but this must not be mistaken for the
        // both-empty first-run case and must not route other surfaces to
        // onboarding via hasPasswordSet: false.
        const { isLocked, hasPasswordSet } = await LockManager.isLocked();

        expect(isLocked).toBe(true);
        expect(hasPasswordSet).toBe(true);
      });
    });
  });

  // ── Legacy session backup scrub ─────────────────────────────────

  describe("scrubLegacySessionSecrets", () => {
    it("removes a leftover pre-upgrade key backup from storage.session", async () => {
      sessionStore[profileStorageKey("_LM_CACHED_KEYS")] = MOCK_KEYS;

      await LockManager.scrubLegacySessionSecrets();

      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();
    });

    it("is a harmless no-op when there is nothing to scrub", async () => {
      await expect(
        LockManager.scrubLegacySessionSecrets(),
      ).resolves.toBeUndefined();
    });
  });

  // ── setDecryptedKeysFromPopup validation ────────────────────────

  describe("setDecryptedKeysFromPopup", () => {
    it("requires a wallet password alongside the keys", () => {
      expect(() =>
        LockManager.setDecryptedKeysFromPopup({
          keys: MOCK_KEYS,
          walletPassword: "",
        }),
      ).toThrow(/wallet password/);
      expect(() => LockManager.getDecryptedKeys()).toThrow();
    });

    it("rejects a key with an invalid QIP-55 address", () => {
      expect(() =>
        LockManager.setDecryptedKeysFromPopup({
          keys: [{ address: "0xnotqrl", mnemonicPhrases: "x" }],
          walletPassword: "pw",
        }),
      ).toThrow(/QIP-55/);
    });

    it("accepts a valid payload and starts the keep-alive interval", () => {
      unlock();

      expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);
    });
  });

  // ── GET_DECRYPTED_KEY_FOR_ADDRESS (F4) ──────────────────────────

  describe("getDecryptedKeyForAddress", () => {
    it("returns only the requested account's key", async () => {
      await unlock([MOCK_KEYS[0], KEY_B]);

      const result = LockManager.getDecryptedKeyForAddress(KEY_B.address);

      expect(result).toEqual(KEY_B);
    });

    it("is case-insensitive about the address", async () => {
      await unlock([MOCK_KEYS[0], KEY_B]);

      const result = LockManager.getDecryptedKeyForAddress(
        KEY_B.address.toLowerCase(),
      );

      expect(result).toEqual(KEY_B);
    });

    it("fails closed when the wallet is locked", () => {
      expect(() =>
        LockManager.getDecryptedKeyForAddress(MOCK_KEYS[0].address),
      ).toThrow(/locked/);
    });

    it("fails closed for an address not in the unlocked keyring", async () => {
      await unlock([MOCK_KEYS[0]]);

      expect(() =>
        LockManager.getDecryptedKeyForAddress(KEY_B.address),
      ).toThrow(/No decrypted key/);
    });
  });

  // ── lock() / resetWallet() / removeAccountKey ───────────────────

  describe("lock", () => {
    it("clears keys, the wallet password, the keep-alive interval, and the auto-lock alarm", async () => {
      await unlock();
      await LockManager.setupAutoLockAlarm();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);

      await LockManager.lock();

      expect(() => LockManager.getDecryptedKeys()).toThrow();
      expect(() => LockManager.getWalletPassword()).toThrow();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toBeUndefined();
    });

    it("writes the LOCKED timestamp", async () => {
      await LockManager.lock();

      expect(
        typeof localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBe("number");
    });

    it("is harmless to call on an already-locked wallet", async () => {
      await LockManager.lock();
      await expect(LockManager.lock()).resolves.toBeUndefined();
      expect(() => LockManager.getDecryptedKeys()).toThrow();
    });
  });

  describe("resetWallet", () => {
    it("clears in-memory keys, session storage, local storage, and both alarms", async () => {
      seedWallet();
      await unlock();
      await LockManager.setupAutoLockAlarm();

      await LockManager.resetWallet();

      expect(() => LockManager.getDecryptedKeys()).toThrow();
      expect(localStore[profileStorageKey("KEYSTORES")]).toBeUndefined();
      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toBeUndefined();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
    });

    it("keeps a LOCKED timestamp that survives the wipe", async () => {
      await LockManager.resetWallet();

      expect(
        typeof localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBe("number");
    });
  });

  describe("removeAccountKey", () => {
    it("drops the key from memory", async () => {
      await unlock([MOCK_KEYS[0], KEY_B]);

      const result = LockManager.removeAccountKey(KEY_B.address);

      expect(result).toEqual({ success: true });
      expect(LockManager.getDecryptedKeys()).toEqual([MOCK_KEYS[0]]);
    });

    it("is a harmless no-op while locked (nothing in memory to scrub)", () => {
      const result = LockManager.removeAccountKey(MOCK_KEYS[0].address);

      expect(result).toEqual({ success: true });
    });
  });

  // ── encryptAccount ───────────────────────────────────────────────

  describe("encryptAccount", () => {
    it("refuses an empty password", async () => {
      await expect(
        LockManager.encryptAccount({ seed: "0xseed" as any, password: "" }),
      ).rejects.toThrow(/without a password/);
    });
  });

  // ── Keep-alive interval ──────────────────────────────────────────

  describe("keep-alive interval", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      LockManager.stopKeepAliveInterval();
      vi.useRealTimers();
    });

    it("runs only while unlocked: a tick while locked never fires because start requires keys", async () => {
      // Never unlocked - nothing should be running to tick in the first
      // place.
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
    });

    it("writes a keepAlive timestamp on each tick while unlocked", async () => {
      seedWallet();
      unlock();

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(sessionStore[profileStorageKey("keepAlive")]).toBeDefined();
      expect(typeof sessionStore[profileStorageKey("keepAlive")]).toBe(
        "number",
      );
    });

    it("stops on lock() and does not tick again afterwards", async () => {
      seedWallet();
      unlock();
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      const firstWrite = sessionStore[profileStorageKey("keepAlive")];
      expect(firstWrite).toBeDefined();

      await LockManager.lock();
      clearStore(sessionStore);
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS * 3);

      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
    });

    it("stops on resetWallet()", async () => {
      seedWallet();
      unlock();

      await LockManager.resetWallet();

      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
    });

    it("does not start a second interval if one is already running", () => {
      seedWallet();
      unlock();
      const runningAfterFirst = vi.getTimerCount();

      unlock();

      expect(vi.getTimerCount()).toBe(runningAfterFirst);
    });

    it("defensively recreates a missing auto-lock alarm on tick while unlocked", async () => {
      seedWallet();
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
      unlock();
      delete alarmsStore[LockManager.AUTO_LOCK_ALARM];

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toEqual({
        delayInMinutes: 5,
      });
    });

    it("skips the alarm read/create step entirely when auto-lock is 'Never' (N9)", async () => {
      seedWallet();
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 0 };
      unlock();
      mockAlarms.get.mockClear();

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(mockAlarms.get).not.toHaveBeenCalled();
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeDefined();
    });

    it("bails without recreating the auto-lock alarm or writing keepAlive if lock() completes mid-tick (N5)", async () => {
      seedWallet();
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
      unlock();
      delete alarmsStore[LockManager.AUTO_LOCK_ALARM];

      let resolveSettings: (value: unknown) => void = () => {};
      const settingsGate = new Promise((resolve) => {
        resolveSettings = resolve;
      });
      const getSettingsSpy = vi
        .spyOn(StorageUtil, "getSettings")
        .mockReturnValueOnce(settingsGate as any);

      const tickPromise = vi.advanceTimersByTimeAsync(
        LockManager.KEEP_ALIVE_INTERVAL_MS,
      );
      await LockManager.lock();
      resolveSettings({ autoLockMinutes: 5 });
      await tickPromise;

      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toBeUndefined();
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();

      getSettingsSpy.mockRestore();
    });
  });

  // ── lockManagerListener ───────────────────────────────────────────

  describe("lockManagerListener", () => {
    describe("sender guard (F9)", () => {
      it("rejects a call with no sender", async () => {
        const result = await LockManager.lockManagerListener({
          name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
        });

        expect(result).toBeUndefined();
      });

      it("rejects a sender from a different extension id", async () => {
        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          {
            id: "some-other-extension-id",
            url: "chrome-extension://mock-extension-id/index.html",
          } as any,
        );

        expect(result).toBeUndefined();
      });

      it("accepts a trusted extension-page sender", async () => {
        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          TRUSTED_SENDER,
        );

        expect(result).toEqual({ isLocked: true, hasPasswordSet: false });
      });
    });

    it("SET_DECRYPTED_KEYS starts the keep-alive interval and the auto-lock alarm", async () => {
      seedWallet();
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 10 };

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
          data: { keys: MOCK_KEYS, walletPassword: "pw" },
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual({ success: true });
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);
      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toEqual({
        delayInMinutes: 10,
      });
    });

    it("GET_DECRYPTED_KEY_FOR_ADDRESS returns only the requested key", async () => {
      await unlock([MOCK_KEYS[0], KEY_B]);

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEY_FOR_ADDRESS,
          data: KEY_B.address,
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual(KEY_B);
    });

    it("GET_DECRYPTED_KEYS is not a message this listener answers (L3)", async () => {
      // The whole-keyring read is gone: every caller now goes through
      // GET_DECRYPTED_KEY_FOR_ADDRESS, one account at a time. An unknown
      // message name simply falls through with no result and no key
      // material anywhere in the response.
      await unlock([MOCK_KEYS[0], KEY_B]);

      const result = await LockManager.lockManagerListener(
        { name: "GET_DECRYPTED_KEYS" },
        TRUSTED_SENDER,
      );

      expect(result).toBeUndefined();
    });

    describe("auto-lock activity semantics (F2)", () => {
      beforeEach(async () => {
        localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
        seedWallet();
        await unlock();
        mockAlarms.create.mockClear();
      });

      it("resets the auto-lock timer on USER_ACTIVITY", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );
      });

      it("resets the auto-lock timer on a dApp approval response, matched by its action field", async () => {
        await LockManager.lockManagerListener(
          { action: "QRL_WALLET_DAPP_RESPONSE", data: { hasApproved: true } },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );
      });

      it("does NOT reset the auto-lock timer on IS_LOCKED polling", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();
      });

      it("does NOT reset the auto-lock timer on GET_DECRYPTED_KEY_FOR_ADDRESS reads", async () => {
        await LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEY_FOR_ADDRESS,
            data: MOCK_KEYS[0].address,
          },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();
      });

      it("does NOT reset the auto-lock timer on SEND_TX_NOTIFICATION (automated traffic)", async () => {
        await LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION,
            data: { status: "confirmed" },
          },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();
      });
    });

    it("does NOT reset the auto-lock timer when the wallet is locked", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener(
        { name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY },
        TRUSTED_SENDER,
      );

      expect(mockAlarms.create).not.toHaveBeenCalled();
    });
  });
});
