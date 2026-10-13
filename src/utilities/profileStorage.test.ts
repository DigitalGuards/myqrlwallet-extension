import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { toChecksumAddress } from "@theqrl/wallet.js";
import type { KeyStore } from "@theqrl/web3";
import { malformed } from "@/test-utils/malformed";
import StorageUtil from "./storageUtil";
import {
  profileStorageKey,
  walletLocalStorage,
  walletSessionStorage,
} from "./profileStorage";

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const legacyAddress = `Q${"a".repeat(40)}`;
const v3Address = toChecksumAddress(`Q${"b".repeat(128)}`);
const v3Keystore: KeyStore = {
  id: "profile-storage-test",
  version: 1,
  address: v3Address,
  crypto: {
    cipher: "aes-256-gcm",
    ciphertext: "00",
    cipherparams: { iv: "00".repeat(12) },
    kdf: "argon2id",
    kdfparams: { m: 262144, t: 8, p: 1, dklen: 32, salt: "00".repeat(32) },
  },
};

beforeEach(() => {
  for (const store of [local, session])
    for (const key of Object.keys(store)) Reflect.deleteProperty(store, key);
  for (const [area, store] of [
    [browser.storage.local, local],
    [browser.storage.session, session],
  ] as const) {
    vi.spyOn(area, "get").mockImplementation((key) =>
      Promise.resolve(
        key === null
          ? { ...store }
          : typeof key === "string" && key in store
            ? { [key]: store[key] }
            : {},
      ),
    );
    vi.spyOn(area, "set").mockImplementation((values) => {
      Object.assign(store, values);
      return Promise.resolve();
    });
    vi.spyOn(area, "remove").mockImplementation((keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys)
        Reflect.deleteProperty(store, key);
      return Promise.resolve();
    });
  }
});

