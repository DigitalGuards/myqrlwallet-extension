import { beforeEach, describe, expect, it, vi } from "vitest";
import { QRL_BLOCKCHAINS } from "@/configuration/qrlBlockchainConfig";
import PriceStore from "@/stores/priceStore";
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
  const store: Record<string, unknown> = {};
  const roundTrip = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value));
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

const isFixtureRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const storedRecord = (...keys: string[]): Record<string, unknown> => {
  let record = h.store;
  for (const key of keys) {
    const value = record[key];
    if (
      !Object.prototype.hasOwnProperty.call(record, key) ||
      !isFixtureRecord(value)
    ) {
      throw new Error(`Expected a stored record at ${keys.join(".")}`);
    }
    record = value;
  }
  return record;
};

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
const list = (root: string, all: string, field: string): unknown[] => {
  const records = storedRecord(root, all, ACCOUNT, CHAIN.chainId)[field];
  if (!Array.isArray(records))
    throw new Error(`Expected a stored ${field} list`);
  return records;
};
const bytes = (value: unknown) => JSON.stringify(value);
const addressForms = [
  ["Q", ACCOUNT],
  ["lowercase q", ACCOUNT.toLowerCase()],
  ["checksummed q", `q${ACCOUNT.slice(1)}`],
  ["0x", `0x${ACCOUNT.slice(1)}`],
  ["0X", `0X${ACCOUNT.slice(1)}`],
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.store)) delete h.store[key];
  h.store.BLOCKCHAINS = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
});

