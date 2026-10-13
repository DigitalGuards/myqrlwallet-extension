import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorageUtil from "./storageUtil";
import {
  getStoredValue,
  isRecord,
  isStoredBlockchain,
  isTokenContract,
  isNFTCollection,
  isContact,
  isLedgerAccount,
  isTransactionHistoryEntry,
  isConnectedAccounts,
  isPriceCache,
  isWalletSettings,
  isTransactionValues,
  isDAppRequest,
  isStoredKeystore,
  isNormalizableQrlAddress,
} from "./storageGuards";
import {
  fieldMutations,
  storageWriterBases,
  storageMutationValues,
  nestedFieldMutations,
  type StorageJunkValue,
} from "./__mocks__/storageGeneratedCases";
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
import {
  checkWalletAddQrlChainParams,
  checkWalletWatchAssetParams,
  pickDefaultRpcUrl,
  checkAccountAndChainHaveBeenAuthorized,
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import PriceStore from "@/stores/priceStore";
import { blockchainView, tokenView } from "./storageViews";
import { malformed } from "@/test-utils/malformed";
import SettingsStore from "@/stores/settingsStore";
import { toCanonicalQrlAddress } from "./addressUtil";

const h = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const roundTrip = (value: unknown): unknown =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const local = {
    get: vi.fn((key: string) =>
      Promise.resolve({ [key]: roundTrip(store[key]) }),
    ),
    set: vi.fn((data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data))
        store[key] = roundTrip(value);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      Reflect.deleteProperty(store, key);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) Reflect.deleteProperty(store, key);
      return Promise.resolve();
    }),
  };
  return { store, local, roundTrip };
});
vi.mock("@/utilities/profileStorage", () => ({
  walletLocalStorage: h.local,
  walletSessionStorage: h.local,
}));

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.store)) Reflect.deleteProperty(h.store, key);
  h.store.BLOCKCHAINS = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
});

const first = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;
const nestedList = (root: string, all: string, field: string) =>
  getStoredValue(h.store, root, all, ACCOUNT, CHAIN.chainId, field);
const bytes = (value: unknown) => JSON.stringify(value);

