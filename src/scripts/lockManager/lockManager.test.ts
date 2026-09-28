import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  encryptKeystore: vi.fn(),
}));
vi.mock("@/functions/getMnemonicFromHexSeed", () => ({
  getMnemonicFromHexSeed: vi.fn(() => "mocked mnemonic"),
}));

import browser from "webextension-polyfill";
import LockManager, { LOCK_MANAGER_MESSAGES } from "./lockManager";
import type { DecryptedKeyType } from "./lockManager";

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

// A legitimate caller: an extension page (popup/side panel/approval
// window), matching both the extension id and an extension-origin URL that
// lockManagerListener's sender guard requires (F9).
const TRUSTED_SENDER = {
  id: "mock-extension-id",
  url: "chrome-extension://mock-extension-id/index.html",
} as any;

describe("LockManager – keep-alive & auto-lock", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    clearStore(alarmsStore);
    await LockManager.lock();
  });

  // ── startKeepAlive / stopKeepAlive (periodic alarm) ────────────

  describe("startKeepAlive", () => {
    it("should create a periodic alarm at the 30s Chrome alarms floor", async () => {
      await LockManager.startKeepAlive();

      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.KEEP_ALIVE_ALARM,
        {
          periodInMinutes: 0.5,
        },
      );
    });
  });

  describe("stopKeepAlive", () => {
    it("should clear the keep-alive alarm", async () => {
      await LockManager.stopKeepAlive();

      expect(mockAlarms.clear).toHaveBeenCalledWith(
        LockManager.KEEP_ALIVE_ALARM,
      );
    });
  });

  // ── handleKeepAliveAlarm ───────────────────────────────────────

  describe("handleKeepAliveAlarm", () => {
    it("should write to session storage while unlocked", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      await LockManager.handleKeepAliveAlarm();

      expect(sessionStore[profileStorageKey("keepAlive")]).toBeDefined();
      expect(typeof sessionStore[profileStorageKey("keepAlive")]).toBe(
        "number",
      );

      await LockManager.lock();
    });

    it("should restore keys from session if SW restarted", async () => {
      // Simulate: a wallet exists, keys backed up in session, in-memory is
      // empty (SW restart). The wallet has to be in storage BEFORE the tick:
      // restoring keys for a wallet that is not there is exactly what the
      // post-reset scrub refuses to do.
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      sessionStore[profileStorageKey("_LM_CACHED_KEYS")] = MOCK_KEYS;

      await LockManager.handleKeepAliveAlarm();

      // Keys should be restored - wallet unlocked
      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(false);

      await LockManager.lock();
    });

    it("should stop the keep-alive alarm and skip the session storage write while locked (F10)", async () => {
      // No keystores/accounts seeded and nothing in the session backup: a
      // genuinely locked, or never-unlocked, wallet.
      await LockManager.startKeepAlive();
      expect(alarmsStore[LockManager.KEEP_ALIVE_ALARM]).toBeDefined();

      await LockManager.handleKeepAliveAlarm();

      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
      expect(alarmsStore[LockManager.KEEP_ALIVE_ALARM]).toBeUndefined();
    });

    it("should recreate a missing auto-lock alarm while unlocked (F3 defensive recreation)", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      // Simulate the auto-lock alarm having been dropped (e.g. missed on a
      // cold start) while the wallet is still unlocked.
      delete alarmsStore[LockManager.AUTO_LOCK_ALARM];

      await LockManager.handleKeepAliveAlarm();

      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toEqual({
        delayInMinutes: 5,
      });

      await LockManager.lock();
    });

    it("skips the alarm read entirely when auto-lock is 'Never' (N9)", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 0 };
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      mockAlarms.get.mockClear();

      await LockManager.handleKeepAliveAlarm();

      expect(mockAlarms.get).not.toHaveBeenCalled();
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeDefined();

      await LockManager.lock();
    });

    it("bails without recreating the auto-lock alarm or writing keepAlive if lock() completes mid-flight (N5)", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      delete alarmsStore[LockManager.AUTO_LOCK_ALARM];

      // Delay alarms.get so a concurrent lock() can complete first, while
      // handleKeepAliveAlarm is still awaiting it.
      let resolveGet: (value: unknown) => void = () => {};
      const getGate = new Promise((resolve) => {
        resolveGet = resolve;
      });
      mockAlarms.get.mockImplementationOnce(() => getGate);

      const keepAlivePromise = LockManager.handleKeepAliveAlarm();
      await LockManager.lock();
      resolveGet(null);
      await keepAlivePromise;

      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toBeUndefined();
      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
    });
  });

  // ── Session key backup / restore ───────────────────────────────

  describe("session key backup", () => {
    it("should backup keys to session storage when keys are set", async () => {
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      expect(sessionStore[profileStorageKey("_LM_CACHED_KEYS")]).toEqual(
        MOCK_KEYS,
      );
    });

    it("should clear session keys on lock", async () => {
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      expect(sessionStore[profileStorageKey("_LM_CACHED_KEYS")]).toBeDefined();

      await LockManager.lock();

      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();
    });

    it("should restore keys from session in isLocked()", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      sessionStore[profileStorageKey("_LM_CACHED_KEYS")] = MOCK_KEYS;

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(false);

      await LockManager.lock();
    });

    it("should NOT restore from session when no keystores exist", async () => {
      // No keystores → clearAllData path → hasPasswordSet = false
      sessionStore[profileStorageKey("_LM_CACHED_KEYS")] = MOCK_KEYS;

      const { isLocked, hasPasswordSet } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      expect(hasPasswordSet).toBe(false);
    });

    it("orders restoreKeysFromSession's read after an in-flight backup write (N4)", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };

      // Slow the next session-storage write so it is still in flight when
      // restoreKeysFromSession's read would otherwise run ahead of it.
      let resolveWrite: () => void = () => {};
      const writeGate = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      const sessionSet = browser.storage.session.set as any;
      sessionSet.mockImplementationOnce((data: Record<string, any>) =>
        writeGate.then(() => {
          Object.assign(sessionStore, data);
        }),
      );

      const setPromise = LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      const restorePromise = LockManager.restoreKeysFromSession();

      // The write has not landed yet - the read must not have run ahead of
      // it and seen an empty session store.
      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();

      resolveWrite();
      await setPromise;
      const restored = await restorePromise;

      expect(restored).toBe(true);
      expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);

      await LockManager.lock();
    });
  });

  // ── setupAutoLockAlarm / clearAutoLockAlarm ────────────────────

  describe("setupAutoLockAlarm", () => {
    it("should create an alarm with the configured minutes", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };

      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
        {
          delayInMinutes: 5,
        },
      );
    });

    it("should use default of 15 minutes when not configured", async () => {
      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
        {
          delayInMinutes: 15,
        },
      );
    });

    it("should clear alarm when autoLockMinutes is 0 (Never)", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 0 };

      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).not.toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
      );
    });
  });

  // ── handleAutoLockAlarm ────────────────────────────────────────

  describe("handleAutoLockAlarm", () => {
    it("should lock the wallet, save LOCKED timestamp, and clear session keys", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };

      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      await LockManager.startKeepAlive();

      await LockManager.handleAutoLockAlarm();

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      expect(
        localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBeDefined();
      // Session keys should be cleared so restore doesn't re-unlock
      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();
    });
  });

  // ── lock() cleanup ─────────────────────────────────────────────

  describe("lock", () => {
    it("should clear keys, session backup, keep-alive alarm, and auto-lock alarm", async () => {
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      await LockManager.startKeepAlive();
      alarmsStore[LockManager.AUTO_LOCK_ALARM] = { delayInMinutes: 5 };

      await LockManager.lock();

      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [MOCK_KEYS[0].address],
      };
      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);

      expect(mockAlarms.clear).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
      );
      expect(mockAlarms.clear).toHaveBeenCalledWith(
        LockManager.KEEP_ALIVE_ALARM,
      );
      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();
    });

    it("should write the LOCKED timestamp itself, before clearing keys (F6)", async () => {
      // The outer beforeEach already ran one lock(), so this captures that
      // timestamp as a baseline for the comparison below.
      const before =
        localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")];
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      await LockManager.lock();

      const after =
        localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")];
      expect(typeof after).toBe("number");
      expect(after).toBeGreaterThanOrEqual(before ?? 0);
    });
  });

  // ── lockManagerListener ────────────────────────────────────────

  describe("lockManagerListener", () => {
    it("should start keep-alive and alarm on SET_DECRYPTED_KEYS", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 10 };

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
          data: MOCK_KEYS,
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual({ success: true });

      // Keep-alive alarm created
      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.KEEP_ALIVE_ALARM,
        expect.any(Object),
      );
      // Auto-lock alarm created
      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
        {
          delayInMinutes: 10,
        },
      );
      // Keys backed up to session
      expect(sessionStore[profileStorageKey("_LM_CACHED_KEYS")]).toEqual(
        MOCK_KEYS,
      );

      await LockManager.lock();
    });

    it("should handle UPDATE_AUTO_LOCK by recreating alarm", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 30 };

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK,
          data: undefined,
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual({ success: true });
      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
        {
          delayInMinutes: 30,
        },
      );
    });

    // ── F2: only user-activity messages postpone auto-lock ────────

    describe("auto-lock activity semantics (F2)", () => {
      beforeEach(async () => {
        localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };
        localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
          { address: "0x123" },
        ]);
        localStore[profileStorageKey("ACCOUNTS")] = {
          ALL_ACCOUNTS: [MOCK_KEYS[0].address],
        };
        await LockManager.setDecryptedKeysFromPopup({
          keys: MOCK_KEYS,
          walletPassword: "test-password",
        });
        mockAlarms.create.mockClear();
      });

      it("should reset the auto-lock timer on USER_ACTIVITY", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );

        await LockManager.lock();
      });

      it("should reset the auto-lock timer on ENCRYPT_ACCOUNT and REMOVE_ACCOUNT_KEY", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.REMOVE_ACCOUNT_KEY, data: "Qnope" },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );

        await LockManager.lock();
      });

      it("should reset the auto-lock timer on a dApp approval response, matched by its action field", async () => {
        await LockManager.lockManagerListener(
          {
            action: "QRL_WALLET_DAPP_RESPONSE",
            data: { hasApproved: true },
          },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );

        await LockManager.lock();
      });

      it("should NOT reset the auto-lock timer on a recovery-tagged SET_DECRYPTED_KEYS resend (N6)", async () => {
        await LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
            data: MOCK_KEYS,
            recovery: true,
          },
          TRUSTED_SENDER,
        );

        // The keep-alive alarm still restarts (harmless/idempotent); only
        // the auto-lock alarm must not be touched by a recovery resend.
        expect(mockAlarms.create).not.toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          expect.any(Object),
        );

        await LockManager.lock();
      });

      it("should still reset the auto-lock timer on a normal (non-recovery) SET_DECRYPTED_KEYS", async () => {
        await LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
            data: MOCK_KEYS,
          },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).toHaveBeenCalledWith(
          LockManager.AUTO_LOCK_ALARM,
          { delayInMinutes: 5 },
        );

        await LockManager.lock();
      });

      it("should NOT reset the auto-lock timer on IS_LOCKED polling", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();

        await LockManager.lock();
      });

      it("should NOT reset the auto-lock timer on GET_DECRYPTED_KEYS or GET_WALLET_PASSWORD reads", async () => {
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEYS },
          TRUSTED_SENDER,
        );
        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.GET_WALLET_PASSWORD },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();

        await LockManager.lock();
      });

      it("should NOT reset the auto-lock timer on SEND_TX_NOTIFICATION (automated traffic)", async () => {
        await LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION,
            data: { status: "confirmed" },
          },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();

        await LockManager.lock();
      });

      it("should NOT reset the auto-lock timer on an unrelated message this listener merely overhears", async () => {
        await LockManager.lockManagerListener(
          { name: "SOME_OTHER_EXTENSION_MESSAGE", data: {} },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();

        await LockManager.lock();
      });
    });

    it("should NOT reset auto-lock timer when wallet is locked", async () => {
      localStore[profileStorageKey("SETTINGS")] = { autoLockMinutes: 5 };

      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY,
          data: undefined,
        },
        TRUSTED_SENDER,
      );

      expect(mockAlarms.create).not.toHaveBeenCalled();
    });

    it("should lock wallet on LOCK message", async () => {
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "0x123" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = { ALL_ACCOUNTS: ["0x123"] };
      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.LOCK,
          data: undefined,
        },
        TRUSTED_SENDER,
      );

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      // Session keys cleared - no restore after intentional lock
      expect(
        sessionStore[profileStorageKey("_LM_CACHED_KEYS")],
      ).toBeUndefined();
    });

    // ── F9: fail-closed sender guard ───────────────────────────────

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

      it("rejects a sender whose url is not extension-origin (e.g. a content script)", async () => {
        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          {
            id: "mock-extension-id",
            url: "https://dapp.example/page",
          } as any,
        );

        expect(result).toBeUndefined();
      });

      it("accepts a trusted extension-page sender", async () => {
        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
          TRUSTED_SENDER,
        );

        expect(result).toEqual({
          isLocked: true,
          hasPasswordSet: false,
        });
      });
    });
  });

  // ── Constants ──────────────────────────────────────────────────

  describe("AUTO_LOCK_ALARM", () => {
    it("should be publicly accessible", () => {
      expect(LockManager.AUTO_LOCK_ALARM).toBe("QRL_AUTO_LOCK");
    });
  });

  describe("KEEP_ALIVE_ALARM", () => {
    it("should be publicly accessible", () => {
      expect(LockManager.KEEP_ALIVE_ALARM).toBe("QRL_KEEP_ALIVE");
    });
  });

  describe("LOCK_MANAGER_MESSAGES", () => {
    it("should include UPDATE_AUTO_LOCK", () => {
      expect(LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK).toBe(
        "LOCK_MANAGER_UPDATE_AUTO_LOCK",
      );
    });
  });
});

