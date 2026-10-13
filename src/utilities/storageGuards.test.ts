import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import {
  ensureStorageRecord,
  getStorageRecord,
  getStoredValue,
  isArrayOf,
  isBooleanRecord,
  isConnectedAccounts,
  isContact,
  isDAppRequest,
  isFiniteNumber,
  isLedgerAccount,
  isNFTCollection,
  isPriceCache,
  isRecord,
  isRecordOf,
  isStoredBlockchain,
  isStoredKeystore,
  isStoredPermission,
  isStringArray,
  isStringRecord,
  isTokenContract,
  isTransactionHistoryEntry,
  isTransactionValues,
  isWalletSettings,
} from "./storageGuards";

const address = toCanonicalQrlAddress(`Q${"a".repeat(128)}`);
const tokenDetails = {
  isZrc20Token: true,
  tokenContractAddress: address,
  tokenDecimals: 18,
  tokenImage: "",
  tokenBalance: "1",
  tokenBalanceBaseUnits: "1000000000000000000",
  tokenName: "Token",
  tokenSymbol: "TOK",
};
const transaction = {
  id: "tx",
  from: address,
  to: address,
  amount: "1",
  tokenSymbol: "TOK",
  tokenName: "Token",
  isZrc20Token: true,
  tokenContractAddress: address,
  tokenDecimals: 18,
  transactionHash: "hash",
  blockNumber: "1",
  gasUsed: "21000",
  effectiveGasPrice: "1",
  status: true,
  timestamp: 123,
  chainId: "0x1",
};
const permission = {
  invoker: "https://dapp.example",
  parentCapability: "qrl_accounts",
  caveats: [{ type: "restrictReturnedAccounts", value: [address] }],
};
const connected = {
  urlOrigin: "https://dapp.example",
  accounts: [address],
  blockchains: [DEFAULT_BLOCKCHAIN],
  permissions: [permission],
};