type WriterCase = {
  name: string;
  guard: (value: unknown) => boolean;
  write: (input: Record<string, unknown>) => Promise<unknown>;
  read: (input: Record<string, unknown>) => Promise<unknown>;
  raw: (input: Record<string, unknown>) => unknown;
  unrelated: () => Promise<unknown>;
};
const cases: WriterCase[] = [
  {
    name: "chain",
    guard: isStoredBlockchain,
    write: (input) => StorageUtil.setAllBlockChains(malformed([input])),
    read: () => StorageUtil.getAllBlockChains(),
    raw: () => first(getStoredValue(h.store, "BLOCKCHAINS", "ALL_BLOCKCHAINS")),
    unrelated: async () =>
      StorageUtil.setAllBlockChains([
        ...(await StorageUtil.getAllBlockChains()),
        { ...CHAIN, chainId: "0x43" },
      ]),
  },
  {
    name: "token",
    guard: isTokenContract,
    write: (input) =>
      StorageUtil.setTokenContractsList(ACCOUNT, malformed(input)),
    read: () => StorageUtil.getTokenContractsList(ACCOUNT),
    raw: () => first(nestedList("TOKENS", "ALL_TOKENS", "tokens")),
    unrelated: () =>
      StorageUtil.setTokenContractsList(ACCOUNT, {
        ...TOKEN,
        address: OTHER_ACCOUNT,
      }),
  },
  {
    name: "NFT",
    guard: isNFTCollection,
    write: (input) =>
      StorageUtil.setNFTCollectionsList(ACCOUNT, malformed(input)),
    read: () => StorageUtil.getNFTCollectionsList(ACCOUNT),
    raw: () =>
      first(
        nestedList("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections"),
      ),
    unrelated: () =>
      StorageUtil.setNFTCollectionsList(ACCOUNT, {
        ...NFT,
        address: OTHER_ACCOUNT,
      }),
  },
  {
    name: "history",
    guard: isTransactionHistoryEntry,
    write: (input) =>
      StorageUtil.setTransactionHistoryEntry(ACCOUNT, malformed(input)),
    read: () => StorageUtil.getTransactionHistory(ACCOUNT),
    raw: () => {
      const list = nestedList("TX_HISTORY", "ALL_TX_HISTORY", "transactions");
      const entries: unknown[] = Array.isArray(list) ? list : [];
      return entries.find(
        (entry: unknown) =>
          getStoredValue(entry, "transactionHash") !== "unrelated",
      );
    },
    unrelated: () =>
      StorageUtil.setTransactionHistoryEntry(ACCOUNT, {
        ...HISTORY,
        transactionHash: "unrelated",
      }),
  },
  {
    name: "contact",
    guard: isContact,
    write: (input) => StorageUtil.setContacts(malformed([input])),
    read: () => StorageUtil.getContacts(),
    raw: () => first(getStoredValue(h.store, "CONTACTS", "ALL_CONTACTS")),
    unrelated: async () =>
      StorageUtil.setContacts([
        ...(await StorageUtil.getContacts()),
        { address: OTHER_ACCOUNT, name: "Other" },
      ]),
  },
  {
    name: "Ledger",
    guard: isLedgerAccount,
    write: (input) => StorageUtil.setLedgerAccounts(malformed([input])),
    read: () => StorageUtil.getLedgerAccounts(),
    raw: () => first(getStoredValue(h.store, "LEDGER", "LEDGER_ACCOUNTS")),
    unrelated: async () =>
      StorageUtil.setLedgerAccounts([
        ...(await StorageUtil.getLedgerAccounts()),
        { ...LEDGER, address: OTHER_ACCOUNT },
      ]),
  },
  {
    name: "dApp",
    guard: isConnectedAccounts,
    write: (input) =>
      StorageUtil.setDAppsConnectedAccountsData(malformed(input)),
    read: (input) =>
      StorageUtil.getDAppsConnectedAccountsData(
        typeof input.urlOrigin === "string" ? input.urlOrigin : "",
      ),
    raw: (input) =>
      getStoredValue(
        h.store,
        "DAPPS",
        "ALL_DAPPS",
        typeof input.urlOrigin === "string" ? input.urlOrigin : "",
      ),
    unrelated: () =>
      StorageUtil.setDAppsConnectedAccountsData({
        ...CONNECTION,
        urlOrigin: "https://other.example",
      }),
  },
  {
    name: "price",
    guard: isPriceCache,
    write: (input) => StorageUtil.setPriceCache(input),
    read: () => StorageUtil.getPriceCache(),
    raw: () => h.store.PRICE_CACHE,
    unrelated: () => StorageUtil.setAccountLabel(ACCOUNT, "Other write"),
  },
  {
    name: "settings",
    guard: isWalletSettings,
    write: (input) => StorageUtil.setSettings(malformed(input)),
    read: () => StorageUtil.getSettings(),
    raw: () => h.store.SETTINGS,
    unrelated: () => StorageUtil.setAccountLabel(ACCOUNT, "Other write"),
  },
  {
    name: "draft",
    guard: isTransactionValues,
    write: (input) => StorageUtil.setTransactionValues(malformed(input)),
    read: () => StorageUtil.getTransactionValues(),
    raw: () => h.store[`${CHAIN.chainId}_TRANSACTION_VALUES`],
    unrelated: () => StorageUtil.setAccountLabel(ACCOUNT, "Other write"),
  },
  {
    name: "request",
    guard: isDAppRequest,
    write: (input) => StorageUtil.setDAppsRequestData(malformed(input)),
    read: () => StorageUtil.getDAppsRequestData(),
    raw: () => getStoredValue(h.store, "DAPPS", "DAPPS_REQUEST_DATA"),
    unrelated: () => StorageUtil.setDAppsConnectedAccountsData(CONNECTION),
  },
  {
    name: "keystore",
    guard: isStoredKeystore,
    write: (input) => StorageUtil.setKeystores(malformed([input])),
    read: () => StorageUtil.getKeystores(),
    raw: () =>
      first(
        typeof h.store.KEYSTORES === "string"
          ? JSON.parse(h.store.KEYSTORES)
          : undefined,
      ),
    unrelated: () => StorageUtil.setAccountLabel(ACCOUNT, "Other write"),
  },
];

