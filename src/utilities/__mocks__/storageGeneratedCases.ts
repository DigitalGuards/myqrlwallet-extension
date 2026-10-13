import {
  CHAIN,
  TOKEN,
  NFT,
  HISTORY,
  CONNECTION,
  LEDGER,
  ACCOUNT,
  OTHER_ACCOUNT,
} from "./storageFixtures";
import { isRecord } from "../storageGuards";

export const storageMutationValues: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["false", false],
  ["zero", 0],
  ["array", []],
  ["object", {}],
  ["NaN", Number.NaN],
  ["infinity", Number.POSITIVE_INFINITY],
  ["long string", "x".repeat(4096)],
];

export const storageWriterBases: Record<string, Record<string, unknown>> = {
  chain: {
    ...CHAIN,
    blockExplorerUrls: [],
    iconUrls: [],
    qrnsRegistryAddress: "",
  },
  token: { ...TOKEN, address: ACCOUNT },
  NFT: { ...NFT, address: ACCOUNT },
  history: {
    ...HISTORY,
    paidFeesQrl: "1",
    receiptStatusVerified: true,
    submissionRejected: false,
    isInternal: false,
    nonce: 1,
    gasLimit: 21000,
    maxFeePerGas: "1",
    maxPriorityFeePerGas: "1",
    data: "0x",
    replacementTransactionHash: "next",
    replacedByAction: "speed-up",
  },
  contact: { address: ACCOUNT, name: "Contact" },
  Ledger: { ...LEDGER },
  dApp: { ...CONNECTION },
  settings: {
    themePreference: "dark",
    autoLockMinutes: 1,
    currency: "EUR",
    language: "nl",
    defaultGasTier: "low",
    showBalanceAndPrice: false,
    sidePanelPreferred: false,
    sidePanelSurface: "popup",
    sidePanelNoticePending: false,
    sidePanelNoticeSeen: true,
    notificationsEnabled: false,
    phishingDetectionEnabled: true,
  },
  draft: {
    receiverAddress: OTHER_ACCOUNT,
    amount: "2",
    tokenDetails: {
      isZrc20Token: true,
      tokenContractAddress: TOKEN.address,
      tokenDecimals: 18,
      tokenImage: false,
      tokenBalance: "10",
      tokenBalanceBaseUnits: "10000000000000000000",
      tokenName: "Token",
      tokenSymbol: "TOK",
    },
  },
  request: {
    method: "qrl_accounts",
    params: [],
    requestId: "generated-request",
    authorizedChainId: CHAIN.chainId,
    requestData: {
      senderData: {
        tabId: 1,
        title: "dApp",
        url: CONNECTION.urlOrigin,
        favIconUrl: "",
      },
    },
    phishingResult: {
      isDomainPhishing: false,
      matchType: "none",
      matchedDomain: "",
      detectorStatus: "ready",
    },
  },
  keystore: {
    address: ACCOUNT,
    crypto: {},
    id: "generated-keystore",
    version: 4,
  },
  price: {
    prices: { usd: 1.23, eur: 1.1 },
    change24h: { usd: 1, eur: 0.5 },
    updatedAt: { usd: 1700000000000, eur: 1700000000000 },
    timestamp: 1700000000000,
  },
};

// Mutate nested fields as well as whole values. Mixed lists are seeded into
// storage separately because typed writers accept only their documented input.
export const nestedFieldMutations = (base: Record<string, unknown>) => {
  const visit = (
    value: Record<string, unknown>,
    prefix: string[],
  ): Array<{
    label: string;
    path: string[];
    input: Record<string, unknown>;
  }> =>
    Object.entries(value).flatMap(([field, original]) => {
      const path = [...prefix, field];
      const replace = (replacement: unknown) => ({
        ...value,
        [field]: replacement,
      });
      const direct = storageMutationValues.map(([label, replacement]) => ({
        label: `${path.join(".")}: ${label}`,
        path,
        input: replace(replacement),
      }));
      if (!isRecord(original)) return direct;
      return [
        ...direct,
        ...visit(original, path).map((mutation) => ({
          ...mutation,
          input: replace(mutation.input),
        })),
      ];
    });
  return visit(base, []);
};

export const fieldMutations = (base: Record<string, unknown>) =>
  Object.keys(base).flatMap((field) =>
    storageMutationValues.map(([label, value]) => ({
      label: `${field}: ${label}`,
      field,
      input: { ...base, [field]: value },
    })),
  );