const cases: {
  name: string;
  guard: (value: unknown) => boolean;
  valid: unknown[];
  wrong: unknown;
  junk: unknown[];
}[] = [
  {
    name: "isRecord",
    guard: isRecord,
    valid: [{}, { nested: [] }],
    wrong: [],
    junk: [null, "{}", 1],
  },
  {
    name: "isFiniteNumber",
    guard: isFiniteNumber,
    valid: [0, 123],
    wrong: "123",
    junk: [NaN, Infinity, -Infinity],
  },
  {
    name: "isArrayOf",
    guard: (value) => isArrayOf(value, isFiniteNumber),
    valid: [[], [1, 2]],
    wrong: {},
    junk: [[1, "2"], [null], new Array(1)],
  },
  {
    name: "isRecordOf",
    guard: (value) => isRecordOf(value, isFiniteNumber),
    valid: [{}, { usd: 1 }],
    wrong: [],
    junk: [{ usd: "1" }, { usd: NaN }],
  },
  {
    name: "isStringArray",
    guard: isStringArray,
    valid: [[], [address, "legacy"]],
    wrong: "[]",
    junk: [[address, 1], [null], new Array(1)],
  },
  {
    name: "isStringRecord",
    guard: isStringRecord,
    valid: [{}, { [address]: "Savings" }],
    wrong: [],
    junk: [{ name: 1 }, { name: {} }],
  },
  {
    name: "isBooleanRecord",
    guard: isBooleanRecord,
    valid: [{}, { [address]: false }],
    wrong: false,
    junk: [{ hidden: "false" }, { hidden: 0 }],
  },
  {
    name: "isStoredKeystore",
    guard: isStoredKeystore,
    valid: [
      { address, crypto: {} },
      { address: `Q${"a".repeat(40)}`, crypto: {} },
    ],
    wrong: "{}",
    junk: [
      { address },
      { address: "Q123", crypto: {} },
      { address, crypto: [] },
    ],
  },
  {
    name: "isStoredBlockchain",
    guard: isStoredBlockchain,
    valid: [
      DEFAULT_BLOCKCHAIN,
      { ...DEFAULT_BLOCKCHAIN, qrnsRegistryAddress: null },
    ],
    wrong: [],
    junk: [
      { chainId: "0x1" },
      { ...DEFAULT_BLOCKCHAIN, rpcUrls: [1] },
      { ...DEFAULT_BLOCKCHAIN, nativeCurrency: {} },
    ],
  },
  {
    name: "isTokenContract",
    guard: isTokenContract,
    valid: [{ address, symbol: "TOK", decimals: 18, image: "" }],
    wrong: [],
    junk: [{ address }, { address, symbol: "TOK", decimals: "18", image: "" }],
  },
  {
    name: "isNFTCollection",
    guard: isNFTCollection,
    valid: ["ZRC721", "ZRC1155"].map((standard) => ({
      address,
      name: "NFT",
      symbol: "NFT",
      image: "",
      standard,
    })),
    wrong: [],
    junk: [
      { address },
      { address, name: "NFT", symbol: "NFT", image: "", standard: "ERC721" },
    ],
  },
  {
    name: "isContact",
    guard: isContact,
    valid: [{ name: "Savings", address }],
    wrong: "contact",
    junk: [{ address }, { name: 1, address }],
  },
  {
    name: "isLedgerAccount",
    guard: isLedgerAccount,
    valid: [
      { address, derivationPath: "m/44'/238'/0'/0/0", publicKey: "", index: 0 },
    ],
    wrong: [],
    junk: [
      { address },
      { address, derivationPath: "m", publicKey: "", index: NaN },
    ],
  },
  {
    name: "isTransactionValues",
    guard: isTransactionValues,
    valid: [
      {},
      { receiverAddress: address, amount: 1 },
      { amount: "1", tokenDetails },
    ],
    wrong: [],
    junk: [
      { amount: {} },
      { amount: NaN },
      { tokenDetails: {} },
      { tokenDetails: { ...tokenDetails, tokenBalanceBaseUnits: 1 } },
    ],
  },
  {
    name: "isTransactionHistoryEntry",
    guard: isTransactionHistoryEntry,
    valid: [
      transaction,
      {
        ...transaction,
        amount: 1,
        pendingStatus: "pending",
        nonce: 0,
        gasLimit: 21000,
        replacedByAction: "speed-up",
        paidFeesQrl: "1",
        receiptStatusVerified: true,
      },
    ],
    wrong: [],
    junk: [
      {},
      { ...transaction, status: "true" },
      { ...transaction, timestamp: NaN },
      { ...transaction, pendingStatus: "junk" },
      { ...transaction, paidFeesQrl: 1 },
      { ...transaction, submissionRejected: 0 },
      { ...transaction, nonce: "0" },
      { ...transaction, replacedByAction: "junk" },
    ],
  },
  {
    name: "isWalletSettings",
    guard: isWalletSettings,
    valid: [
      {},
      {
        themePreference: "system",
        autoLockMinutes: 0,
        currency: "USD",
        language: "en",
        defaultGasTier: "advanced",
        sidePanelSurface: "popup",
        showBalanceAndPrice: false,
      },
    ],
    wrong: [],
    junk: [
      { autoLockMinutes: "0" },
      { autoLockMinutes: Infinity },
      { themePreference: "junk" },
      { defaultGasTier: "junk" },
      { sidePanelSurface: "junk" },
      { phishingDetectionEnabled: "false" },
    ],
  },
  {
    name: "isPriceCache",
    guard: isPriceCache,
    valid: [
      { prices: {}, change24h: {}, timestamp: 0 },
      {
        prices: { usd: 1 },
        change24h: { usd: -2 },
        updatedAt: { usd: 123 },
        timestamp: 123,
      },
    ],
    wrong: [],
    junk: [
      {},
      { prices: { usd: "1" }, change24h: {}, timestamp: 1 },
      { prices: {}, change24h: {}, timestamp: 1, updatedAt: { usd: NaN } },
    ],
  },
  {
    name: "isStoredPermission",
    guard: isStoredPermission,
    valid: [
      permission,
      {
        ...permission,
        parentCapability: "qrl_chains",
        caveats: [{ type: "restrictNetworkSwitching", value: ["0x1"] }],
      },
    ],
    wrong: [],
    junk: [
      {},
      { ...permission, parentCapability: "junk" },
      { ...permission, caveats: new Array(1) },
      { ...permission, caveats: [{}] },
      {
        ...permission,
        caveats: [{ type: "restrictReturnedAccounts", value: [1] }],
      },
    ],
  },
  {
    name: "isConnectedAccounts",
    guard: isConnectedAccounts,
    valid: [
      connected,
      { ...connected, accounts: [], permissions: [], blockchains: [] },
    ],
    wrong: [],
    junk: [
      {},
      { ...connected, accounts: [1] },
      { ...connected, permissions: [{}] },
      { ...connected, blockchains: [{}] },
    ],
  },
  {
    name: "isDAppRequest",
    guard: isDAppRequest,
    valid: [
      { method: "qrl_requestAccounts" },
      {
        method: "qrl_sign",
        params: [address, "message"],
        requestId: "id",
        authorizedChainId: "0x1",
        requestData: {
          senderData: {
            tabId: 1,
            title: "dApp",
            url: "https://dapp.example",
            favIconUrl: "",
          },
        },
        phishingResult: { isDomainPhishing: false, detectorStatus: "ready" },
      },
    ],
    wrong: [],
    junk: [
      {},
      { method: 1 },
      { method: "qrl_sign", requestId: 1 },
      { method: "qrl_sign", requestData: { senderData: { tabId: "1" } } },
      { method: "qrl_sign", phishingResult: { isDomainPhishing: "false" } },
      {
        method: "qrl_sign",
        phishingResult: { isDomainPhishing: false, detectorStatus: "junk" },
      },
    ],
  },
];