for (const scenario of cases) {
  describe(`${scenario.name} writer field matrix`, () => {
    it.each(nestedFieldMutations(storageWriterBases[scenario.name]))(
      "$label",
      async ({ input, path }) => {
        const field = path[0];
        // Unreadable input must fail before storage changes. Accepted fields
        // are exercised through the real writer and its corresponding reader.
        const before = bytes(h.store);
        if (!scenario.guard(input)) {
          await expect(scenario.write(input)).rejects.toThrow();
          expect(bytes(h.store)).toBe(before);
          return;
        }
        if (scenario.name === "dApp") {
          const value = input[field];
          if (
            ((field === "accounts" || field === "blockchains") &&
              !Array.isArray(value)) ||
            (field === "permissions" && value != null && !Array.isArray(value))
          ) {
            await expect(scenario.write(input)).rejects.toThrow();
            expect(bytes(h.store)).toBe(before);
            return;
          }
        }
        // The established registry writer rejects noncanonical registry values.
        if (
          scenario.name === "chain" &&
          field === "qrnsRegistryAddress" &&
          input[field] != null &&
          input[field] !== ""
        ) {
          await expect(scenario.write(input)).rejects.toThrow();
          expect(bytes(h.store)).toBe(before);
          return;
        }
        await scenario.write(input);
        const stored = scenario.raw(input);
        expect(scenario.guard(stored)).toBe(true);
        const persisted = bytes(stored);
        const read = first(await scenario.read(input));
        // Empty account grants retain the existing disconnected getter result.
        if (
          scenario.name === "dApp" &&
          Array.isArray(input.accounts) &&
          input.accounts.length === 0
        )
          expect(read).toBeUndefined();
        else expect(bytes(read)).toBe(persisted);
        await scenario.unrelated();
        expect(bytes(scenario.raw(input))).toBe(persisted);
      },
    );
  });
}

const chainPayload = {
  chainId: "0x43",
  chainName: "dApp chain",
  rpcUrls: ["https://rpc.example"],
  nativeCurrency: { name: "Coin", symbol: "TOK", decimals: 18 },
  blockExplorerUrls: [],
  iconUrls: [],
};
for (const internal of [false, true]) {
  describe(
    internal
      ? "chain form validator matrix"
      : "wallet_addQRLChain validator matrix",
    () => {
      it.each(
        fieldMutations(internal ? { ...CHAIN, ...chainPayload } : chainPayload),
      )("$label", async ({ input }) => {
        const verdict: unknown = await checkWalletAddQrlChainParams(
          malformed(input),
          internal,
        );
        if (getStoredValue(verdict, "canProceed") !== true) return;
        const rpcUrls = input.rpcUrls;
        const explorer: unknown = Array.isArray(input.blockExplorerUrls)
          ? input.blockExplorerUrls[0]
          : undefined;
        const icon: unknown = Array.isArray(input.iconUrls)
          ? input.iconUrls[0]
          : undefined;
        const stored = internal
          ? input
          : {
              ...input,
              defaultRpcUrl: pickDefaultRpcUrl(rpcUrls),
              defaultBlockExplorerUrl: explorer ?? "",
              defaultIconUrl: icon ?? "",
              isTestnet: false,
              defaultWsRpcUrl: "",
              isCustomChain: true,
            };
        expect(isStoredBlockchain(stored)).toBe(true);
        if (!isStoredBlockchain(stored))
          throw new Error("Accepted chain has no identity");
        await StorageUtil.setAllBlockChains([stored]);
        const persisted = bytes(
          first(getStoredValue(h.store, "BLOCKCHAINS", "ALL_BLOCKCHAINS")),
        );
        expect(bytes(first(await StorageUtil.getAllBlockChains()))).toBe(
          persisted,
        );
        await StorageUtil.setAllBlockChains([
          ...(await StorageUtil.getAllBlockChains()),
          CHAIN,
        ]);
        expect(
          bytes(
            first(getStoredValue(h.store, "BLOCKCHAINS", "ALL_BLOCKCHAINS")),
          ),
        ).toBe(persisted);
        await StorageUtil.setActiveBlockChain(stored.chainId);
        expect((await StorageUtil.getActiveBlockChain()).chainId).toBe(
          stored.chainId,
        );
      });
    },
  );
}

