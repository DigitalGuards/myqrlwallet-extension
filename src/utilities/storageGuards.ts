import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import type {
  ConnectedAccountsDataType,
  DAppRequestType,
  Permission,
  TokenContractType,
} from "@/scripts/middlewares/middlewareTypes";
import type { LedgerAccount } from "@/services/ledger/ledgerTypes";
import type { Contact } from "@/types/contact";
import type { NFTCollectionType } from "@/types/nft";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import type {
  PriceCache,
  TransactionValuesType,
  WalletSettings,
} from "@/utilities/storageUtil";
import {
  isCanonicalQrlAddress,
  isLegacyQrlAddress,
  isQrlAddress,
} from "@/utilities/addressUtil";
import type { KeyStore } from "@theqrl/web3";

type Guard<T> = (value: unknown) => value is T;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isString = (value: unknown): value is string =>
  typeof value === "string";
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
const isStoredNumber = (value: unknown): value is number | null =>
  value === null || typeof value === "number";
const isOptional = <T>(
  value: unknown,
  guard: Guard<T>,
): value is T | undefined => value === undefined || guard(value);

export const isArrayOf = <T>(value: unknown, guard: Guard<T>): value is T[] =>
  Array.isArray(value) &&
  Array.from(value).every((item: unknown) => guard(item));

export const isStringArray = (value: unknown): value is string[] =>
  isArrayOf(value, isString);

const warnedLists = new Set<string>();

// Keep raw records for writers. A present array never uses a default list.
export const getStorageArray = (
  value: unknown,
  listName: string,
  fallback: unknown[] = [],
): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value !== undefined && !warnedLists.has(listName)) {
    warnedLists.add(listName);
    console.warn(
      `Wallet storage ${listName} is not an array; using its default list.`,
    );
  }
  return fallback;
};

// Bulk setters receive the visible list. Retain unreadable records at their
// original positions relative to surviving records, including duplicate keys.
export const mergeStorageArray = <T>(
  stored: unknown[],
  replacements: T[],
  guard: Guard<T>,
  key: (record: T) => string,
): unknown[] => {
  if (stored.every(guard)) return replacements;
  const remaining = [...replacements];
  const merged: unknown[] = [];
  for (const record of stored) {
    if (!guard(record)) {
      merged.push(record);
      continue;
    }
    const index = remaining.findIndex((item) => key(item) === key(record));
    if (index >= 0) merged.push(...remaining.splice(index, 1));
  }
  return [...merged, ...remaining];
};

export const filterStorageRecord = <T>(
  value: unknown,
  guard: Guard<T>,
): Record<string, T> => {
  const result: Record<string, T> = {};
  for (const [key, item] of Object.entries(getStorageRecord(value))) {
    if (guard(item)) {
      Object.defineProperty(result, key, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return result;
};

export const mergeStorageRecord = <T>(
  value: unknown,
  replacements: Record<string, T>,
  guard: Guard<T>,
): Record<string, unknown> => {
  const stored = getStorageRecord(value);
  if (Object.values(stored).every(guard)) return replacements;
  const entries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(stored)) {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      entries.push([key, replacements[key]]);
    } else if (!guard(item)) {
      entries.push([key, item]);
    }
  }
  for (const [key, item] of Object.entries(replacements)) {
    if (!Object.prototype.hasOwnProperty.call(stored, key))
      entries.push([key, item]);
  }
  return Object.fromEntries(entries);
};

export const isRecordOf = <T>(
  value: unknown,
  guard: Guard<T>,
): value is Record<string, T> =>
  isRecord(value) && Object.values(value).every(guard);

export const isStringRecord = (
  value: unknown,
): value is Record<string, string> => isRecordOf(value, isString);
export const isBooleanRecord = (
  value: unknown,
): value is Record<string, boolean> => isRecordOf(value, isBoolean);

// Read only own properties so malformed keys cannot traverse a prototype.
export const getStoredValue = (value: unknown, ...keys: string[]): unknown => {
  for (const key of keys) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, key)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
};

export const getStorageRecord = (
  value: unknown,
  ...keys: string[]
): Record<string, unknown> => {
  const stored = getStoredValue(value, ...keys);
  return isRecord(stored) ? stored : {};
};

