import { describe, expect, it } from "vitest";
import {
  getStorageRecord,
  getStoredValue,
  isArrayOf,
  isBooleanRecord,
  isConnectedAccounts,
  isContact,
  isDAppRequest,
  isLedgerAccount,
  isNFTCollection,
  isPriceCache,
  isStoredBlockchain,
  isStoredKeystore,
  isStoredPermission,
  isStringRecord,
  isTokenContract,
  isTransactionHistoryEntry,
  isTransactionValues,
  isWalletSettings,
} from "./storageGuards";
import {
  ACCOUNT,
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
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const DETAILS = {
  isZrc20Token: true,
  tokenContractAddress: TOKEN.address,
  tokenDecimals: 18,
  tokenImage: "",
  tokenBalance: "3",
  tokenName: "Token",
  tokenSymbol: "TOK",
};
const PRICE = {
  prices: { usd: 1 },
  change24h: { usd: -2 },
  timestamp: 1700000000000,
};
const PERMISSION = CONNECTION.permissions[0];

describe("storage record guards", () => {
  const cases: Array<
    [string, (value: unknown) => boolean, Record<string, unknown>, string[]]
  > = [
    [
      "chain",
      isStoredBlockchain,
      CHAIN,
      [
        "chainId",
        "chainName",
        "rpcUrls",
        "nativeCurrency",
        "defaultRpcUrl",
        "defaultBlockExplorerUrl",
        "defaultIconUrl",
        "defaultWsRpcUrl",
        "isTestnet",
        "isCustomChain",
      ],
    ],
    [
      "token",
      isTokenContract,
      TOKEN,
      ["address", "symbol", "decimals", "image"],
    ],
    [
      "NFT",
      isNFTCollection,
      NFT,
      ["address", "name", "symbol", "standard", "image"],
    ],
    [
      "history",
      isTransactionHistoryEntry,
      HISTORY,
      [
        "id",
        "from",
        "to",
        "amount",
        "tokenSymbol",
        "tokenName",
        "isZrc20Token",
        "tokenContractAddress",
        "tokenDecimals",
        "transactionHash",
        "blockNumber",
        "gasUsed",
        "effectiveGasPrice",
        "status",
        "timestamp",
        "chainId",
      ],
    ],
    ["connection", isConnectedAccounts, CONNECTION, ["urlOrigin", "accounts"]],
    [
      "permission",
      isStoredPermission,
      PERMISSION,
      ["invoker", "parentCapability"],
    ],
    [
      "Ledger",
      isLedgerAccount,
      LEDGER,
      ["address", "derivationPath", "publicKey", "index"],
    ],
    [
      "contact",
      isContact,
      { name: "Contact", address: ACCOUNT },
      ["name", "address"],
    ],
    ["request", isDAppRequest, { method: "qrl_accounts" }, ["method"]],
    [
      "keystore",
      isStoredKeystore,
      { address: ACCOUNT, crypto: {} },
      ["address", "crypto"],
    ],
    ["price cache", isPriceCache, PRICE, ["prices", "change24h", "timestamp"]],
  ];

  it.each(cases)(
    "accepts valid %s records and rejects missing or wrong required fields",
    (_name, guard, valid, required) => {
      expect(guard(valid)).toBe(true);
      expect(guard({ ...valid, extensionField: { keep: true } })).toBe(true);
      for (const key of required) {
        const missing = { ...valid };
        delete missing[key];
        expect(guard(missing), `missing ${key}`).toBe(false);
        expect(
          guard({
            ...valid,
            [key]: key === "crypto" ? false : { wrong: true },
          }),
          `wrong type ${key}`,
        ).toBe(false);
      }
      for (const junk of [undefined, null, false, 1, "junk", [], [valid], {}])
        expect(guard(junk)).toBe(false);
    },
  );

  it("accepts optional chain metadata and nullable currency without filling fields", () => {
    expect(isStoredBlockchain(CHAIN)).toBe(true);
    expect(isStoredBlockchain({ ...CHAIN, nativeCurrency: null })).toBe(true);
    expect(
      isStoredBlockchain({ ...CHAIN, blockExplorerUrls: null, iconUrls: null }),
    ).toBe(true);
    expect(
      isStoredBlockchain({
        ...CHAIN,
        blockExplorerUrls: [],
        iconUrls: [],
        nativeCurrency: { name: null, symbol: "TOK", decimals: 18 },
      }),
    ).toBe(true);
    for (const field of ["blockExplorerUrls", "iconUrls"]) {
      for (const wrong of ["https://example.com", [7], {}, 1])
        expect(isStoredBlockchain({ ...CHAIN, [field]: wrong })).toBe(false);
    }
    expect(
      isStoredBlockchain({ ...CHAIN, nativeCurrency: { symbol: "TOK" } }),
    ).toBe(false);
    expect(
      isStoredBlockchain({
        ...CHAIN,
        nativeCurrency: { name: 1, symbol: "TOK", decimals: 18 },
      }),
    ).toBe(false);
  });

  it.each([null, Number.NaN, Infinity, -Infinity, 0, 18])(
    "accepts writer-produced decimals %s for tokens, history and saved transfer details",
    (decimals) => {
      const token = { ...TOKEN, decimals };
      const history = { ...HISTORY, tokenDecimals: decimals };
      const transfer = {
        tokenDetails: { ...DETAILS, tokenDecimals: decimals },
      };
      for (const [guard, record] of [
        [isTokenContract, token],
        [isTransactionHistoryEntry, history],
        [isTransactionValues, transfer],
      ] as const) {
        expect(guard(record)).toBe(true);
        expect(guard(JSON.parse(JSON.stringify(record)))).toBe(true);
      }
    },
  );

  it("accepts legacy and current permission and request envelopes", () => {
    expect(
      isConnectedAccounts({
        urlOrigin: CONNECTION.urlOrigin,
        accounts: [ACCOUNT],
      }),
    ).toBe(true);
    expect(
      isConnectedAccounts({
        ...CONNECTION,
        blockchains: null,
        permissions: null,
      }),
    ).toBe(true);
    expect(isStoredPermission({ ...PERMISSION, caveats: undefined })).toBe(
      true,
    );
    expect(isStoredPermission({ ...PERMISSION, caveats: null })).toBe(true);
    expect(isConnectedAccounts({ ...CONNECTION, accounts: [3] })).toBe(false);
    expect(isConnectedAccounts({ ...CONNECTION, blockchains: [null] })).toBe(
      false,
    );
    expect(isConnectedAccounts({ ...CONNECTION, permissions: [null] })).toBe(
      false,
    );
    expect(
      isStoredPermission({
        ...PERMISSION,
        caveats: [{ type: "restrictReturnedAccounts", value: [3] }],
      }),
    ).toBe(false);
    expect(
      isStoredPermission({
        ...PERMISSION,
        caveats: [{ type: "unknown", value: [] }],
      }),
    ).toBe(false);
    const request = {
      method: "qrl_sendTransaction",
      params: [{ from: ACCOUNT }],
      requestId: "r1",
      authorizedChainId: CHAIN.chainId,
      requestData: {
        senderData: {
          tabId: 2,
          title: "dApp",
          url: CONNECTION.urlOrigin,
          favIconUrl: "",
          mainFrameOrigin: CONNECTION.urlOrigin,
        },
      },
      phishingResult: { isDomainPhishing: false, detectorStatus: "ready" },
    };
    expect(isDAppRequest(request)).toBe(true);
    expect(isDAppRequest({ ...request, requestId: 1 })).toBe(false);
    expect(
      isDAppRequest({
        ...request,
        requestData: { senderData: { tabId: "2" } },
      }),
    ).toBe(false);
    expect(
      isDAppRequest({
        ...request,
        phishingResult: { isDomainPhishing: "false" },
      }),
    ).toBe(false);
  });

  it("accepts legacy history and all current optional receipt and replacement fields", () => {
    const legacy = { ...HISTORY, amount: 2, pendingStatus: undefined };
    expect(isTransactionHistoryEntry(legacy)).toBe(true);
    for (const pendingStatus of [
      "pending",
      "unknown",
      "confirmed",
      "failed",
      "replaced",
      "cancelled",
      "dropped",
    ]) {
      expect(
        isTransactionHistoryEntry({
          ...HISTORY,
          pendingStatus,
          nonce: 1,
          gasLimit: 21000,
          paidFeesQrl: "1",
          maxFeePerGas: "2",
          maxPriorityFeePerGas: "1",
          data: "0x",
          replacementTransactionHash: "next",
          replacedByAction: "speed-up",
          receiptStatusVerified: true,
          submissionRejected: false,
          isInternal: false,
        }),
      ).toBe(true);
    }
    expect(isTransactionHistoryEntry({ ...HISTORY, nonce: "1" })).toBe(false);
    expect(
      isTransactionHistoryEntry({ ...HISTORY, pendingStatus: "junk" }),
    ).toBe(false);
    expect(isTransactionValues({})).toBe(true);
    expect(
      isTransactionValues({
        receiverAddress: "",
        amount: 0,
        tokenDetails: DETAILS,
      }),
    ).toBe(true);
    expect(
      isTransactionValues({
        tokenDetails: { ...DETAILS, tokenDecimals: "18" },
      }),
    ).toBe(false);
  });

  it("accepts partial settings and both price-cache versions and rejects wrong field types", () => {
    const settings = {
      themePreference: "dark",
      autoLockMinutes: 0,
      currency: "EUR",
      language: "nl",
      defaultGasTier: "market",
      showBalanceAndPrice: true,
      sidePanelPreferred: false,
      notificationsEnabled: true,
      phishingDetectionEnabled: true,
      sidePanelSurface: "popup",
      sidePanelNoticePending: false,
      sidePanelNoticeSeen: true,
    };
    expect(isWalletSettings({})).toBe(true);
    expect(isWalletSettings(settings)).toBe(true);
    for (const key of Object.keys(settings)) {
      expect(isWalletSettings({ [key]: { junk: true } })).toBe(false);
      const missing: Record<string, unknown> = { ...settings };
      delete missing[key];
      expect(isWalletSettings(missing)).toBe(true);
    }
    expect(isPriceCache(PRICE)).toBe(true);
    expect(
      isPriceCache({ ...PRICE, updatedAt: { usd: PRICE.timestamp } }),
    ).toBe(true);
    expect(isPriceCache({ ...PRICE, updatedAt: { usd: "wrong" } })).toBe(false);
    expect(isStringRecord({ a: "label" })).toBe(true);
    expect(isStringRecord({ a: null })).toBe(false);
    expect(isBooleanRecord({ a: false })).toBe(true);
    expect(isBooleanRecord({ a: "false" })).toBe(false);
    expect(isArrayOf([TOKEN, null], isTokenContract)).toBe(false);
  });

  it("reads prototype-like keys only when they are own properties", () => {
    expect(getStoredValue({}, "__proto__")).toBeUndefined();
    expect(getStoredValue({}, "constructor")).toBeUndefined();
    expect(getStorageRecord({}, "constructor", "prototype")).toEqual({});
    const record: unknown = JSON.parse(
      '{"__proto__":{"value":1},"constructor":{"value":2}}',
    );
    expect(getStoredValue(record, "__proto__", "value")).toBe(1);
    expect(getStoredValue(record, "constructor", "value")).toBe(2);
  });

  it.each([CHAIN.nativeCurrency, null])(
    "accepts chain records produced from validator-approved minimal payloads (%j)",
    async (nativeCurrency) => {
      const stored = { ...CHAIN, nativeCurrency };
      const { canProceed } = await checkWalletAddQrlChainParams(stored, true);
      expect(canProceed).toBe(true);
      expect(isStoredBlockchain(JSON.parse(JSON.stringify(stored)))).toBe(true);
      const payload = {
        chainId: CHAIN.chainId,
        chainName: CHAIN.chainName,
        rpcUrls: CHAIN.rpcUrls,
        nativeCurrency,
      };
      // The request validator's public signature also includes storage metadata.
      expect(
        (await checkWalletAddQrlChainParams(payload as typeof CHAIN))
          .canProceed,
      ).toBe(true);
    },
  );

  it("accepts the serialized decimals produced by a validator-approved watchAsset request", async () => {
    const options = { ...TOKEN, decimals: "abc" };
    expect(
      (
        await checkWalletWatchAssetParams({
          type: "ZRC20",
          options: options as unknown as typeof TOKEN & { decimals: number },
        })
      ).canProceed,
    ).toBe(true);
    const stored: unknown = JSON.parse(
      JSON.stringify({ ...options, decimals: parseInt(options.decimals) }),
    );
    expect(isTokenContract(stored)).toBe(true);
  });
});