describe("wallet_watchAsset validator matrix", () => {
  it.each(fieldMutations({ ...TOKEN, address: ACCOUNT }))(
    "$label",
    async ({ input }) => {
      const verdict: unknown = await checkWalletWatchAssetParams(
        malformed({ type: "ZRC20", options: input }),
      );
      if (getStoredValue(verdict, "canProceed") !== true) return;
      const parsed = parseInt(malformed(input.decimals ?? 0));
      const stored = {
        address: input.address ?? "",
        symbol: input.symbol ?? "",
        decimals: parsed,
        image: input.image ?? "",
      };
      expect(isTokenContract(stored)).toBe(true);
      if (!isTokenContract(stored))
        throw new Error("Accepted token has no identity");
      await StorageUtil.setTokenContractsList(ACCOUNT, {
        ...TOKEN,
        address: ACCOUNT,
      });
      await StorageUtil.setTokenContractsList(ACCOUNT, stored);
      const persisted = bytes(
        first(nestedList("TOKENS", "ALL_TOKENS", "tokens")),
      );
      expect(
        bytes(first(await StorageUtil.getTokenContractsList(ACCOUNT))),
      ).toBe(persisted);
      await StorageUtil.setTokenContractsList(ACCOUNT, {
        ...TOKEN,
        address: OTHER_ACCOUNT,
      });
      expect(bytes(first(nestedList("TOKENS", "ALL_TOKENS", "tokens")))).toBe(
        persisted,
      );
    },
  );
});

describe("price response and consumer matrix", () => {
  it.each(storageMutationValues)(
    "isolates each currency with %s metadata",
    async (_label, value) => {
      for (const field of ["prices", "change24h", "updatedAt"]) {
        const base = storageWriterBases.price;
        const data = isRecord(base[field]) ? base[field] : {};
        const cache = { ...base, [field]: { ...data, eur: value } };
        await StorageUtil.setPriceCache(cache);
        const persisted = bytes(h.store.PRICE_CACHE);
        expect(await StorageUtil.getPriceCache()).toEqual(h.roundTrip(cache));
        const prices = new PriceStore();
        await prices.initialize(false);
        expect(prices.quoteFor("USD").price).toBe(1.23);
        await StorageUtil.setContacts([
          { address: ACCOUNT, name: "Other write" },
        ]);
        expect(bytes(h.store.PRICE_CACHE)).toBe(persisted);
      }
    },
  );
  it("narrows explorer links and token images only in consumer views", () => {
    expect(
      blockchainView({
        ...CHAIN,
        blockExplorerUrls: "",
        defaultBlockExplorerUrl: "x",
      }).defaultBlockExplorerUrl,
    ).toBe("");
    expect(tokenView({ ...TOKEN, image: false }).image).toBe("");
  });
});

describe("current price fetch writer matrix", () => {
  it.each(
    fieldMutations({
      usd: 1.23,
      eur: 1.1,
      usd_24h_change: 1,
      eur_24h_change: 0.5,
    }),
  )("$label", async ({ input }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ "quantum-resistant-ledger": input }), {
            status: 200,
          }),
        ),
      ),
    );
    const prices = new PriceStore();
    await prices.fetchPrices();
    expect(prices.hasError).toBe(false);
    expect(isPriceCache(h.store.PRICE_CACHE)).toBe(true);
    const persisted = bytes(h.store.PRICE_CACHE);
    expect(bytes(await StorageUtil.getPriceCache())).toBe(persisted);
    await StorageUtil.setAccountLabel(ACCOUNT, "Other write");
    expect(bytes(h.store.PRICE_CACHE)).toBe(persisted);
  });
});

const settingsEdits: Array<{
  name: string;
  run: (settings: SettingsStore) => Promise<void>;
  changes: Record<string, unknown>;
}> = [
  {
    name: "theme",
    run: (s) => s.setThemePreference("light"),
    changes: { themePreference: "light" },
  },
  {
    name: "timeout",
    run: (s) => s.setAutoLockMinutes(5),
    changes: { autoLockMinutes: 5 },
  },
  {
    name: "currency",
    run: (s) => s.setCurrency("GBP"),
    changes: { currency: "GBP" },
  },
  {
    name: "language",
    run: (s) => s.setLanguage("en"),
    changes: { language: "en" },
  },
  {
    name: "gas",
    run: (s) => s.setDefaultGasTier("market"),
    changes: { defaultGasTier: "market" },
  },
  {
    name: "balance",
    run: (s) => s.setShowBalanceAndPrice(true),
    changes: { showBalanceAndPrice: true },
  },
  {
    name: "notifications",
    run: (s) => s.setNotificationsEnabled(true),
    changes: { notificationsEnabled: true },
  },
  {
    name: "phishing",
    run: (s) => s.setPhishingDetectionEnabled(false),
    changes: { phishingDetectionEnabled: false },
  },
  {
    name: "surface",
    run: (s) => s.setSidePanelPreferred(true),
    changes: {
      sidePanelPreferred: true,
      sidePanelSurface: "panel",
      sidePanelNoticePending: false,
      sidePanelNoticeSeen: true,
    },
  },
  {
    name: "notice",
    run: (s) => s.dismissSidePanelNotice(),
    changes: { sidePanelNoticePending: false, sidePanelNoticeSeen: true },
  },
];

