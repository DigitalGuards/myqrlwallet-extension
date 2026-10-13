import { beforeEach, describe, expect, it, vi } from "vitest";
import { QRL_BLOCKCHAINS } from "@/configuration/qrlBlockchainConfig";
import StorageUtil from "./storageUtil";
import {
  ACCOUNT,
  OTHER_ACCOUNT,
  CHAIN,
  TOKEN,
  NFT,
  HISTORY,
  CONNECTION,
  LEDGER,
} from "./__mocks__/storageFixtures";

// JSON serialization matches Chrome storage, including NaN becoming null.
const h = vi.hoisted(() => {
  const store: Record<string, any> = {};
  const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));
  const local = {
    get: vi.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(store, key)
        ? { [key]: roundTrip(store[key]) }
        : {},
    ),
    set: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(store, roundTrip(value));
    }),
    remove: vi.fn(async (key: string) => {
      delete store[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(store)) delete store[key];
    }),
  };
  return { store, local, roundTrip };
});
vi.mock("@/utilities/profileStorage", () => ({
  walletLocalStorage: h.local,
  walletSessionStorage: h.local,
}));

const setList = (
  root: string,
  all: string,
  field: string,
  records: unknown,
) => {
  h.store[root] = {
    metadata: "keep",
    [all]: {
      [ACCOUNT]: {
        [CHAIN.chainId]: { metadata: "keep", [field]: h.roundTrip(records) },
        otherChain: { keep: true },
      },
      [OTHER_ACCOUNT]: { keep: true },
    },
  };
};
const list = (root: string, all: string, field: string): unknown[] =>
  h.store[root][all][ACCOUNT][CHAIN.chainId][field];
const bytes = (value: unknown) => JSON.stringify(value);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.store)) delete h.store[key];
  h.store.BLOCKCHAINS = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
});