describe("storage writes preserve raw records", () => {
  it.each(addressForms)(
    "saves and removes %s accounts while retaining unreadable siblings in order",
    async (_form, address) => {
      const junk = { future: [null, false] };
      const legacy = `Q${"d".repeat(40)}`;
      h.store.ACCOUNTS = {
        ALL_ACCOUNTS: [address, junk, OTHER_ACCOUNT, legacy, null],
      };
      const accounts = await StorageUtil.getAllAccounts();
      expect(accounts).toEqual([ACCOUNT, OTHER_ACCOUNT]);
      expect(h.local.set).not.toHaveBeenCalled();
      await StorageUtil.setAllAccounts(accounts);
      expect(bytes(storedRecord("ACCOUNTS").ALL_ACCOUNTS)).toBe(
        bytes([ACCOUNT, junk, OTHER_ACCOUNT, legacy, null]),
      );
      // Remove directly from the original compatibility form as well.
      h.store.ACCOUNTS = {
        ALL_ACCOUNTS: [address, junk, OTHER_ACCOUNT, legacy, null],
      };
      await StorageUtil.setAllAccounts(
        accounts.filter((item) => item !== ACCOUNT),
      );
      expect(bytes(storedRecord("ACCOUNTS").ALL_ACCOUNTS)).toBe(
        bytes([junk, OTHER_ACCOUNT, legacy, null]),
      );
      expect(await StorageUtil.getAllAccounts()).toEqual([OTHER_ACCOUNT]);
    },
  );

  it.each(addressForms)(
    "removes the visible %s account together with its keystore",
    async (_form, address) => {
      h.store.ACCOUNTS = {
        ALL_ACCOUNTS: [address, OTHER_ACCOUNT],
        ACTIVE_ACCOUNT: OTHER_ACCOUNT,
      };
      h.store.KEYSTORES = JSON.stringify([
        { address: ACCOUNT, crypto: {} },
        { address: OTHER_ACCOUNT, crypto: {} },
      ]);
      const remainingAccounts = (await StorageUtil.getAllAccounts()).filter(
        (item) => item !== ACCOUNT,
      );
      const remainingKeystores = (await StorageUtil.getKeystores()).filter(
        (item) => item.address !== ACCOUNT,
      );
      // Persistence sequence used by QrlStore.removeAccount.
      await StorageUtil.setAllAccounts(remainingAccounts);
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      await StorageUtil.clearAllAccountData(ACCOUNT);
      await StorageUtil.setKeystores(remainingKeystores);
      expect(await StorageUtil.getAllAccounts()).toEqual([OTHER_ACCOUNT]);
      expect(
        (await StorageUtil.getKeystores()).map((item) => item.address),
      ).toEqual([OTHER_ACCOUNT]);
      expect(storedRecord("ACCOUNTS").ACTIVE_ACCOUNT).toBe(OTHER_ACCOUNT);
    },
  );

  it.each(addressForms)(
    "edits and deletes %s contacts while retaining unreadable siblings in order",
    async (_form, address) => {
      const junk = { future: [null, false] };
      const legacy = { name: "Legacy", address: `Q${"d".repeat(40)}` };
      const other = { name: "Other", address: OTHER_ACCOUNT };
      h.store.CONTACTS = {
        ALL_CONTACTS: [{ name: "Old", address }, junk, other, legacy, null],
      };
      const contacts = await StorageUtil.getContacts();
      expect(contacts).toEqual([{ name: "Old", address: ACCOUNT }, other]);
      expect(h.local.set).not.toHaveBeenCalled();
      await StorageUtil.setContacts(
        contacts.map((contact) =>
          contact.address === ACCOUNT
            ? { ...contact, name: "Edited" }
            : contact,
        ),
      );
      expect(bytes(storedRecord("CONTACTS").ALL_CONTACTS)).toBe(
        bytes([
          { name: "Edited", address: ACCOUNT },
          junk,
          other,
          legacy,
          null,
        ]),
      );
      expect(await StorageUtil.getContacts()).toEqual([
        { name: "Edited", address: ACCOUNT },
        other,
      ]);
      h.store.CONTACTS = {
        ALL_CONTACTS: [{ name: "Old", address }, junk, other, legacy, null],
      };
      await StorageUtil.setContacts(
        contacts.filter((contact) => contact.address !== ACCOUNT),
      );
      expect(bytes(storedRecord("CONTACTS").ALL_CONTACTS)).toBe(
        bytes([junk, other, legacy, null]),
      );
      expect(await StorageUtil.getContacts()).toEqual([other]);
    },
  );

  it.each([{}, { updatedAt: { usd: 1700000000000, eur: 1700000000000 } }])(
    "loads usable prices with a null trend and preserves the cache (%j)",
    async (timestamps) => {
      const cache = {
        prices: { usd: 1.23, eur: 1.1 },
        change24h: { usd: null, eur: 0.5 },
        timestamp: 1700000000000,
        ...timestamps,
      };
      h.store.PRICE_CACHE = h.roundTrip(cache);
      const cached = await StorageUtil.getPriceCache();
      expect(cached).toEqual(cache);
      const prices = new PriceStore();
      await prices.initialize(false);
      expect(prices.quoteFor("USD")).toEqual({
        price: 1.23,
        currency: "USD",
        change24h: 0,
      });
      expect(prices.quoteFor("EUR")).toEqual({
        price: 1.1,
        currency: "EUR",
        change24h: 0.5,
      });
      expect(h.local.set).not.toHaveBeenCalled();
      expect(bytes(h.store.PRICE_CACHE)).toBe(bytes(cache));
      if (cached === null) throw new Error("Expected the stored price cache");
      await StorageUtil.setPriceCache(cached);
      expect(bytes(h.store.PRICE_CACHE)).toBe(bytes(cache));
      expect(await StorageUtil.getPriceCache()).toEqual(cache);
    },
  );

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
        chainId: null,
        future: [null, { keep: true }],
      };
      const second = { ...CHAIN, chainId: "0x2b", chainName: "Second" };
      const raw = [chain, unusable, second, null];
      h.store.BLOCKCHAINS = {
        ...storedRecord("BLOCKCHAINS"),
        ALL_BLOCKCHAINS: h.roundTrip(raw),
      };
      expect(await StorageUtil.getAllBlockChains()).toEqual([chain, second]);
      expect(await StorageUtil.getActiveBlockChain()).toEqual(chain);
      expect(h.local.set).not.toHaveBeenCalled();
      await StorageUtil.setAllBlockChains(
        await StorageUtil.getAllBlockChains(),
      );
      expect(bytes(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS)).toBe(
        bytes(raw),
      );
      await StorageUtil.setAllBlockChains(
        (await StorageUtil.getAllBlockChains()).map((c) =>
          c.chainId === second.chainId ? { ...c, chainName: "Edited" } : c,
        ),
      );
      expect(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS).toEqual([
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
      expect(bytes(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS)).toBe(
        bytes([unusable, { ...second, chainName: "Edited" }, null]),
      );
      expect(await StorageUtil.getAllBlockChains()).toEqual([
        { ...second, chainName: "Edited" },
      ]);
    },
  );

  it("keeps arrays with zero usable chains as arrays through a save", async () => {
    const raw = [null, { future: "chain" }];
    h.store.BLOCKCHAINS = {
      ...storedRecord("BLOCKCHAINS"),
      ALL_BLOCKCHAINS: raw,
    };
    expect(await StorageUtil.getAllBlockChains()).toEqual([]);
    await StorageUtil.setAllBlockChains(await StorageUtil.getAllBlockChains());
    expect(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS).toEqual(raw);
    await StorageUtil.setAllBlockChains([CHAIN]);
    expect(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS).toEqual([
      ...raw,
      CHAIN,
    ]);
    expect(await StorageUtil.getAllBlockChains()).toEqual([CHAIN]);
  });

  it("uses the chain default for a non-array, warns once and permits replacement", async () => {
    const warn = vi.spyOn(console, "warn");
    h.store.BLOCKCHAINS = {
      ...storedRecord("BLOCKCHAINS"),
      ALL_BLOCKCHAINS: { corrupt: true },
    };
    expect(await StorageUtil.getAllBlockChains()).toEqual(QRL_BLOCKCHAINS);
    expect(await StorageUtil.getAllBlockChains()).toEqual(QRL_BLOCKCHAINS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storedRecord("BLOCKCHAINS").ALL_BLOCKCHAINS).toEqual({
      corrupt: true,
    });
    await StorageUtil.setAllBlockChains([CHAIN]);
    expect(await StorageUtil.getAllBlockChains()).toEqual([CHAIN]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preserves tokens with serialized NaN decimals and unusable siblings on import, replacement and removal", async () => {
    const nullable = { ...TOKEN, address: "token-null", decimals: Number.NaN };
    const junk = { address: null, decimals: "future", future: true };
    setList("TOKENS", "ALL_TOKENS", "tokens", [TOKEN, junk, nullable, null, 7]);
    const raw = list("TOKENS", "ALL_TOKENS", "tokens");
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
    expect(storedRecord("TOKENS", "ALL_TOKENS")[OTHER_ACCOUNT]).toEqual({
      keep: true,
    });
    expect(storedRecord("TOKENS", "ALL_TOKENS", ACCOUNT).otherChain).toEqual({
      keep: true,
    });
    expect(storedRecord("TOKENS").metadata).toBe("keep");
  });

  it("preserves unreadable NFT collections through import, replacement, removal and re-read", async () => {
    const junk = {
      ...NFT,
      address: null,
      standard: "future",
      future: { keep: true },
    };
    const raw = [NFT, junk, null];
    setList("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections", raw);
    expect(await StorageUtil.getNFTCollectionsList(ACCOUNT)).toEqual([NFT]);
    expect(h.local.set).not.toHaveBeenCalled();
    const added = { ...NFT, address: "nft-new", standard: "ZRC1155" };
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
      transactionHash: null,
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
    const update: Partial<
      import("@/types/transactionHistory").TransactionHistoryEntry
    > = {
      pendingStatus: "confirmed",
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
    const records: Record<string, unknown> = {
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
    ).toMatchObject({
      ...invalid,
      permissions: [{ future: true, caveats: [] }],
    });
    const before = bytes(h.store.DAPPS);
    await StorageUtil.removeAccountFromAllDApps(`Q${"c".repeat(128)}`);
    expect(bytes(h.store.DAPPS)).toBe(before);
    expect(h.local.set).not.toHaveBeenCalled();
    await StorageUtil.removeAccountFromAllDApps(ACCOUNT.toLowerCase());
    const changed = await StorageUtil.getDAppsConnectedAccountsData(
      CONNECTION.urlOrigin,
    );
    expect(changed?.accounts).toEqual([OTHER_ACCOUNT]);
    expect(changed?.permissions).toMatchObject([
      { caveats: [{ value: [OTHER_ACCOUNT] }] },
      {},
    ]);
    for (const key of ["unrelated", "unreadable", "junk"])
      expect(bytes(storedRecord("DAPPS", "ALL_DAPPS")[key])).toBe(
        bytes(records[key]),
      );
    await StorageUtil.removeAccountFromAllDApps(OTHER_ACCOUNT);
    expect(
      await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin),
    ).toBeUndefined();
    expect(bytes(storedRecord("DAPPS", "ALL_DAPPS").unreadable)).toBe(
      bytes(invalid),
    );
  });

  it("retains unreadable accounts, contacts and Ledger records across bulk saves", async () => {
    const junk = { future: true };
    const legacy = `Q${"d".repeat(40)}`;
    h.store.ACCOUNTS = { ALL_ACCOUNTS: [ACCOUNT, junk, legacy] };
    await StorageUtil.addLedgerAccountToAllAccounts(OTHER_ACCOUNT);
    expect(storedRecord("ACCOUNTS").ALL_ACCOUNTS).toEqual([
      ACCOUNT,
      junk,
      legacy,
      OTHER_ACCOUNT,
    ]);
    await StorageUtil.removeLedgerAccountFromAllAccounts(ACCOUNT);
    expect(storedRecord("ACCOUNTS").ALL_ACCOUNTS).toEqual([
      junk,
      legacy,
      OTHER_ACCOUNT,
    ]);
    const contact = { name: "Known", address: ACCOUNT };
    h.store.CONTACTS = { ALL_CONTACTS: [contact, junk] };
    await StorageUtil.setContacts(await StorageUtil.getContacts());
    expect(storedRecord("CONTACTS").ALL_CONTACTS).toEqual([contact, junk]);
    h.store.LEDGER = { LEDGER_ACCOUNTS: [LEDGER, junk] };
    await StorageUtil.setLedgerAccounts(await StorageUtil.getLedgerAccounts());
    expect(storedRecord("LEDGER").LEDGER_ACCOUNTS).toEqual([LEDGER, junk]);
  });

  it.each(["__proto__", "constructor"])(
    "treats %s as an own storage key",
    async (key) => {
      const prototypeBefore = Object.getOwnPropertyDescriptors(
        Object.prototype,
      );
      await StorageUtil.setTokenContractsList(key, TOKEN);
      expect(
        Object.prototype.hasOwnProperty.call(
          storedRecord("TOKENS", "ALL_TOKENS"),
          key,
        ),
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
        Object.prototype.hasOwnProperty.call(
          storedRecord("DAPPS", "ALL_DAPPS"),
          key,
        ),
      ).toBe(false);
      h.store.ACCOUNT_LABELS = { opaque: { keep: true } };
      await StorageUtil.setAccountLabel(key, "Label");
      expect(
        Object.prototype.hasOwnProperty.call(
          await StorageUtil.getAccountLabels(),
          key,
        ),
      ).toBe(true);
      expect(storedRecord("ACCOUNT_LABELS").opaque).toEqual({ keep: true });
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
        prototypeBefore,
      );
    },
  );
});