for (const edit of settingsEdits) {
  describe(`settings consumer ${edit.name}`, () => {
    it.each(fieldMutations(storageWriterBases.settings))(
      "$label",
      async ({ input, field }) => {
        h.store.SETTINGS = h.roundTrip({ ...input, future: { retain: true } });
        const raw = h.store.SETTINGS;
        const expectedRead = { ...input, future: { retain: true } };
        if (!isWalletSettings({ [field]: input[field] }))
          Reflect.deleteProperty(expectedRead, field);
        expect(await StorageUtil.getSettings()).toEqual(
          h.roundTrip(expectedRead),
        );
        const store = new SettingsStore();
        await store.whenSettingsLoaded();
        await edit.run(store);
        if (!isWalletSettings(raw)) {
          expect(bytes(h.store.SETTINGS)).toBe(
            bytes(h.roundTrip({ ...getRecord(raw), ...edit.changes })),
          );
          const reloaded = await StorageUtil.getSettings();
          for (const [key, value] of Object.entries(expectedRead)) {
            if (!Object.prototype.hasOwnProperty.call(edit.changes, key))
              expect(getStoredValue(reloaded, key)).toEqual(h.roundTrip(value));
          }
        }
        for (const [key, value] of Object.entries(edit.changes))
          expect(getStoredValue(h.store.SETTINGS, key)).toEqual(value);
      },
    );
  });
}

const getRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("Expected stored record");
  return value;
};

const mixedEntries = [null, false, 7, {}, [], "unreadable", { future: true }];
describe("mixed dApp account reader and real authorization", () => {
  it.each(
    mixedEntries.flatMap((opaque, id) =>
      [0, 1, 2].map((position) => ({ opaque, id, position })),
    ),
  )(
    "keeps readable accounts through reconnect and revocation: $id at $position",
    async ({ opaque, position }) => {
      const accounts = [ACCOUNT, OTHER_ACCOUNT];
      const mixed = [
        ...accounts.slice(0, position),
        opaque,
        ...accounts.slice(position),
      ];
      h.store.DAPPS = {
        ALL_DAPPS: {
          [CONNECTION.urlOrigin]: { ...CONNECTION, accounts: mixed },
        },
      };
      const authorize = async () =>
        (
          await checkAccountAndChainHaveBeenAuthorized(
            {
              method: "qrl_sendTransaction",
              params: [{ from: ACCOUNT, to: OTHER_ACCOUNT, value: "0x1" }],
              senderData: { url: CONNECTION.urlOrigin },
            },
            undefined,
            true,
          )
        ).canProceed;
      expect(
        (await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin))
          ?.accounts,
      ).toEqual(accounts);
      expect(await authorize()).toBe(true);
      await StorageUtil.setDAppsConnectedAccountsData(CONNECTION);
      expect(
        getStoredValue(
          h.store,
          "DAPPS",
          "ALL_DAPPS",
          CONNECTION.urlOrigin,
          "accounts",
        ),
      ).toEqual(mixed);
      expect(
        (await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin))
          ?.accounts,
      ).toEqual(accounts);
      expect(await authorize()).toBe(true);
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      expect(await authorize()).toBe(false);
      expect(
        (await StorageUtil.getDAppsConnectedAccountsData(CONNECTION.urlOrigin))
          ?.accounts,
      ).toEqual([OTHER_ACCOUNT]);
      expect(
        getStoredValue(
          h.store,
          "DAPPS",
          "ALL_DAPPS",
          CONNECTION.urlOrigin,
          "accounts",
        ),
      ).toEqual(mixed.filter((v) => v !== ACCOUNT));
    },
  );
});

