import {
  CHAIN,
  TOKEN,
  NFT,
  HISTORY,
  CONNECTION,
  LEDGER,
  ACCOUNT,
} from "./storageFixtures";

export const storageMutationValues: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["false", false],
  ["zero", 0],
  ["array", []],
  ["object", {}],
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
  price: {
    prices: { usd: 1.23, eur: 1.1 },
    change24h: { usd: 1, eur: 0.5 },
    updatedAt: { usd: 1700000000000, eur: 1700000000000 },
    timestamp: 1700000000000,
  },
};

export const fieldMutations = (base: Record<string, unknown>) =>
  Object.keys(base).flatMap((field) =>
    storageMutationValues.map(([label, value]) => ({
      label: `${field}: ${label}`,
      field,
      input: { ...base, [field]: value },
    })),
  );