describe("LockManager – account removal & factory reset", () => {
  const SESSION_KEYS_KEY = profileStorageKey("_LM_CACHED_KEYS");
  const KEY_A = MOCK_KEYS[0];
  const KEY_B: DecryptedKeyType = {
    address: `Q${"b".repeat(128)}`,
    mnemonicPhrases: "second mnemonic",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    clearStore(alarmsStore);
    await LockManager.lock();
  });

  describe("removeAccountKey", () => {
    it("drops the key from memory and rewrites the session backup", async () => {
      await LockManager.setDecryptedKeysFromPopup({
        keys: [KEY_A, KEY_B],
        walletPassword: "pw",
      });

      await LockManager.removeAccountKey(KEY_B.address);

      expect(LockManager.getDecryptedKeys()).toEqual([KEY_A]);
      expect(sessionStore[SESSION_KEYS_KEY]).toEqual([KEY_A]);
    });

    it("scrubs the session backup even when the worker restarted and holds no keys", async () => {
      // After an SW restart the keys live only in the session backup. A
      // popup-side get-filter-set cannot reach them (getDecryptedKeys
      // throws), so the removed account's mnemonic would survive and the
      // next keep-alive tick would load it straight back into memory.
      // The wallet itself is still present: this is an account removal,
      // not a reset.
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: KEY_A.address.toLowerCase() },
        { address: KEY_B.address.toLowerCase() },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [KEY_A.address, KEY_B.address],
      };
      sessionStore[SESSION_KEYS_KEY] = [KEY_A, KEY_B];

      await LockManager.removeAccountKey(KEY_B.address);

      expect(sessionStore[SESSION_KEYS_KEY]).toEqual([KEY_A]);
      expect(LockManager.getDecryptedKeys()).toEqual([KEY_A]);
    });

    it("is case-insensitive about the address", async () => {
      await LockManager.setDecryptedKeysFromPopup({
        keys: [KEY_A, KEY_B],
        walletPassword: "pw",
      });

      await LockManager.removeAccountKey(KEY_B.address.toLowerCase());

      expect(LockManager.getDecryptedKeys()).toEqual([KEY_A]);
    });
  });

  describe("resetWallet", () => {
    beforeEach(async () => {
      await LockManager.setDecryptedKeysFromPopup({
        keys: [KEY_A, KEY_B],
        walletPassword: "pw",
      });
      // Both are required for isLocked() to consider the wallet set up.
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "qaaa" },
      ]);
      localStore[profileStorageKey("ACCOUNTS")] = {
        ALL_ACCOUNTS: [KEY_A.address],
      };
    });

    it("clears in-memory keys, the session backup, local storage and both alarms", async () => {
      await LockManager.startKeepAlive();
      await LockManager.setupAutoLockAlarm();

      await LockManager.resetWallet();

      expect(() => LockManager.getDecryptedKeys()).toThrow();
      expect(sessionStore[SESSION_KEYS_KEY]).toBeUndefined();
      expect(localStore[profileStorageKey("KEYSTORES")]).toBeUndefined();
      expect(alarmsStore[LockManager.KEEP_ALIVE_ALARM]).toBeUndefined();
      expect(alarmsStore[LockManager.AUTO_LOCK_ALARM]).toBeUndefined();
    });

    it("leaves the wallet password unavailable", async () => {
      await LockManager.resetWallet();

      expect(() => LockManager.getWalletPassword()).toThrow();
    });

    it("keeps a LOCKED timestamp that survives the wipe", async () => {
      // Written after clearAllData: readLockState compares locked-vs-
      // unlocked timestamps to tell an intentional lock from an SW restart,
      // and a wiped marker makes peer surfaces re-arm the reset wallet.
      await LockManager.resetWallet();

      expect(
        typeof localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBe("number");
    });

    it("reports a first-run wallet afterwards", async () => {
      // Before: a set-up, unlocked wallet.
      const { isLocked, hasPasswordSet } = await LockManager.isLocked();
      expect(isLocked).toBe(false);
      expect(hasPasswordSet).toBe(true);

      await LockManager.resetWallet();

      const after = await LockManager.isLocked();
      expect(after.isLocked).toBe(true);
      expect(after.hasPasswordSet).toBe(false);
    });
  });
});

