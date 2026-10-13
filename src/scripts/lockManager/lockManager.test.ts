import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Storage and alarm mocks ───────────────────────────────────────
const localStore = new Map<string, unknown>();
const sessionStore = new Map<string, unknown>();
const alarmsStore = new Map<string, browser.Alarms.CreateAlarmInfoType>();
const mockCreateAlarm = vi.hoisted(() =>
  vi.fn<
    (
      name: string,
      info: browser.Alarms.CreateAlarmInfoType,
    ) => void | Promise<void>
  >(),
);

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? Object.fromEntries(localStore)
              : localStore.has(key)
                ? { [key]: localStore.get(key) }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) {
            localStore.set(key, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            localStore.delete(item);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          localStore.clear();
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? Object.fromEntries(sessionStore)
              : sessionStore.has(key)
                ? { [key]: sessionStore.get(key) }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) {
            sessionStore.set(key, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            sessionStore.delete(item);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          sessionStore.clear();
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: mockCreateAlarm.mockImplementation((name, info) => {
        alarmsStore.set(name, info);
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => {
        alarmsStore.delete(name);
        return Promise.resolve(true);
      }),
      get: vi.fn((name: string) =>
        Promise.resolve(
          alarmsStore.has(name) ? { name, scheduledTime: 0 } : undefined,
        ),
      ),
    },
    runtime: {
      id: "mock-extension-id",
      getURL: vi.fn(
        (path: string) => `chrome-extension://mock-extension-id/${path}`,
      ),
    },
  },
}));

vi.mock("@/crypto/keystoreCrypto", () => ({
  encryptKeystore: vi.fn((_seed: unknown, _password: string) =>
    Promise.resolve({ address: `Q${"c".repeat(128)}`, crypto: {} }),
  ),
}));
vi.mock("@/functions/getMnemonicFromHexSeed", () => ({
  getMnemonicFromHexSeed: vi.fn(() => "mocked mnemonic"),
}));

import browser from "webextension-polyfill";
import { encryptKeystore } from "@/crypto/keystoreCrypto";
import { isRecord } from "@/utilities/storageGuards";
import { shouldUpgradeKeystoreParams } from "./keystoreParams";
import LockManager, { LOCK_MANAGER_MESSAGES } from "./lockManager";
import type { DecryptedKeyType } from "./lockManager";
import StorageUtil, {
  KeystoreStorageCorruptError,
  type WalletSettings,
} from "@/utilities/storageUtil";

const mockAlarms = {
  ...vi.mocked(browser.alarms, true),
  create: mockCreateAlarm,
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
const TRUSTED_SENDER: browser.Runtime.MessageSender = {
  id: "mock-extension-id",
  url: "chrome-extension://mock-extension-id/index.html",
};

const seedWallet = () => {
  localStore.set(
    profileStorageKey("KEYSTORES"),
    JSON.stringify([
      { address: MOCK_KEYS[0].address, crypto: {} },
      { address: KEY_B.address, crypto: {} },
    ]),
  );
  localStore.set(profileStorageKey("ACCOUNTS"), {
    ALL_ACCOUNTS: [MOCK_KEYS[0].address, KEY_B.address],
  });
};

const unlock = (keys: DecryptedKeyType[] = MOCK_KEYS, password = "test-pw") => {
  LockManager.setDecryptedKeysFromPopup({ keys, walletPassword: password });
};

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise is not initialized");
  };
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("keystore parameter boundaries", () => {
  it.each([
    { label: "array envelope", value: [] },
    { label: "array crypto", value: { crypto: [], kdfparams: { m: 4096 } } },
    { label: "null crypto", value: { crypto: null, kdfparams: { m: 4096 } } },
    {
      label: "string crypto",
      value: { crypto: "invalid", kdfparams: { m: 4096 } },
    },
    {
      label: "numeric kdf",
      value: { crypto: { kdf: 1, kdfparams: { m: 4096 } } },
    },
    { label: "object kdf", value: { kdf: {}, kdfparams: { m: 4096 } } },
    {
      label: "array params",
      value: { kdfparams: Object.assign([], { m: 4096 }) },
    },
    { label: "string params", value: { kdfparams: "invalid" } },
    { label: "null params", value: { kdfparams: null } },
    { label: "string cost", value: { kdfparams: { m: "4096" } } },
  ])("rejects $label without changing the input", ({ value }) => {
    const original = JSON.stringify(value);
    expect(shouldUpgradeKeystoreParams(value)).toBe(false);
    expect(JSON.stringify(value)).toBe(original);
  });

  it("keeps partial legacy parameters and nested parameter precedence", () => {
    expect(shouldUpgradeKeystoreParams({ kdfparams: { m: 4096 } })).toBe(true);
    expect(shouldUpgradeKeystoreParams({ kdf: "scrypt" })).toBe(true);
    expect(
      shouldUpgradeKeystoreParams({
        kdf: "scrypt",
        crypto: { kdf: "argon2id", kdfparams: { m: 262144, t: 8, dklen: 32 } },
      }),
    ).toBe(false);
  });
});