describe("storage writes preserve raw records", () => {
  it("preserves unreadable map entries when saving visible labels and hidden accounts", async () => {
    const opaque = { future: [null, false] };
    h.store.ACCOUNT_LABELS = { [ACCOUNT]: "First", opaque };
    await StorageUtil.setAccountLabels({
      ...(await StorageUtil.getAccountLabels()),
      [OTHER_ACCOUNT]: "Second",
    });
    expect(h.store.ACCOUNT_LABELS).toEqual({
      [ACCOUNT]: "First",
      opaque,
      [OTHER_ACCOUNT]: "Second",
    });
    h.store.HIDDEN_ACCOUNTS = { [ACCOUNT]: false, opaque };
    await StorageUtil.setHiddenAccounts({
      ...(await StorageUtil.getHiddenAccounts()),
      [OTHER_ACCOUNT]: true,
    });
    expect(h.store.HIDDEN_ACCOUNTS).toEqual({
      [ACCOUNT]: false,
      opaque,
      [OTHER_ACCOUNT]: true,
    });
  });
  it.each([CHAIN, { ...CHAIN, nativeCurrency: null }])(
    "retains dApp chains through read, save, edit and delete (%j)",
    async (chain) => {
      const unusable = {
        chainId: "future-chain",
        future: [null, { keep: true }],
      };
      const second = { ...CHAIN, chainId: "0x2b", chainName: "Second" };
      const raw = [chain, unusable, second, null];
      h.store.BLOCKCHAINS.ALL_BLOCKCHAINS = h.roundTrip(raw);
      expect(await StorageUtil.getAllBlockChains()).toEqual([chain, second]);
      expect(await StorageUtil.getActiveBlockChain()).toEqual(chain);
      expect(h.local.set).not.toHaveBeenCalled();
      await StorageUtil.setAllBlockChains(
        await StorageUtil.getAllBlockChains(),
      );
      expect(bytes(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS)).toBe(bytes(raw));
      await StorageUtil.setAllBlockChains(
        (await StorageUtil.getAllBlockChains()).map((c) =>
          c.chainId === second.chainId ? { ...c, chainName: "Edited" } : c,
        ),
      );
      expect(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS).toEqual([
        chain,
        unusable,
        { ...second, chainName: "Edited" },
        null,
      ]);
      await StorageUtil.setAllBlockChains(
        (await StorageUtil.getAllBlockChains()).filter(
          (c) => c.chainId !== chain.chainId,
        ),
      );
      expect(bytes(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS)).toBe(
        bytes([unusable, { ...second, chainName: "Edited" }, null]),
      );
      expect(await StorageUtil.getAllBlockChains()).toEqual([
        { ...second, chainName: "Edited" },
      ]);
    },
  );

  it("keeps arrays with zero usable chains as arrays through a save", async () => {
    const raw = [null, { future: "chain" }];
    h.store.BLOCKCHAINS.ALL_BLOCKCHAINS = raw;
    expect(await StorageUtil.getAllBlockChains()).toEqual([]);
    await StorageUtil.setAllBlockChains(await StorageUtil.getAllBlockChains());
    expect(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS).toEqual(raw);
    await StorageUtil.setAllBlockChains([CHAIN]);
    expect(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS).toEqual([...raw, CHAIN]);
    expect(await StorageUtil.getAllBlockChains()).toEqual([CHAIN]);
  });

  it("uses the chain default for a non-array, warns once and permits replacement", async () => {
    const warn = vi.spyOn(console, "warn");
    h.store.BLOCKCHAINS.ALL_BLOCKCHAINS = { corrupt: true };
    expect(await StorageUtil.getAllBlockChains()).toEqual(QRL_BLOCKCHAINS);
    expect(await StorageUtil.getAllBlockChains()).toEqual(QRL_BLOCKCHAINS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.store.BLOCKCHAINS.ALL_BLOCKCHAINS).toEqual({ corrupt: true });
    await StorageUtil.setAllBlockChains([CHAIN]);
    expect(await StorageUtil.getAllBlockChains()).toEqual([CHAIN]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preserves tokens with serialized NaN decimals and unusable siblings on import, replacement and removal", async () => {
    const nullable = { ...TOKEN, address: "token-null", decimals: Number.NaN };
    const junk = { address: "future-token", decimals: "future", future: true };
    const raw = h.roundTrip([TOKEN, junk, nullable, null, 7]);
    setList("TOKENS", "ALL_TOKENS", "tokens", raw);
    expect(await StorageUtil.getTokenContractsList(ACCOUNT)).toEqual([
      TOKEN,
      { ...nullable, decimals: null },
    ]);
    expect(h.local.set).not.toHaveBeenCalled();
    const added = { ...TOKEN, address: "token-new" };
    await StorageUtil.setTokenContractsList(ACCOUNT, added);
    expect(bytes(list("TOKENS", "ALL_TOKENS", "tokens"))).toBe(
      bytes([...raw, added]),
    );
    await StorageUtil.setTokenContractsList(ACCOUNT, {
      ...TOKEN,
      symbol: "UPDATED",
    });
    expect(bytes(list("TOKENS", "ALL_TOKENS", "tokens"))).toBe(
      bytes([...raw.slice(1), added, { ...TOKEN, symbol: "UPDATED" }]),
    );
    await StorageUtil.clearFromTokenContractsList(ACCOUNT, added.address);
    expect(bytes(list("TOKENS", "ALL_TOKENS", "tokens"))).toBe(
      bytes([...raw.slice(1), { ...TOKEN, symbol: "UPDATED" }]),
    );
    expect(await StorageUtil.getTokenContractsList(ACCOUNT)).toEqual([
      { ...nullable, decimals: null },
      { ...TOKEN, symbol: "UPDATED" },
    ]);
    expect(h.store.TOKENS.ALL_TOKENS[OTHER_ACCOUNT]).toEqual({ keep: true });
    expect(h.store.TOKENS.ALL_TOKENS[ACCOUNT].otherChain).toEqual({
      keep: true,
    });
    expect(h.store.TOKENS.metadata).toBe("keep");
  });

  it("preserves unreadable NFT collections through import, replacement, removal and re-read", async () => {
    const junk = {
      ...NFT,
      address: "nft-future",
      standard: "future",
      future: { keep: true },
    };
    const raw = [NFT, junk, null];
    setList("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections", raw);
    expect(await StorageUtil.getNFTCollectionsList(ACCOUNT)).toEqual([NFT]);
    expect(h.local.set).not.toHaveBeenCalled();
    const added = { ...NFT, address: "nft-new", standard: "ZRC1155" as const };
    await StorageUtil.setNFTCollectionsList(ACCOUNT, added);
    expect(
      bytes(list("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections")),
    ).toBe(bytes([...raw, added]));
    await StorageUtil.setNFTCollectionsList(ACCOUNT, {
      ...NFT,
      name: "Updated",
    });
    expect(
      bytes(list("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections")),
    ).toBe(bytes([junk, null, added, { ...NFT, name: "Updated" }]));
    await StorageUtil.clearFromNFTCollectionsList(ACCOUNT, added.address);
    expect(
      bytes(list("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections")),
    ).toBe(bytes([junk, null, { ...NFT, name: "Updated" }]));
    expect(await StorageUtil.getNFTCollectionsList(ACCOUNT)).toEqual([
      { ...NFT, name: "Updated" },
    ]);
  });

  it("preserves raw history during receipt updates and new sends, including null decimals", async () => {
    const nullable = {
      ...HISTORY,
      id: "nullable",
      transactionHash: "nullable",
      tokenDecimals: null,
    };
    const junk = {
      transactionHash: "future",
      pendingStatus: "future",
      extension: [1, 2],
    };
    const raw = [HISTORY, junk, nullable, null];
    setList("TX_HISTORY", "ALL_TX_HISTORY", "transactions", raw);
    expect(await StorageUtil.getTransactionHistory(ACCOUNT)).toEqual([
      HISTORY,
      nullable,
    ]);
    expect(h.local.set).not.toHaveBeenCalled();
    const update = {
      pendingStatus: "confirmed" as const,
      status: true,
      blockNumber: "7",
      receiptStatusVerified: true,
    };
    await StorageUtil.updateTransactionHistoryEntry(
      ACCOUNT,
      HISTORY.transactionHash,
      update,
    );
    const updated = [{ ...HISTORY, ...update }, junk, nullable, null];
    expect(bytes(list("TX_HISTORY", "ALL_TX_HISTORY", "transactions"))).toBe(
      bytes(updated),
    );
    const added = { ...HISTORY, id: "new", transactionHash: "new" };
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, added);
    expect(bytes(list("TX_HISTORY", "ALL_TX_HISTORY", "transactions"))).toBe(
      bytes([added, ...updated]),
    );
    expect(await StorageUtil.getTransactionHistory(ACCOUNT)).toEqual([
      added,
      { ...HISTORY, ...update },
      nullable,
    ]);
    await StorageUtil.updateTransactionHistoryEntry(ACCOUNT, "future", update);
    expect(bytes(list("TX_HISTORY", "ALL_TX_HISTORY", "transactions"))).toBe(
      bytes([added, ...updated]),
    );
  });

  it("keeps unreadable history and caps only the readable entries", async () => {
    const full = Array.from(
      { length: StorageUtil.TX_HISTORY_MAX_PER_ACCOUNT_CHAIN },
      (_, i) => ({ ...HISTORY, id: `hash-${i}`, transactionHash: `hash-${i}` }),
    );
    const junk = { future: "history" };
    setList("TX_HISTORY", "ALL_TX_HISTORY", "transactions", [
      junk,
      ...full,
      null,
    ]);
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    // 1,001 readable entries: the oldest readable one goes, both raw records stay.
    expect(bytes(list("TX_HISTORY", "ALL_TX_HISTORY", "transactions"))).toBe(
      bytes([HISTORY, junk, ...full.slice(0, -1), null]),
    );
    setList("TX_HISTORY", "ALL_TX_HISTORY", "transactions", full);
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    expect(list("TX_HISTORY", "ALL_TX_HISTORY", "transactions")).toEqual(
      [HISTORY, ...full].slice(0, 1000),
    );
  });

  it("changes only parseable dApp records containing the removed account", async () => {
    const untouched = {
      ...CONNECTION,
      accounts: [OTHER_ACCOUNT],
      extension: { keep: [null] },
    };
    const invalid = { ...CONNECTION, permissions: [{ future: true }] };
    const records = {
      [CONNECTION.urlOrigin]: CONNECTION,
      unrelated: untouched,
      unreadable: invalid,
      junk: null,
    };
    h.store.DAPPS = { ALL_DAPPS: h.roundTrip(records) };
    expect(
      await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin),
    ).toEqual(CONNECTION);
    expect(
      await StorageUtil.getDAppsConnectedAccountsData("unreadable"),
    ).toBeUndefined();
    const before = bytes(h.store.DAPPS);
    await StorageUtil.removeAccountFromAllDApps(`Q${"c".repeat(128)}`);
    expect(bytes(h.store.DAPPS)).toBe(before);
    expect(h.local.set).not.toHaveBeenCalled();
    await StorageUtil.removeAccountFromAllDApps(ACCOUNT.toLowerCase());
    const changed = await StorageUtil.getDAppsConnectedAccountsData(
      CONNECTION.urlOrigin,
    );
    expect(changed?.accounts).toEqual([OTHER_ACCOUNT]);
    expect(changed?.permissions[0].caveats[0].value).toEqual([OTHER_ACCOUNT]);
    for (const key of ["unrelated", "unreadable", "junk"] as const)
      expect(bytes(h.store.DAPPS.ALL_DAPPS[key])).toBe(bytes(records[key]));
    await StorageUtil.removeAccountFromAllDApps(OTHER_ACCOUNT);
    expect(
      await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin),
    ).toBeUndefined();
    expect(bytes(h.store.DAPPS.ALL_DAPPS.unreadable)).toBe(bytes(invalid));
  });

  it("retains unreadable accounts, contacts and Ledger records across bulk saves", async () => {
    const junk = { future: true };
    const legacy = `Q${"d".repeat(40)}`;
    h.store.ACCOUNTS = { ALL_ACCOUNTS: [ACCOUNT, junk, legacy] };
    await StorageUtil.addLedgerAccountToAllAccounts(OTHER_ACCOUNT);
    expect(h.store.ACCOUNTS.ALL_ACCOUNTS).toEqual([
      ACCOUNT,
      junk,
      legacy,
      OTHER_ACCOUNT,
    ]);
    await StorageUtil.removeLedgerAccountFromAllAccounts(ACCOUNT);
    expect(h.store.ACCOUNTS.ALL_ACCOUNTS).toEqual([
      junk,
      legacy,
      OTHER_ACCOUNT,
    ]);
    const contact = { name: "Known", address: ACCOUNT };
    h.store.CONTACTS = { ALL_CONTACTS: [contact, junk] };
    await StorageUtil.setContacts(await StorageUtil.getContacts());
    expect(h.store.CONTACTS.ALL_CONTACTS).toEqual([contact, junk]);
    h.store.LEDGER = { LEDGER_ACCOUNTS: [LEDGER, junk] };
    await StorageUtil.setLedgerAccounts(await StorageUtil.getLedgerAccounts());
    expect(h.store.LEDGER.LEDGER_ACCOUNTS).toEqual([LEDGER, junk]);
  });

  it.each(["__proto__", "constructor"])(
    "treats %s as an own storage key",
    async (key) => {
      const prototypeBefore = Object.getOwnPropertyDescriptors(
        Object.prototype,
      );
      await StorageUtil.setTokenContractsList(key, TOKEN);
      expect(
        Object.prototype.hasOwnProperty.call(h.store.TOKENS.ALL_TOKENS, key),
      ).toBe(true);
      expect(await StorageUtil.getTokenContractsList(key)).toEqual([TOKEN]);
      await StorageUtil.clearFromTokenContractsList(key, TOKEN.address);
      expect(await StorageUtil.getTokenContractsList(key)).toEqual([]);
      expect(
        await StorageUtil.getDAppsConnectedAccountsData(key),
      ).toBeUndefined();
      await StorageUtil.setDAppsConnectedAccountsData({
        ...CONNECTION,
        urlOrigin: key,
      });
      expect(
        (await StorageUtil.getDAppsConnectedAccountsData(key))?.accounts,
      ).toEqual(CONNECTION.accounts);
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      expect(
        (await StorageUtil.getDAppsConnectedAccountsData(key))?.accounts,
      ).toEqual([OTHER_ACCOUNT]);
      await StorageUtil.clearDAppsConnectedAccountsData(key);
      expect(
        Object.prototype.hasOwnProperty.call(h.store.DAPPS.ALL_DAPPS, key),
      ).toBe(false);
      h.store.ACCOUNT_LABELS = { opaque: { keep: true } };
      await StorageUtil.setAccountLabel(key, "Label");
      expect(
        Object.prototype.hasOwnProperty.call(
          await StorageUtil.getAccountLabels(),
          key,
        ),
      ).toBe(true);
      expect(h.store.ACCOUNT_LABELS.opaque).toEqual({ keep: true });
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
        prototypeBefore,
      );
    },
  );
});