const scalarWriters: Array<{
  name: string;
  accepts: (value: unknown) => boolean;
  write: (value: StorageJunkValue) => Promise<void>;
  read: () => Promise<unknown>;
  expected?: (value: unknown) => unknown;
}> = [
  {
    name: "account labels",
    accepts: (value) => typeof value === "string",
    write: (value) =>
      StorageUtil.setAccountLabels(malformed({ [ACCOUNT]: value })),
    read: async () => (await StorageUtil.getAccountLabels())[ACCOUNT],
  },
  {
    name: "single account label",
    accepts: (value) => typeof value === "string",
    write: (value) => StorageUtil.setAccountLabel(ACCOUNT, malformed(value)),
    read: async () => (await StorageUtil.getAccountLabels())[ACCOUNT],
  },
  {
    name: "hidden accounts",
    accepts: (value) => typeof value === "boolean",
    write: (value) =>
      StorageUtil.setHiddenAccounts(malformed({ [ACCOUNT]: value })),
    read: async () => (await StorageUtil.getHiddenAccounts())[ACCOUNT],
  },
  {
    name: "active page",
    accepts: (value) => typeof value === "string",
    write: (value) => StorageUtil.setActivePage(malformed(value)),
    read: () => StorageUtil.getActivePage(),
  },
  {
    name: "active chain",
    accepts: (value) => typeof value === "string",
    write: (value) => StorageUtil.setActiveBlockChain(malformed(value)),
    read: () =>
      Promise.resolve(
        getStoredValue(h.store, "BLOCKCHAINS", "ACTIVE_BLOCKCHAIN"),
      ),
  },
  {
    name: "accounts",
    accepts: isNormalizableQrlAddress,
    write: (value) => StorageUtil.setAllAccounts(malformed([value])),
    read: async () => (await StorageUtil.getAllAccounts())[0],
    expected: (value) => toCanonicalQrlAddress(value),
  },
  {
    name: "active account",
    accepts: (value) =>
      value === undefined || value === "" || isNormalizableQrlAddress(value),
    write: (value) => StorageUtil.setActiveAccount(malformed(value)),
    read: () => StorageUtil.getActiveAccount(),
    expected: (value) =>
      value === undefined || value === "" ? "" : toCanonicalQrlAddress(value),
  },
  {
    name: "added Ledger account",
    accepts: isNormalizableQrlAddress,
    write: (value) =>
      StorageUtil.addLedgerAccountToAllAccounts(malformed(value)),
    read: async () => (await StorageUtil.getAllAccounts())[0],
    expected: (value) => toCanonicalQrlAddress(value),
  },
];
for (const scenario of scalarWriters) {
  describe(`${scenario.name} value matrix`, () => {
    it.each([
      ...storageMutationValues,
      ["account", ACCOUNT],
      ["lowercase", ACCOUNT.toLowerCase()],
      ["0x account", `0x${ACCOUNT.slice(1)}`],
    ])("%s", async (_label, value) => {
      h.store.ACCOUNT_LABELS = { [OTHER_ACCOUNT]: "Retain" };
      h.store.HIDDEN_ACCOUNTS = { [OTHER_ACCOUNT]: false };
      h.store.ACCOUNTS = { ACTIVE_ACCOUNT: OTHER_ACCOUNT };
      h.store.ACTIVE_PAGE = "/existing";
      const before = bytes(h.store);
      if (!scenario.accepts(value)) {
        await expect(scenario.write(value)).rejects.toThrow();
        expect(bytes(h.store)).toBe(before);
        return;
      }
      await scenario.write(value);
      expect(await scenario.read()).toEqual(
        scenario.expected ? scenario.expected(value) : value,
      );
      const saved = bytes(h.store);
      await scenario.read();
      expect(bytes(h.store)).toBe(saved);
    });
  });
}

it.each(nestedFieldMutations(storageWriterBases.history))(
  "history patch remains readable or fails atomically: $label",
  async ({ input }) => {
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    const before = bytes(h.store);
    if (!isTransactionHistoryEntry(input)) {
      await expect(
        StorageUtil.updateTransactionHistoryEntry(
          ACCOUNT,
          HISTORY.transactionHash,
          malformed(input),
        ),
      ).rejects.toThrow();
      expect(bytes(h.store)).toBe(before);
      return;
    }
    await StorageUtil.updateTransactionHistoryEntry(
      ACCOUNT,
      HISTORY.transactionHash,
      malformed(input),
    );
    expect(await StorageUtil.getTransactionHistory(ACCOUNT)).toEqual(
      h.roundTrip([input]),
    );
  },
);

it.each(mixedEntries.map((entry) => ({ entry })))(
  "rejects unreadable approved chains atomically: $entry",
  async ({ entry }) => {
    await StorageUtil.setDAppsConnectedAccountsData(CONNECTION);
    const before = bytes(h.store);
    await expect(
      StorageUtil.setDAppsConnectedAccountsData(
        malformed({ ...CONNECTION, blockchains: [CHAIN, entry] }),
      ),
    ).rejects.toThrow();
    expect(bytes(h.store)).toBe(before);
  },
);