// Writers repair only their target path and preserve sibling records.
export const ensureStorageRecord = (
  value: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> => {
  for (const key of keys) {
    const stored = getStorageRecord(value, key);
    Object.defineProperty(value, key, {
      value: stored,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    value = stored;
  }
  return value;
};

// Validate the storage envelope here; decryption validates crypto parameters.
export const isStoredKeystore = (value: unknown): value is KeyStore =>
  isRecord(value) &&
  typeof value.address === "string" &&
  (isQrlAddress(value.address) || isLegacyQrlAddress(value.address)) &&
  isRecord(value.crypto);

// QRNS data is sanitized separately on read, preserving the existing migration.
export type StoredBlockchain = Omit<
  BlockchainDataType,
  "qrnsRegistryAddress"
> & {
  qrnsRegistryAddress?: unknown;
};

export const hasCanonicalRegistry = (
  chain: StoredBlockchain,
): chain is BlockchainDataType =>
  chain.qrnsRegistryAddress === undefined ||
  isCanonicalQrlAddress(chain.qrnsRegistryAddress);

export const isStoredBlockchain = (value: unknown): value is StoredBlockchain =>
  isRecord(value) &&
  isString(value.chainId) &&
  isString(value.chainName) &&
  isStringArray(value.rpcUrls) &&
  (value.blockExplorerUrls === null ||
    isOptional(value.blockExplorerUrls, isStringArray)) &&
  (value.iconUrls === null || isOptional(value.iconUrls, isStringArray)) &&
  (value.nativeCurrency === null ||
    (isRecord(value.nativeCurrency) &&
      (value.nativeCurrency.name === null ||
        isOptional(value.nativeCurrency.name, isString)) &&
      isString(value.nativeCurrency.symbol) &&
      isFiniteNumber(value.nativeCurrency.decimals))) &&
  isString(value.defaultRpcUrl) &&
  isString(value.defaultBlockExplorerUrl) &&
  isString(value.defaultIconUrl) &&
  isString(value.defaultWsRpcUrl) &&
  isBoolean(value.isTestnet) &&
  isBoolean(value.isCustomChain);

export const isTokenContract = (value: unknown): value is TokenContractType =>
  isRecord(value) &&
  isString(value.address) &&
  isString(value.symbol) &&
  isStoredNumber(value.decimals) &&
  isString(value.image);

export const isNFTCollection = (value: unknown): value is NFTCollectionType =>
  isRecord(value) &&
  isString(value.address) &&
  isString(value.name) &&
  isString(value.symbol) &&
  (value.standard === "ZRC721" || value.standard === "ZRC1155") &&
  isString(value.image);

export const isContact = (value: unknown): value is Contact =>
  isRecord(value) && isString(value.name) && isString(value.address);

export const isLedgerAccount = (value: unknown): value is LedgerAccount =>
  isRecord(value) &&
  isString(value.address) &&
  isString(value.derivationPath) &&
  isString(value.publicKey) &&
  isFiniteNumber(value.index);

const isAmount = (value: unknown): value is string | number =>
  isString(value) || isFiniteNumber(value);

const isTokenDetails = (
  value: unknown,
): value is NonNullable<TransactionValuesType["tokenDetails"]> =>
  isRecord(value) &&
  isBoolean(value.isZrc20Token) &&
  isString(value.tokenContractAddress) &&
  isStoredNumber(value.tokenDecimals) &&
  isString(value.tokenImage) &&
  isString(value.tokenBalance) &&
  isOptional(value.tokenBalanceBaseUnits, isString) &&
  isString(value.tokenName) &&
  isString(value.tokenSymbol);

export const isTransactionValues = (
  value: unknown,
): value is TransactionValuesType =>
  isRecord(value) &&
  isOptional(value.receiverAddress, isString) &&
  isOptional(value.amount, isAmount) &&
  isOptional(value.tokenDetails, isTokenDetails);

export const isTransactionHistoryEntry = (
  value: unknown,
): value is TransactionHistoryEntry =>
  isRecord(value) &&
  [
    "id",
    "from",
    "to",
    "tokenSymbol",
    "tokenName",
    "tokenContractAddress",
    "transactionHash",
    "blockNumber",
    "gasUsed",
    "effectiveGasPrice",
    "chainId",
  ].every((key) => isString(value[key])) &&
  isAmount(value.amount) &&
  isBoolean(value.isZrc20Token) &&
  isBoolean(value.status) &&
  isStoredNumber(value.tokenDecimals) &&
  isFiniteNumber(value.timestamp) &&
  [
    "paidFeesQrl",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "data",
    "replacementTransactionHash",
  ].every((key) => isOptional(value[key], isString)) &&
  ["receiptStatusVerified", "submissionRejected", "isInternal"].every((key) =>
    isOptional(value[key], isBoolean),
  ) &&
  isOptional(value.nonce, isFiniteNumber) &&
  isOptional(value.gasLimit, isFiniteNumber) &&
  (value.pendingStatus === undefined ||
    value.pendingStatus === "pending" ||
    value.pendingStatus === "unknown" ||
    value.pendingStatus === "confirmed" ||
    value.pendingStatus === "failed" ||
    value.pendingStatus === "replaced" ||
    value.pendingStatus === "cancelled" ||
    value.pendingStatus === "dropped") &&
  (value.replacedByAction === undefined ||
    value.replacedByAction === "speed-up" ||
    value.replacedByAction === "cancel");

export const isWalletSettings = (value: unknown): value is WalletSettings =>
  isRecord(value) &&
  (value.themePreference === undefined ||
    value.themePreference === "system" ||
    value.themePreference === "light" ||
    value.themePreference === "dark") &&
  isOptional(value.autoLockMinutes, isFiniteNumber) &&
  isOptional(value.currency, isString) &&
  isOptional(value.language, isString) &&
  (value.defaultGasTier === undefined ||
    value.defaultGasTier === "low" ||
    value.defaultGasTier === "market" ||
    value.defaultGasTier === "aggressive" ||
    value.defaultGasTier === "advanced") &&
  (value.sidePanelSurface === undefined ||
    value.sidePanelSurface === "panel" ||
    value.sidePanelSurface === "popup") &&
  [
    "showBalanceAndPrice",
    "sidePanelPreferred",
    "sidePanelNoticePending",
    "sidePanelNoticeSeen",
    "notificationsEnabled",
    "phishingDetectionEnabled",
  ].every((key) => isOptional(value[key], isBoolean));

export const isPriceCache = (value: unknown): value is PriceCache =>
  isRecord(value) &&
  isRecordOf(value.prices, isFiniteNumber) &&
  isRecordOf(value.change24h, isFiniteNumber) &&
  (value.updatedAt === undefined ||
    isRecordOf(value.updatedAt, isFiniteNumber)) &&
  isFiniteNumber(value.timestamp);

type StoredPermission = Omit<Permission, "caveats"> & {
  caveats?:
    | {
        type: "restrictReturnedAccounts" | "restrictNetworkSwitching";
        value: string[];
      }[]
    | null;
};

export const isStoredPermission = (value: unknown): value is StoredPermission =>
  isRecord(value) &&
  isString(value.invoker) &&
  (value.parentCapability === "qrl_accounts" ||
    value.parentCapability === "qrl_chains") &&
  (value.caveats == null ||
    isArrayOf(
      value.caveats,
      (
        caveat: unknown,
      ): caveat is NonNullable<StoredPermission["caveats"]>[number] =>
        isRecord(caveat) &&
        (caveat.type === "restrictReturnedAccounts" ||
          caveat.type === "restrictNetworkSwitching") &&
        isStringArray(caveat.value),
    ));

export type StoredConnectedAccounts = Omit<
  ConnectedAccountsDataType,
  "blockchains" | "permissions"
> & {
  blockchains?: StoredBlockchain[] | null;
  permissions?: StoredPermission[] | null;
};

export const isConnectedAccounts = (
  value: unknown,
): value is StoredConnectedAccounts =>
  isRecord(value) &&
  isString(value.urlOrigin) &&
  isStringArray(value.accounts) &&
  (value.blockchains == null ||
    isArrayOf(value.blockchains, isStoredBlockchain)) &&
  (value.permissions == null ||
    isArrayOf(value.permissions, isStoredPermission));

export const isDAppRequest = (value: unknown): value is DAppRequestType => {
  if (
    !isRecord(value) ||
    !isString(value.method) ||
    !isOptional(value.requestId, isString) ||
    !isOptional(value.authorizedChainId, isString)
  )
    return false;
  if (value.requestData !== undefined) {
    if (!isRecord(value.requestData)) return false;
    const sender = value.requestData.senderData;
    if (
      sender !== undefined &&
      (!isRecord(sender) ||
        !isOptional(sender.tabId, isFiniteNumber) ||
        !["title", "url", "favIconUrl"].every((key) =>
          isOptional(sender[key], isString),
        ))
    )
      return false;
  }
  if (value.phishingResult !== undefined) {
    const phishing = value.phishingResult;
    if (
      !isRecord(phishing) ||
      !isBoolean(phishing.isDomainPhishing) ||
      !isOptional(phishing.matchType, isString) ||
      !isOptional(phishing.matchedDomain, isString) ||
      (phishing.detectorStatus !== undefined &&
        phishing.detectorStatus !== "ready" &&
        phishing.detectorStatus !== "initializing" &&
        phishing.detectorStatus !== "unavailable")
    )
      return false;
  }
  // Each method validates its own params at the approval boundary.
  return true;
};