describe("v3 storage isolation", () => {
  it("keeps existing v2 identity, settings, permissions and keystores through v3 create and reset", async () => {
    const legacy = {
      KEYSTORES: JSON.stringify([
        { address: legacyAddress, crypto: { ciphertext: "preserved" } },
      ]),
      ACCOUNTS: {
        ALL_ACCOUNTS: [legacyAddress],
        ACTIVE_ACCOUNT: legacyAddress,
      },
      SETTINGS: { themePreference: "light" },
      DAPPS: {
        ALL_DAPPS: { "https://dapp.example": { accounts: [legacyAddress] } },
      },
      BLOCKCHAINS: { ACTIVE_BLOCKCHAIN: "0x539" },
    };
    Object.assign(local, structuredClone(legacy));
    expect(await StorageUtil.getKeystores()).toEqual([]);
    expect(await StorageUtil.getAllAccounts()).toEqual([]);
    expect(await StorageUtil.getActiveAccount()).toBe("");
    expect(await StorageUtil.getSettings()).toEqual({});
    expect(await StorageUtil.getActiveBlockChain()).toMatchObject({
      chainId: "0x301825",
    });
    await StorageUtil.setKeystores([v3Keystore]);
    await StorageUtil.setAllAccounts([v3Address]);
    await StorageUtil.setActiveAccount(v3Address);
    expect(await StorageUtil.getAllAccounts()).toEqual([v3Address]);
    expect(local[profileStorageKey("KEYSTORES")]).toBeDefined();
    await StorageUtil.clearAllData();
    expect(local).toEqual(legacy);
  });

  it("isolates pending approvals and session keys", async () => {
    session._LM_CACHED_KEYS = [{ address: legacyAddress }];
    session.DAPPS = { requestId: "legacy" };
    await walletSessionStorage.set({
      _LM_CACHED_KEYS: [{ address: v3Address }],
      DAPPS: { requestId: "v3" },
    });
    expect(await walletSessionStorage.get("_LM_CACHED_KEYS")).toEqual({
      _LM_CACHED_KEYS: [{ address: v3Address }],
    });
    await walletSessionStorage.clear();
    expect(session).toEqual({
      _LM_CACHED_KEYS: [{ address: legacyAddress }],
      DAPPS: { requestId: "legacy" },
    });
  });

  it("reads and writes opaque records with their contents and order intact", async () => {
    const records = [{ future: [null, 42] }, "second", null];
    local.UNRELATED = { accounts: ["second", "first"] };
    const get = vi.spyOn(browser.storage.local, "get");
    const set = vi.spyOn(browser.storage.local, "set");

    await walletLocalStorage.set({ RECORDS: records, EMPTY: undefined });
    expect(set).toHaveBeenCalledExactlyOnceWith({
      [profileStorageKey("RECORDS")]: records,
      [profileStorageKey("EMPTY")]: undefined,
    });
    expect(await walletLocalStorage.get("RECORDS")).toEqual({
      RECORDS: records,
    });
    expect(get).toHaveBeenNthCalledWith(1, profileStorageKey("RECORDS"));
    expect(await walletLocalStorage.get("EMPTY")).toEqual({ EMPTY: undefined });
    expect(await walletLocalStorage.get("MISSING")).toEqual({});
    expect(local.UNRELATED).toEqual({ accounts: ["second", "first"] });
    expect(local[profileStorageKey("RECORDS")]).toBe(records);
  });

  it("reads only own prefixed properties", async () => {
    const inherited = { [profileStorageKey("RECORDS")]: ["inherited"] };
    const result: Record<string, unknown> = {};
    Object.setPrototypeOf(result, inherited);
    vi.spyOn(browser.storage.local, "get").mockResolvedValue(result);

    expect(await walletLocalStorage.get("RECORDS")).toEqual({});
  });

  it("removes only the requested prefixed key", async () => {
    local.RECORDS = ["legacy"];
    local[profileStorageKey("RECORDS")] = ["current"];
    local[profileStorageKey("OTHER")] = ["preserved"];
    const remove = vi.spyOn(browser.storage.local, "remove");

    await walletLocalStorage.remove("RECORDS");

    expect(remove).toHaveBeenCalledExactlyOnceWith(
      profileStorageKey("RECORDS"),
    );
    expect(local).toEqual({
      RECORDS: ["legacy"],
      [profileStorageKey("OTHER")]: ["preserved"],
    });
  });

  it("clears prefixed keys in storage order and preserves other profiles", async () => {
    const otherProfiles = {
      LEGACY: ["second", "first"],
      "v3:another-chain:RECORDS": { unknown: true },
    };
    Object.assign(local, otherProfiles, {
      [profileStorageKey("SECOND")]: [2],
      [profileStorageKey("FIRST")]: [1],
    });
    const get = vi.spyOn(browser.storage.local, "get");
    const remove = vi.spyOn(browser.storage.local, "remove");

    await walletLocalStorage.clear();

    expect(get).toHaveBeenCalledExactlyOnceWith(null);
    expect(remove).toHaveBeenCalledExactlyOnceWith([
      profileStorageKey("SECOND"),
      profileStorageKey("FIRST"),
    ]);
    expect(local).toEqual(otherProfiles);
  });

  it("skips removal when a profile has no keys", async () => {
    local.UNRELATED = ["preserved"];
    const remove = vi.spyOn(browser.storage.local, "remove");

    await walletLocalStorage.clear();

    expect(remove).not.toHaveBeenCalled();
    expect(local).toEqual({ UNRELATED: ["preserved"] });
  });

  it.each([null, undefined, [], "invalid", 42])(
    "rejects a malformed storage envelope before reading or clearing (%j)",
    async (stored) => {
      local[profileStorageKey("RECORDS")] = ["preserved"];
      vi.spyOn(browser.storage.local, "get").mockResolvedValue(
        malformed(stored),
      );
      const set = vi.spyOn(browser.storage.local, "set");
      const remove = vi.spyOn(browser.storage.local, "remove");

      await expect(walletLocalStorage.get("RECORDS")).rejects.toThrow(
        "Invalid browser storage response",
      );
      await expect(walletLocalStorage.clear()).rejects.toThrow(
        "Invalid browser storage response",
      );
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(local[profileStorageKey("RECORDS")]).toEqual(["preserved"]);
    },
  );

  it("propagates storage failures to callers", async () => {
    const error = new Error("Storage unavailable");
    vi.spyOn(browser.storage.local, "get").mockRejectedValueOnce(error);
    await expect(walletLocalStorage.get("RECORDS")).rejects.toBe(error);
    vi.spyOn(browser.storage.local, "get").mockRejectedValueOnce(error);
    await expect(walletLocalStorage.clear()).rejects.toBe(error);
    vi.spyOn(browser.storage.local, "set").mockRejectedValueOnce(error);
    await expect(walletLocalStorage.set({ RECORDS: [] })).rejects.toBe(error);
    vi.spyOn(browser.storage.local, "remove").mockRejectedValueOnce(error);
    await expect(walletLocalStorage.remove("RECORDS")).rejects.toBe(error);
  });
});