describe.each(cases)("$name", ({ guard, valid, wrong, junk }) => {
  it("accepts valid data", () => {
    for (const value of valid) expect(guard(value)).toBe(true);
  });
  it("rejects missing data", () => {
    expect(guard(undefined)).toBe(false);
    expect(guard(null)).toBe(false);
  });
  it("rejects the wrong type", () => {
    expect(guard(wrong)).toBe(false);
  });
  it("rejects junk", () => {
    for (const value of junk) expect(guard(value)).toBe(false);
  });
});

describe("storage record traversal", () => {
  it("reads valid leaves and defaults missing or malformed paths", () => {
    const leaf = { tokens: [] };
    expect(getStoredValue({ account: leaf }, "account")).toBe(leaf);
    expect(getStorageRecord({ account: leaf }, "account")).toBe(leaf);
    for (const value of [undefined, null, "junk", 1, [], { account: false }]) {
      expect(getStoredValue(value, "account", "tokens")).toBeUndefined();
      expect(getStorageRecord(value, "account")).toEqual({});
    }
  });

  it("rejects inherited properties", () => {
    const value: unknown = Object.create({ account: { tokens: [1] } });
    expect(getStoredValue(value, "account")).toBeUndefined();
    expect(getStorageRecord(value, "account")).toEqual({});
  });

  it("repairs a writer's path while preserving siblings", () => {
    for (const broken of [undefined, null, "junk", 1, []]) {
      const value = { account: broken, sibling: { tokens: ["retained"] } };
      const leaf = ensureStorageRecord(value, "account", "chain");
      leaf.tokens = [];
      expect(value).toEqual({
        account: { chain: { tokens: [] } },
        sibling: { tokens: ["retained"] },
      });
    }
    const leaf = { tokens: ["existing"] };
    expect(ensureStorageRecord({ account: leaf }, "account")).toBe(leaf);
  });

  it("treats prototype-shaped keys as own data", () => {
    const value = {};
    ensureStorageRecord(value, "__proto__").tokens = [];
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(getStoredValue(value, "__proto__", "tokens")).toEqual([]);
    expect(getStoredValue({}, "__proto__")).toBeUndefined();
  });
});
