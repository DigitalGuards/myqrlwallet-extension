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
} from "./storageGuards";
import {
  fieldMutations,
  storageWriterBases,
  storageMutationValues,
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
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import PriceStore from "@/stores/priceStore";
import { blockchainView, tokenView } from "./storageViews";

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

// Reflect exercises real writers with malformed wire input without changing
// their public signatures or asserting a type for the input.
const invoke = async (name: string, ...args: unknown[]): Promise<unknown> => {
  const method: unknown = Reflect.get(StorageUtil, name);
  if (typeof method !== "function") throw new Error(`Missing writer ${name}`);
  const result: unknown = Reflect.apply(method, StorageUtil, args);
  return await result;
};
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
    write: (input) => invoke("setAllBlockChains", [input]),
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
    write: (input) => invoke("setTokenContractsList", ACCOUNT, input),
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
    write: (input) => invoke("setNFTCollectionsList", ACCOUNT, input),
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
    write: (input) => invoke("setTransactionHistoryEntry", ACCOUNT, input),
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
    write: (input) => invoke("setContacts", [input]),
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
    write: (input) => invoke("setLedgerAccounts", [input]),
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
    write: (input) => invoke("setDAppsConnectedAccountsData", input),
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
    write: (input) => invoke("setPriceCache", input),
    read: () => StorageUtil.getPriceCache(),
    raw: () => h.store.PRICE_CACHE,
    unrelated: () => StorageUtil.setAccountLabel(ACCOUNT, "Other write"),
  },
];

for (const scenario of cases) {
  describe(`${scenario.name} writer field matrix`, () => {
    it.each(fieldMutations(storageWriterBases[scenario.name]))(
      "$label",
      async ({ input, field }) => {
        // Identities are the sole required fields. Invalid identities must fail
        // before storage changes; metadata is exercised through the real writer.
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
        const verdict: unknown = await Reflect.apply(
          checkWalletAddQrlChainParams,
          undefined,
          [input, internal],
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
      const verdict: unknown = await Reflect.apply(
        checkWalletWatchAssetParams,
        undefined,
        [{ type: "ZRC20", options: input }],
      );
      if (getStoredValue(verdict, "canProceed") !== true) return;
      const parsed: unknown = Reflect.apply(parseInt, undefined, [
        input.decimals ?? 0,
      ]);
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
