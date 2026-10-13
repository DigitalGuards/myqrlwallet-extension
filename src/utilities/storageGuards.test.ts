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
  isNormalizableContact,
  isNormalizableQrlAddress,
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
  it.each([
    ACCOUNT,
    ACCOUNT.toLowerCase(),
    `q${ACCOUNT.slice(1)}`,
    `0x${ACCOUNT.slice(1)}`,
    `0X${ACCOUNT.slice(1)}`,
  ])("accepts normalizable account and contact addresses (%s)", (address) => {
    expect(isNormalizableQrlAddress(address)).toBe(true);
    expect(isNormalizableContact({ name: "Contact", address })).toBe(true);
    expect(isNormalizableContact({ address })).toBe(true);
    expect(isNormalizableContact({ name: null, address })).toBe(true);
  });

  it.each([
    undefined,
    null,
    false,
    1,
    [],
    {},
    "junk",
    `Q${"a".repeat(40)}`,
    `Q${"a".repeat(127)}A`,
  ])("rejects unusable account and contact addresses (%j)", (address) => {
    expect(isNormalizableQrlAddress(address)).toBe(false);
    expect(isNormalizableContact({ name: "Contact", address })).toBe(false);
  });

  const cases: Array<
    [string, (value: unknown) => boolean, Record<string, unknown>, string[]]
  > = [
    ["chain", isStoredBlockchain, CHAIN, ["chainId"]],
    ["token", isTokenContract, TOKEN, ["address"]],
    ["NFT", isNFTCollection, NFT, ["address"]],
    ["history", isTransactionHistoryEntry, HISTORY, ["transactionHash"]],
    ["connection", isConnectedAccounts, CONNECTION, ["urlOrigin"]],
    [
      "permission",
      isStoredPermission,
      PERMISSION,
      ["invoker", "parentCapability"],
    ],
    ["Ledger", isLedgerAccount, LEDGER, ["address"]],
    ["contact", isContact, { name: "Contact", address: ACCOUNT }, ["address"]],
    ["request", isDAppRequest, { method: "qrl_accounts" }, ["method"]],
    [
      "keystore",
      isStoredKeystore,
      { address: ACCOUNT, crypto: {} },
      ["address", "crypto"],
    ],
  ];

  it.each(cases)(
    "accepts valid %s records and rejects missing or wrong required fields",
    (_name, guard, valid, required) => {
      expect(guard(valid)).toBe(true);
      expect(guard({ ...valid, extensionField: { keep: true } })).toBe(true);
      for (const key of required) {
        const missing = { ...valid };
        Reflect.deleteProperty(missing, key);
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

  it.each(cases.slice(0, 5))(
    "accepts every non-identity field in %s records",
    (_name, guard, base, identity) => {
      for (const key of Object.keys(base).filter(
        (key) => !identity.includes(key),
      )) {
        for (const value of [
          undefined,
          null,
          "",
          false,
          0,
          [],
          {},
          "x".repeat(4096),
        ]) {
          expect(guard({ ...base, [key]: value }), key).toBe(true);
        }
      }
    },
  );

  it("accepts price cache objects independently of their currency data", () => {
    for (const cache of [
      {},
      PRICE,
      { prices: { usd: 1.23, eur: null } },
      { timestamp: false, prices: [] },
    ])
      expect(isPriceCache(cache)).toBe(true);
    for (const junk of [undefined, null, false, 0, "", []])
      expect(isPriceCache(junk)).toBe(false);
  });

  it.each([null, Number.NaN, Infinity, -Infinity, 0, 18])(
    "accepts writer-produced decimals %s for tokens, history and saved transfer details",
    (decimals) => {
      const token = { ...TOKEN, decimals };
      const history = { ...HISTORY, tokenDecimals: decimals };
      const transfer = {
        tokenDetails: { ...DETAILS, tokenDecimals: decimals },
      };
      expect(isTokenContract(token)).toBe(true);
      expect(isTransactionHistoryEntry(history)).toBe(true);
      expect(isTransactionValues(transfer)).toBe(true);
      const serialized: unknown = JSON.parse(JSON.stringify(token));
      expect(isTokenContract(serialized)).toBe(true);
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
    expect(isConnectedAccounts({ ...CONNECTION, accounts: [3] })).toBe(true);
    expect(isConnectedAccounts({ ...CONNECTION, blockchains: [null] })).toBe(
      true,
    );
    expect(isConnectedAccounts({ ...CONNECTION, permissions: [null] })).toBe(
      true,
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
    expect(isTransactionHistoryEntry({ ...HISTORY, nonce: "1" })).toBe(true);
    expect(
      isTransactionHistoryEntry({ ...HISTORY, pendingStatus: "junk" }),
    ).toBe(true);
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
      Reflect.deleteProperty(missing, key);
      expect(isWalletSettings(missing)).toBe(true);
    }
    expect(isPriceCache(PRICE)).toBe(true);
    expect(
      isPriceCache({ ...PRICE, updatedAt: { usd: PRICE.timestamp } }),
    ).toBe(true);
    expect(isPriceCache({ ...PRICE, updatedAt: { usd: "wrong" } })).toBe(true);
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
      const result = await checkWalletAddQrlChainParams(payload);
      expect(result).toMatchObject({ canProceed: true });
    },
  );

  it("accepts serialized decimals from legacy watchAsset writes", () => {
    const options = { ...TOKEN, decimals: "abc" };
    const stored: unknown = JSON.parse(
      JSON.stringify({ ...options, decimals: parseInt(options.decimals) }),
    );
    expect(isTokenContract(stored)).toBe(true);
  });

  it.each(["abc", "18", NaN, Infinity])(
    "rejects invalid decimals in a new watchAsset request (%s)",
    async (decimals) => {
      const result = await checkWalletWatchAssetParams({
        type: "ZRC20",
        options: { ...TOKEN, decimals },
      });
      expect(result).toMatchObject({
        canProceed: false,
        proceedError: { code: -32602 },
      });
    },
  );
});
