import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { toChecksumAddress } from "@theqrl/wallet.js";
import StorageUtil from "./storageUtil";
import { profileStorageKey, walletSessionStorage } from "./profileStorage";

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const legacyAddress = `Q${"a".repeat(40)}`;
const v3Address = toChecksumAddress(`Q${"b".repeat(128)}`);

beforeEach(() => {
  for (const store of [local, session])
    for (const key of Object.keys(store)) delete store[key];
  for (const [area, store] of [
    [browser.storage.local, local],
    [browser.storage.session, session],
  ] as const) {
    vi.mocked(area.get).mockImplementation(async (key) =>
      key === null
        ? { ...store }
        : typeof key === "string" && key in store
          ? { [key]: store[key] }
          : {},
    );
    vi.mocked(area.set).mockImplementation(async (values) => {
      Object.assign(store, values);
    });
    vi.mocked(area.remove).mockImplementation(async (keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys)
        delete store[key];
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
    await StorageUtil.setKeystores([{ address: v3Address } as never]);
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
});