describe("LockManager – session backup cannot outlive the wallet", () => {
  const SESSION_KEYS_KEY = profileStorageKey("_LM_CACHED_KEYS");

  beforeEach(async () => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    clearStore(alarmsStore);
    await LockManager.lock();
  });

  it("refuses to restore keys for a wallet that no longer exists, and scrubs the backup", async () => {
    // Anything that re-armed the worker after a factory reset would
    // otherwise have the keep-alive tick revive the destroyed wallet's
    // plaintext mnemonics from session storage every ~24s.
    sessionStore[SESSION_KEYS_KEY] = MOCK_KEYS;

    const restored = await LockManager.restoreKeysFromSession();

    expect(restored).toBe(false);
    expect(sessionStore[SESSION_KEYS_KEY]).toBeUndefined();
  });

  it("still restores when the wallet is intact", async () => {
    localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
      { address: "qaaa" },
    ]);
    localStore[profileStorageKey("ACCOUNTS")] = {
      ALL_ACCOUNTS: [MOCK_KEYS[0].address],
    };
    sessionStore[SESSION_KEYS_KEY] = MOCK_KEYS;

    const restored = await LockManager.restoreKeysFromSession();

    expect(restored).toBe(true);
    expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);
  });

  it("scrubs the backup when isLocked sees a wiped wallet", async () => {
    sessionStore[SESSION_KEYS_KEY] = MOCK_KEYS;

    const { hasPasswordSet } = await LockManager.isLocked();

    expect(hasPasswordSet).toBe(false);
    expect(sessionStore[SESSION_KEYS_KEY]).toBeUndefined();
  });

  it("keeps the keep-alive tick from reviving a wiped wallet", async () => {
    sessionStore[SESSION_KEYS_KEY] = MOCK_KEYS;

    await LockManager.handleKeepAliveAlarm();

    expect(() => LockManager.getDecryptedKeys()).toThrow();
    expect(sessionStore[SESSION_KEYS_KEY]).toBeUndefined();
  });
});