describe("LockManager", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStore.clear();
    sessionStore.clear();
    alarmsStore.clear();
    LockManager.stopKeepAliveInterval();
    await LockManager.lock();
  });

  afterEach(() => {
    LockManager.stopKeepAliveInterval();
    vi.restoreAllMocks();
  });

  // ── No plaintext secret ever lands in storage.session ──────────

  describe("secrets never reach storage.session", () => {
    it("does not write any key/mnemonic/password material across unlock, encryptAccount, removeAccountKey, lock", async () => {
      seedWallet();

      unlock();
      await LockManager.encryptAccount({
        seed: "0xseed",
        password: "test-pw",
      });
      LockManager.removeAccountKey(KEY_B.address);
      await LockManager.lock();

      const sessionSetCalls = vi.mocked(browser.storage.session).set.mock.calls;
      for (const [value] of sessionSetCalls) {
        const data: unknown = value;
        if (!isRecord(data)) throw new Error("Expected a storage write");
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
    it.each(["null", "{}", "[null]", "[{}]", "not JSON"])(
      "keeps recovery reachable for corrupt storage %s without writing",
      async (stored) => {
        localStore.set(profileStorageKey("KEYSTORES"), stored);
        unlock();
        vi.clearAllMocks();

        await expect(
          LockManager.lockManagerListener(
            { name: LOCK_MANAGER_MESSAGES.IS_LOCKED },
            TRUSTED_SENDER,
          ),
        ).resolves.toEqual({ isLocked: true, hasPasswordSet: true });
        expect(LockManager.hasWalletPassword()).toBe(false);
        expect(() => LockManager.getDecryptedKeys()).toThrow();
        expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(stored);
        for (const area of [browser.storage.local, browser.storage.session]) {
          expect(vi.mocked(area).set.mock.calls).toHaveLength(0);
          expect(vi.mocked(area).remove.mock.calls).toHaveLength(0);
          expect(vi.mocked(area).clear.mock.calls).toHaveLength(0);
        }
      },
    );

    it("propagates corrupt storage from account encryption before writing", async () => {
      localStore.set(profileStorageKey("KEYSTORES"), "null");
      vi.clearAllMocks();

      await expect(
        LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT,
            data: { seed: "unused-seed", password: "test-pw" },
          },
          TRUSTED_SENDER,
        ),
      ).rejects.toBeInstanceOf(KeystoreStorageCorruptError);
      expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe("null");
      for (const area of [browser.storage.local, browser.storage.session]) {
        expect(vi.mocked(area).set.mock.calls).toHaveLength(0);
        expect(vi.mocked(area).remove.mock.calls).toHaveLength(0);
        expect(vi.mocked(area).clear.mock.calls).toHaveLength(0);
      }
    });

    it("reports locked with no restore path when decryptedKeys is undefined (F4)", async () => {
      seedWallet();
      // A cold worker: nothing was ever unlocked this session.
      const { isLocked, hasPasswordSet } = await LockManager.isLocked();

      expect(isLocked).toBe(true);
      expect(hasPasswordSet).toBe(true);
    });

    it("reports unlocked once keys are set", async () => {
      seedWallet();
      unlock();

      const { isLocked } = await LockManager.isLocked();

      expect(isLocked).toBe(false);
    });

    it("reports first-run/reset state and clears in-memory keys when no keystores exist (both empty)", async () => {
      unlock();

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
        localStore.set(profileStorageKey("ACCOUNTS"), {
          ALL_ACCOUNTS: [MOCK_KEYS[0].address],
        });
      };

      it("does not clear in-memory keys or report locked while the write is in flight", async () => {
        seedAccountPointerOnly();
        unlock();

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
      sessionStore.set(profileStorageKey("_LM_CACHED_KEYS"), MOCK_KEYS);

      await LockManager.scrubLegacySessionSecrets();

      expect(
        sessionStore.get(profileStorageKey("_LM_CACHED_KEYS")),
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
    it("preserves last-key replacement and first-address ordering", () => {
      const replacement = {
        address: MOCK_KEYS[0].address.toUpperCase(),
        mnemonicPhrases: "replacement mnemonic",
      };
      unlock([MOCK_KEYS[0], KEY_B, replacement]);

      expect(LockManager.getDecryptedKeys()).toEqual([replacement, KEY_B]);
    });

    it("requires a wallet password alongside the keys", () => {
      expect(() => {
        LockManager.setDecryptedKeysFromPopup({
          keys: MOCK_KEYS,
          walletPassword: "",
        });
      }).toThrow(/wallet password/);
      expect(() => LockManager.getDecryptedKeys()).toThrow();
    });

    it("rejects a key with an invalid QIP-55 address", () => {
      expect(() => {
        LockManager.setDecryptedKeysFromPopup({
          keys: [{ address: "0xnotqrl", mnemonicPhrases: "x" }],
          walletPassword: "pw",
        });
      }).toThrow(/QIP-55/);
    });

    it("accepts a valid payload and starts the keep-alive interval", () => {
      unlock();

      expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);
    });
  });

  // ── GET_DECRYPTED_KEY_FOR_ADDRESS (F4) ──────────────────────────

  describe("getDecryptedKeyForAddress", () => {
    it("returns only the requested account's key", () => {
      unlock([MOCK_KEYS[0], KEY_B]);

      const result = LockManager.getDecryptedKeyForAddress(KEY_B.address);

      expect(result).toEqual(KEY_B);
    });

    it("is case-insensitive about the address", () => {
      unlock([MOCK_KEYS[0], KEY_B]);

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

    it("fails closed for an address not in the unlocked keyring", () => {
      unlock([MOCK_KEYS[0]]);

      expect(() =>
        LockManager.getDecryptedKeyForAddress(KEY_B.address),
      ).toThrow(/No decrypted key/);
    });
  });

  // ── lock() / resetWallet() / removeAccountKey ───────────────────

  describe("lock", () => {
    it("clears keys, the wallet password, the keep-alive interval, and the auto-lock alarm", async () => {
      unlock();
      await LockManager.setupAutoLockAlarm();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);

      await LockManager.lock();

      expect(() => LockManager.getDecryptedKeys()).toThrow();
      expect(LockManager.hasWalletPassword()).toBe(false);
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toBeUndefined();
    });

    it("writes the LOCKED timestamp", async () => {
      await LockManager.lock();

      expect(
        typeof localStore.get(
          profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP"),
        ),
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
      unlock();
      await LockManager.setupAutoLockAlarm();

      await LockManager.resetWallet();

      expect(() => LockManager.getDecryptedKeys()).toThrow();
      expect(localStore.get(profileStorageKey("KEYSTORES"))).toBeUndefined();
      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toBeUndefined();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
    });

    it("keeps a LOCKED timestamp that survives the wipe", async () => {
      await LockManager.resetWallet();

      expect(
        typeof localStore.get(
          profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP"),
        ),
      ).toBe("number");
    });
  });

  describe("removeAccountKey", () => {
    it("drops the key from memory", () => {
      unlock([MOCK_KEYS[0], KEY_B]);

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

  describe("hasWalletPassword", () => {
    it("is false on a locked worker", () => {
      expect(LockManager.hasWalletPassword()).toBe(false);
    });

    it("is true once an unlock session holds a password", () => {
      unlock();

      expect(LockManager.hasWalletPassword()).toBe(true);
    });

    it("never throws while locked, unlike the decrypted-key reads", () => {
      expect(() => LockManager.hasWalletPassword()).not.toThrow();
      // And it leaves the locked state exactly as it found it.
      expect(() => LockManager.getDecryptedKeys()).toThrow(/locked/);
    });
  });

  describe("encryptAccount", () => {
    it("preserves stored records and ordering when adding an account", async () => {
      const records = [
        {
          address: KEY_B.address,
          crypto: { preserved: "second" },
          label: "second",
        },
        {
          address: MOCK_KEYS[0].address,
          crypto: { preserved: "first" },
          label: "first",
        },
      ];
      const unrelated = { entries: ["second", "first"] };
      localStore.set(profileStorageKey("KEYSTORES"), JSON.stringify(records));
      localStore.set("unrelated", unrelated);
      unlock([KEY_B, MOCK_KEYS[0]]);

      await expect(
        LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT,
            data: { seed: "0xseed", password: "cafe\u0301" },
          },
          TRUSTED_SENDER,
        ),
      ).resolves.toBeUndefined();

      expect(encryptKeystore).toHaveBeenCalledWith("0xseed", "caf\u00e9");
      expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(
        JSON.stringify([
          ...records,
          { address: `Q${"c".repeat(128)}`, crypto: {} },
        ]),
      );
      expect(localStore.get("unrelated")).toBe(unrelated);
      expect(LockManager.getDecryptedKeys()).toEqual([
        KEY_B,
        MOCK_KEYS[0],
        { address: `Q${"c".repeat(128)}`, mnemonicPhrases: "mocked mnemonic" },
      ]);
    });

    it("refuses an empty password with no session password behind it", async () => {
      await expect(
        LockManager.encryptAccount({ seed: "0xseed", password: "" }),
      ).rejects.toThrow(/without a password/);
    });

    it("refuses a payload with no password at all on a locked worker", async () => {
      await expect(
        LockManager.encryptAccount({ seed: "0xseed" }),
      ).rejects.toThrow(/without a password/);
    });

    it("encrypts with the password the worker already holds when the payload carries none", async () => {
      seedWallet();
      unlock();

      await expect(
        LockManager.encryptAccount({ seed: "0xseed" }),
      ).resolves.toBeUndefined();

      const { encryptKeystore } = await import("@/crypto/keystoreCrypto");
      expect(encryptKeystore).toHaveBeenCalledWith("0xseed", "test-pw");
      // The new account's key joined the in-memory keyring.
      expect(
        LockManager.getDecryptedKeys().some(
          (key) => key.address === `Q${"c".repeat(128)}`,
        ),
      ).toBe(true);
    });

    it("prefers an explicit payload password over the held one", async () => {
      seedWallet();
      unlock();

      await LockManager.encryptAccount({
        seed: "0xseed",
        password: "typed-pw",
      });

      const { encryptKeystore } = await import("@/crypto/keystoreCrypto");
      expect(encryptKeystore).toHaveBeenCalledWith("0xseed", "typed-pw");
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
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
    });

    it("writes a keepAlive timestamp on each tick while unlocked", async () => {
      seedWallet();
      unlock();

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeDefined();
      expect(typeof sessionStore.get(profileStorageKey("keepAlive"))).toBe(
        "number",
      );
    });

    it("stops on lock() and does not tick again afterwards", async () => {
      seedWallet();
      unlock();
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      const firstWrite = sessionStore.get(profileStorageKey("keepAlive"));
      expect(firstWrite).toBeDefined();

      await LockManager.lock();
      sessionStore.clear();
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS * 3);

      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
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
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
      unlock();
      alarmsStore.delete(LockManager.AUTO_LOCK_ALARM);

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toEqual({
        delayInMinutes: 5,
      });
    });

    it("skips the alarm read/create step entirely when auto-lock is 'Never' (N9)", async () => {
      seedWallet();
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 0 });
      unlock();
      mockAlarms.get.mockClear();

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

      expect(mockAlarms.get.mock.calls).toHaveLength(0);
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeDefined();
    });

    it("bails without recreating the auto-lock alarm or writing keepAlive if lock() completes mid-tick (N5)", async () => {
      seedWallet();
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
      unlock();
      alarmsStore.delete(LockManager.AUTO_LOCK_ALARM);

      const settingsGate = deferred<WalletSettings>();
      const getSettingsSpy = vi
        .spyOn(StorageUtil, "getSettings")
        .mockReturnValueOnce(settingsGate.promise);

      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      expect(getSettingsSpy).toHaveBeenCalledOnce();
      await LockManager.lock();
      settingsGate.resolve({ autoLockMinutes: 5 });
      await vi.advanceTimersByTimeAsync(0);

      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toBeUndefined();
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();

      getSettingsSpy.mockRestore();
    });

    it("stops a pending alarm read after a concurrent lock", async () => {
      seedWallet();
      unlock();
      const alarmGate = deferred<browser.Alarms.Alarm | undefined>();
      mockAlarms.get.mockReturnValueOnce(alarmGate.promise);
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      expect(mockAlarms.get.mock.calls).toHaveLength(1);

      await LockManager.lock();
      alarmGate.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockAlarms.create.mock.calls).toHaveLength(0);
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
    });

    it("waits for alarm creation and skips the timestamp after a concurrent lock", async () => {
      seedWallet();
      unlock();
      const creationGate = deferred<undefined>();
      mockCreateAlarm.mockReturnValueOnce(creationGate.promise);
      await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
      expect(mockCreateAlarm).toHaveBeenCalledOnce();
      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();

      await LockManager.lock();
      creationGate.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(false);
    });

    it.each(["settings", "alarm read", "alarm creation", "session write"])(
      "reports a failed %s and retries on the next tick",
      async (stage) => {
        seedWallet();
        unlock();
        const error = new Error("Simulated browser failure");
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        if (stage === "settings") {
          vi.spyOn(StorageUtil, "getSettings").mockRejectedValueOnce(error);
        } else if (stage === "alarm read") {
          mockAlarms.get.mockRejectedValueOnce(error);
        } else if (stage === "alarm creation") {
          mockCreateAlarm.mockRejectedValueOnce(error);
        } else {
          vi.mocked(browser.storage.session).set.mockRejectedValueOnce(error);
        }

        await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);

        expect(warning).toHaveBeenCalledExactlyOnceWith(
          "QrlWeb3Wallet: Keep-alive tick failed",
          error,
        );
        expect(
          sessionStore.get(profileStorageKey("keepAlive")),
        ).toBeUndefined();
        expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);

        await vi.advanceTimersByTimeAsync(LockManager.KEEP_ALIVE_INTERVAL_MS);
        expect(sessionStore.get(profileStorageKey("keepAlive"))).toBe(
          Date.now(),
        );
      },
    );
  });

  // ── lockManagerListener ───────────────────────────────────────────

  describe("lockManagerListener", () => {
    it.each([
      null,
      undefined,
      true,
      42,
      "LOCK_MANAGER_LOCK",
      [],
      { name: 42 },
      { name: null },
      Object.assign([], { name: LOCK_MANAGER_MESSAGES.LOCK }),
    ])("ignores an invalid message envelope (%j) synchronously", (message) => {
      unlock();
      vi.clearAllMocks();

      expect(
        LockManager.lockManagerListener(message, TRUSTED_SENDER),
      ).toBeUndefined();
      expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);
      expect(mockAlarms.create.mock.calls).toHaveLength(0);
      expect(vi.mocked(browser.storage.local).set.mock.calls).toHaveLength(0);
    });

    it("keeps the listener bound when registered as a callback", async () => {
      const listener = LockManager.lockManagerListener;
      await expect(
        listener(
          {
            name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
          },
          TRUSTED_SENDER,
        ),
      ).resolves.toEqual({ isLocked: true, hasPasswordSet: false });
    });

    describe.each([false, true])(
      "payload validation with an existing session: %s",
      (unlocked) => {
        beforeEach(() => {
          seedWallet();
          if (unlocked) unlock();
          vi.clearAllMocks();
        });

        const expectUnchanged = (stored: unknown) => {
          expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(stored);
          expect(LockManager.hasWalletPassword()).toBe(unlocked);
          if (unlocked) {
            expect(LockManager.getDecryptedKeys()).toEqual(MOCK_KEYS);
          } else {
            expect(() => LockManager.getDecryptedKeys()).toThrow(
              "MyQRLWallet is locked",
            );
          }
          for (const area of [browser.storage.local, browser.storage.session]) {
            expect(vi.mocked(area).set.mock.calls).toHaveLength(0);
            expect(vi.mocked(area).remove.mock.calls).toHaveLength(0);
            expect(vi.mocked(area).clear.mock.calls).toHaveLength(0);
          }
          expect(mockAlarms.create.mock.calls).toHaveLength(0);
          expect(encryptKeystore).not.toHaveBeenCalled();
        };

        it.each([
          { label: "missing data", data: undefined },
          { label: "null data", data: null },
          { label: "missing keys", data: { walletPassword: "pw" } },
          { label: "object keys", data: { keys: {}, walletPassword: "pw" } },
          { label: "null key", data: { keys: [null], walletPassword: "pw" } },
          {
            label: "sparse keys",
            data: { keys: new Array<unknown>(1), walletPassword: "pw" },
          },
          {
            label: "invalid address",
            data: {
              keys: [{ address: "invalid", mnemonicPhrases: "words" }],
              walletPassword: "pw",
            },
          },
          {
            label: "missing mnemonic",
            data: { keys: [{ address: KEY_B.address }], walletPassword: "pw" },
          },
          {
            label: "numeric mnemonic",
            data: {
              keys: [{ address: KEY_B.address, mnemonicPhrases: 42 }],
              walletPassword: "pw",
            },
          },
          { label: "missing password", data: { keys: MOCK_KEYS } },
          {
            label: "numeric password",
            data: { keys: MOCK_KEYS, walletPassword: 42 },
          },
          {
            label: "object password",
            data: { keys: MOCK_KEYS, walletPassword: {} },
          },
        ])(
          "rejects SET_DECRYPTED_KEYS with $label before changing state",
          async ({ data }) => {
            const stored = localStore.get(profileStorageKey("KEYSTORES"));
            await expect(
              LockManager.lockManagerListener(
                {
                  name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
                  data,
                },
                TRUSTED_SENDER,
              ),
            ).rejects.toThrow();
            expectUnchanged(stored);
          },
        );

        it.each([
          { label: "missing data", data: undefined },
          { label: "null data", data: null },
          { label: "array data", data: [] },
          { label: "missing seed", data: { password: "pw" } },
          { label: "numeric seed", data: { seed: 42, password: "pw" } },
          {
            label: "byte-array seed",
            data: { seed: new Uint8Array(51), password: "pw" },
          },
          { label: "null password", data: { seed: "0xseed", password: null } },
          { label: "numeric password", data: { seed: "0xseed", password: 42 } },
        ])(
          "rejects ENCRYPT_ACCOUNT with $label before writing",
          async ({ data }) => {
            const stored = localStore.get(profileStorageKey("KEYSTORES"));
            await expect(
              LockManager.lockManagerListener(
                {
                  name: LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT,
                  data,
                },
                TRUSTED_SENDER,
              ),
            ).rejects.toThrow("Invalid account encryption payload");
            expectUnchanged(stored);
          },
        );
      },
    );

    it("accepts synchronous alarm creation", async () => {
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
      mockCreateAlarm.mockImplementationOnce((name, info) => {
        alarmsStore.set(name, info);
      });

      await expect(LockManager.setupAutoLockAlarm()).resolves.toBeUndefined();
      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toEqual({
        delayInMinutes: 5,
      });
    });

    it("waits for alarm creation before acknowledging a handled message", async () => {
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
      unlock();
      const creationGate = deferred<undefined>();
      mockCreateAlarm.mockReturnValueOnce(creationGate.promise);
      let acknowledged = false;
      const response = LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK,
        },
        TRUSTED_SENDER,
      );
      if (!response) throw new Error("Expected an owned message response");
      const completion = response.then((result) => {
        acknowledged = true;
        return result;
      });

      await vi.waitFor(() => {
        expect(mockCreateAlarm).toHaveBeenCalledOnce();
      });
      expect(acknowledged).toBe(false);
      creationGate.resolve(undefined);
      await expect(completion).resolves.toEqual({ success: true });
      expect(mockCreateAlarm).toHaveBeenCalledTimes(2);
    });

    it("propagates alarm failures through handled message responses", async () => {
      unlock();
      const error = new Error("Alarm creation failed");
      mockCreateAlarm.mockRejectedValueOnce(error);

      await expect(
        LockManager.lockManagerListener(
          {
            name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY,
          },
          TRUSTED_SENDER,
        ),
      ).rejects.toBe(error);
    });

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
          },
        );

        expect(result).toBeUndefined();
      });

      it("ignores the content-script keep-alive: own extension id, web page url", async () => {
        const setupAutoLockAlarm = vi.spyOn(LockManager, "setupAutoLockAlarm");

        const result = await LockManager.lockManagerListener(
          { name: "myqrlwallet-content-script-keep-alive" },
          {
            id: "mock-extension-id",
            url: "https://dapp.example/swap",
          },
        );

        expect(result).toBeUndefined();
        expect(setupAutoLockAlarm).not.toHaveBeenCalled();
        setupAutoLockAlarm.mockRestore();
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
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 10 });

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
          data: { keys: MOCK_KEYS, walletPassword: "pw" },
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual({ success: true });
      expect(LockManager.isKeepAliveIntervalRunning()).toBe(true);
      expect(alarmsStore.get(LockManager.AUTO_LOCK_ALARM)).toEqual({
        delayInMinutes: 10,
      });
    });

    it("GET_DECRYPTED_KEY_FOR_ADDRESS returns only the requested key", async () => {
      unlock([MOCK_KEYS[0], KEY_B]);

      const result = await LockManager.lockManagerListener(
        {
          name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEY_FOR_ADDRESS,
          data: KEY_B.address,
        },
        TRUSTED_SENDER,
      );

      expect(result).toEqual(KEY_B);
    });

    describe("HAS_WALLET_PASSWORD", () => {
      it("answers { hasPassword: false } on a locked worker", async () => {
        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.HAS_WALLET_PASSWORD },
          TRUSTED_SENDER,
        );

        expect(result).toEqual({ hasPassword: false });
      });

      it("answers { hasPassword: true } once unlocked, and nothing else", async () => {
        unlock(MOCK_KEYS, "super-secret-pw");

        const result = await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.HAS_WALLET_PASSWORD },
          TRUSTED_SENDER,
        );

        expect(result).toEqual({ hasPassword: true });
        // The password value is nowhere in the response: the boolean is
        // the whole answer.
        expect(JSON.stringify(result)).not.toContain("super-secret-pw");
      });

      it("does NOT reset the auto-lock timer: it is a read", async () => {
        localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
        seedWallet();
        unlock();
        mockAlarms.create.mockClear();

        await LockManager.lockManagerListener(
          { name: LOCK_MANAGER_MESSAGES.HAS_WALLET_PASSWORD },
          TRUSTED_SENDER,
        );

        expect(mockAlarms.create).not.toHaveBeenCalled();
      });
    });

    it("GET_WALLET_PASSWORD is not a message this listener answers any more", async () => {
      // The plaintext-password read is gone: the surfaces that used it now
      // probe HAS_WALLET_PASSWORD and let the worker encrypt with the
      // password it already holds. An unknown message name falls through
      // with no result and no secret anywhere in the response.
      unlock(MOCK_KEYS, "super-secret-pw");

      const result = await LockManager.lockManagerListener(
        { name: "GET_WALLET_PASSWORD" },
        TRUSTED_SENDER,
      );

      expect(result).toBeUndefined();
    });

    it("GET_DECRYPTED_KEYS is not a message this listener answers (L3)", async () => {
      // The whole-keyring read is gone: every caller now goes through
      // GET_DECRYPTED_KEY_FOR_ADDRESS, one account at a time. An unknown
      // message name simply falls through with no result and no key
      // material anywhere in the response.
      unlock([MOCK_KEYS[0], KEY_B]);

      const result = await LockManager.lockManagerListener(
        { name: "GET_DECRYPTED_KEYS" },
        TRUSTED_SENDER,
      );

      expect(result).toBeUndefined();
    });

    describe("auto-lock activity semantics (F2)", () => {
      beforeEach(() => {
        localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
        seedWallet();
        unlock();
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
        // The listener answers undefined for this one so the approval
        // middleware keeps the reply, and postpones the timer alongside, so
        // the assertion waits for that to land.
        expect(
          LockManager.lockManagerListener(
            { action: "QRL_WALLET_DAPP_RESPONSE", data: { hasApproved: true } },
            TRUSTED_SENDER,
          ),
        ).toBeUndefined();

        await vi.waitFor(() => {
          expect(mockAlarms.create).toHaveBeenCalledWith(
            LockManager.AUTO_LOCK_ALARM,
            { delayInMinutes: 5 },
          );
        });
      });

      it("reports approval timer failures while leaving the reply to the approval listener", async () => {
        const error = new Error("Alarm creation failed");
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockCreateAlarm.mockRejectedValueOnce(error);

        expect(
          LockManager.lockManagerListener(
            {
              action: "QRL_WALLET_DAPP_RESPONSE",
              data: { hasApproved: true },
            },
            TRUSTED_SENDER,
          ),
        ).toBeUndefined();

        await vi.waitFor(() => {
          expect(warning).toHaveBeenCalledExactlyOnceWith(
            "QrlWeb3Wallet: Auto-lock activity update failed",
            error,
          );
        });
      });

      it("answers undefined for a message it does not own, leaving the reply to its owner", () => {
        // An async listener supplies the single reply browser.runtime
        // delivers, which would steal the approval middleware's in-progress
        // acknowledgement.
        expect(
          LockManager.lockManagerListener(
            {
              action: "QRL_WALLET_DAPP_REQUEST_IN_PROGRESS",
              data: { requestId: "request-a" },
            },
            TRUSTED_SENDER,
          ),
        ).toBeUndefined();
        expect(
          LockManager.lockManagerListener(
            { name: "SOME_OTHER_EXTENSION_MESSAGE" },
            TRUSTED_SENDER,
          ),
        ).toBeUndefined();
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
      localStore.set(profileStorageKey("SETTINGS"), { autoLockMinutes: 5 });
      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener(
        { name: LOCK_MANAGER_MESSAGES.USER_ACTIVITY },
        TRUSTED_SENDER,
      );

      expect(mockAlarms.create).not.toHaveBeenCalled();
    });
  });
});
