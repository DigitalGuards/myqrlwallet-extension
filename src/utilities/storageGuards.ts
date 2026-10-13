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
  toCanonicalQrlAddress,
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

// Apply supplied fields to the raw object, including nested metadata. Explicit
// undefined values clear a field when Chrome serializes the result.
export const mergeStorageFields = (
  stored: unknown,
  changes: unknown,
): unknown => {
  if (!isRecord(stored) || !isRecord(changes)) return changes;
  const result = Object.keys(stored).every((key) =>
    Object.prototype.hasOwnProperty.call(changes, key),
  )
    ? { ...changes }
    : { ...stored };
  for (const [key, value] of Object.entries(changes)) {
    Object.defineProperty(result, key, {
      value: mergeStorageFields(getStoredValue(stored, key), value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
};

// Whole-value setters replace their documented fields, including omitted
// optional fields. Fields from other versions stay attached to the raw record.
export const replaceStorageFields = (
  stored: unknown,
  changes: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> => {
  const raw = getStorageRecord(stored);
  if (Object.keys(raw).every((key) => fields.includes(key)))
    return { ...changes };
  const result = { ...raw };
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(changes, key))
      Reflect.deleteProperty(result, key);
  }
  for (const [key, value] of Object.entries(changes)) {
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
};

export const replaceStoredSettings = (
  stored: unknown,
  settings: WalletSettings,
): unknown => replaceStorageShape(stored, settings, storageShapes.settings);

export const replaceStoredRequest = (
  stored: unknown,
  request: DAppRequestType,
) => {
  const result = replaceStorageFields(stored, request, [
    "method",
    "params",
    "requestData",
    "phishingResult",
    "requestId",
    "authorizedChainId",
  ] satisfies Array<keyof DAppRequestType>);
  const requestData: unknown = request.requestData;
  if (isRecord(requestData)) {
    const rawData = getStoredValue(stored, "requestData");
    const data = replaceStorageFields(rawData, requestData, ["senderData"]);
    if (isRecord(requestData.senderData))
      data.senderData = replaceStorageFields(
        getStoredValue(rawData, "senderData"),
        requestData.senderData,
        ["tabId", "title", "url", "favIconUrl", "mainFrameOrigin"],
      );
    result.requestData = data;
  }
  const phishing: unknown = request.phishingResult;
  if (isRecord(phishing))
    result.phishingResult = replaceStorageFields(
      getStoredValue(stored, "phishingResult"),
      phishing,
      ["isDomainPhishing", "matchType", "matchedDomain", "detectorStatus"],
    );
  return result;
};

export const replaceStoredPriceCache = (
  stored: unknown,
  cache: PriceCache,
): unknown => replaceStorageShape(stored, cache, storageShapes.price);

// Bulk setters reconcile identities against the raw list. Unreadable siblings
// retain their positions; matching objects retain fields absent from the input.
export const mergeStorageArray = <T>(
  stored: unknown[],
  replacements: T[],
  guard: Guard<T>,
  key: (record: T) => string,
  merge: (stored: T, replacement: T) => unknown = mergeStorageFields,
): unknown[] => {
  if (stored.every(guard)) {
    const remaining = [...stored];
    return replacements.map((replacement) => {
      const index = remaining.findIndex(
        (item) => key(item) === key(replacement),
      );
      if (index < 0) return replacement;
      const [original] = remaining.splice(index, 1);
      return guard(original) ? merge(original, replacement) : replacement;
    });
  }
  const remaining = [...replacements];
  const merged: unknown[] = [];
  for (const record of stored) {
    if (!guard(record)) {
      merged.push(record);
      continue;
    }
    const index = remaining.findIndex((item) => key(item) === key(record));
    if (index >= 0) {
      const [replacement] = remaining.splice(index, 1);
      if (guard(replacement)) merged.push(merge(record, replacement));
    }
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
  isKey: (key: string) => boolean = () => true,
): Record<string, unknown> => {
  const stored = getStorageRecord(value);
  if (Object.entries(stored).every(([key, item]) => isKey(key) && guard(item)))
    return replacements;
  const entries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(stored)) {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      entries.push([key, replacements[key]]);
    } else if (!isKey(key) || !guard(item)) {
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

// Identity fields determine readability. Metadata stays unknown until a consumer
// uses it, so an accepted import remains visible when optional data is unusual.
export type StoredRecord<T, K extends keyof T> = Pick<T, K> & {
  [P in Exclude<keyof T, K>]?: unknown;
};
export type StoredBlockchain = StoredRecord<BlockchainDataType, "chainId">;
export type StoredToken = StoredRecord<TokenContractType, "address">;
export type StoredNFTCollection = StoredRecord<NFTCollectionType, "address">;
export type StoredContact = StoredRecord<Contact, "address">;
export type StoredLedgerAccount = StoredRecord<LedgerAccount, "address">;
export type StoredHistoryEntry = StoredRecord<
  TransactionHistoryEntry,
  "transactionHash"
>;
export type StoredConnectedAccounts = StoredRecord<
  ConnectedAccountsDataType,
  "urlOrigin"
>;

// Storage identities are opaque keys, including identifiers from legacy imports.
export const isStorageIdentity = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;

export const hasCanonicalRegistry = (
  chain: StoredBlockchain,
): chain is StoredBlockchain & { qrnsRegistryAddress?: string } =>
  chain.qrnsRegistryAddress === undefined ||
  isCanonicalQrlAddress(chain.qrnsRegistryAddress);

export const isStoredBlockchain = (value: unknown): value is StoredBlockchain =>
  isRecord(value) && isStorageIdentity(value.chainId);

export const isTokenContract = (value: unknown): value is StoredToken =>
  isRecord(value) && isStorageIdentity(value.address);

export const isNFTCollection = (value: unknown): value is StoredNFTCollection =>
  isRecord(value) && isStorageIdentity(value.address);

// Account and contact readers accept every form the canonicalizer can use.
export const isNormalizableQrlAddress = (value: unknown): value is string => {
  if (!isString(value)) return false;
  try {
    toCanonicalQrlAddress(value);
    return true;
  } catch {
    return false;
  }
};

export const isContact = (value: unknown): value is StoredContact =>
  isRecord(value) && isNormalizableQrlAddress(value.address);
export const isNormalizableContact = isContact;

export const isLedgerAccount = (value: unknown): value is StoredLedgerAccount =>
  isRecord(value) && isStorageIdentity(value.address);

const isAmount = (value: unknown): value is string | number =>
  isString(value) || isFiniteNumber(value);

const isTokenDetails = (
  value: unknown,
): value is NonNullable<TransactionValuesType["tokenDetails"]> =>
  isRecord(value) &&
  isBoolean(value.isZrc20Token) &&
  isString(value.tokenContractAddress) &&
  isStoredNumber(value.tokenDecimals) &&
  // watchAsset historically persisted arbitrary optional image metadata.
  // The transfer screen narrows it only when rendering an image.
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
): value is StoredHistoryEntry =>
  isRecord(value) && isStorageIdentity(value.transactionHash);

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
  isRecord(value);

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

export const isConnectedAccounts = (
  value: unknown,
): value is StoredConnectedAccounts =>
  isRecord(value) && isStorageIdentity(value.urlOrigin);

const permissionKey = (value: unknown): string | undefined =>
  isRecord(value) &&
  isString(value.invoker) &&
  (value.parentCapability === "qrl_accounts" ||
    value.parentCapability === "qrl_chains")
    ? `${value.invoker}:${value.parentCapability}`
    : undefined;
const caveatKey = (value: unknown): string | undefined =>
  isRecord(value) &&
  (value.type === "restrictReturnedAccounts" ||
    value.type === "restrictNetworkSwitching")
    ? value.type
    : undefined;

// Permission identities and caveat identities are independent of their optional
// metadata. Preserve opaque entries even when a caller rebuilt the known grants.
const mergeGrantArray = (
  stored: unknown,
  changes: unknown,
  key: (value: unknown) => string | undefined,
  merge: (stored: unknown, changes: unknown) => unknown,
): unknown => {
  if (!Array.isArray(changes)) return changes;
  const replacementList: unknown[] = changes;
  const originals = getStorageArray(stored, "dApp grants");
  if (originals.every((item) => key(item) !== undefined)) {
    const unmatched = [...originals];
    return replacementList.map((replacement) => {
      const identity = key(replacement);
      const index =
        identity === undefined
          ? -1
          : unmatched.findIndex((item) => key(item) === identity);
      if (index < 0) return replacement;
      const [original] = unmatched.splice(index, 1);
      return merge(original, replacement);
    });
  }
  const remaining = [...replacementList];
  const result: unknown[] = [];
  for (const original of originals) {
    const identity = key(original);
    const index = remaining.findIndex((item) =>
      identity === undefined
        ? JSON.stringify(item) === JSON.stringify(original)
        : key(item) === identity,
    );
    if (identity === undefined) {
      result.push(original);
      if (index >= 0) remaining.splice(index, 1);
    } else if (index >= 0) {
      const [replacement] = remaining.splice(index, 1);
      result.push(merge(original, replacement));
    }
  }
  return [...result, ...remaining];
};

export const mergeStoredPermissions = (
  stored: unknown,
  changes: unknown,
): unknown =>
  mergeGrantArray(stored, changes, permissionKey, (original, replacement) => {
    const merged = mergeStorageFields(original, replacement);
    if (!isRecord(merged) || !isRecord(replacement)) return merged;
    merged.caveats = mergeGrantArray(
      getStoredValue(original, "caveats"),
      replacement.caveats,
      caveatKey,
      (oldCaveat, newCaveat) => {
        const caveat = mergeStorageFields(oldCaveat, newCaveat);
        if (!isRecord(caveat) || !isRecord(newCaveat)) return caveat;
        const accountCaveat = caveat.type === "restrictReturnedAccounts";
        caveat.value = mergeGrantArray(
          getStoredValue(oldCaveat, "value"),
          newCaveat.value,
          (value) =>
            accountCaveat
              ? isNormalizableQrlAddress(value)
                ? toCanonicalQrlAddress(value)
                : undefined
              : isStorageIdentity(value)
                ? value.toLowerCase()
                : undefined,
          (_old, value) => value,
        );
        return caveat;
      },
    );
    return merged;
  });

export const matchesStoredAccount = (
  value: unknown,
  target: string,
): boolean => {
  if (!isString(value)) return false;
  if (isNormalizableQrlAddress(value) && isNormalizableQrlAddress(target))
    return toCanonicalQrlAddress(value) === toCanonicalQrlAddress(target);
  return value.toLowerCase() === target.toLowerCase();
};

// Revoke each readable value without parsing its surrounding permission.
export const revokeStoredCaveats = (
  permissions: unknown,
  type: string,
  matches: (value: unknown) => boolean,
): boolean => {
  if (!Array.isArray(permissions)) return false;
  let changed = false;
  for (const permission of permissions) {
    if (!isRecord(permission) || !Array.isArray(permission.caveats)) continue;
    for (const caveat of permission.caveats) {
      if (
        !isRecord(caveat) ||
        caveat.type !== type ||
        !Array.isArray(caveat.value)
      )
        continue;
      const remaining: unknown[] = caveat.value.filter(
        (value: unknown) => !matches(value),
      );
      if (remaining.length === caveat.value.length) continue;
      caveat.value = remaining;
      changed = true;
    }
  }
  return changed;
};

export const matchesStoredChain = (
  value: unknown,
  chainId: string,
): boolean => {
  if (!isStorageIdentity(value)) return false;
  if (value.toLowerCase() === chainId.toLowerCase()) return true;
  try {
    return BigInt(value) === BigInt(chainId);
  } catch {
    return false;
  }
};

export const addStoredChainPermission = (
  stored: unknown,
  urlOrigin: string,
  accounts: unknown,
  chainIds: string[],
  addedChainId: string,
): unknown => {
  if (stored !== undefined && !Array.isArray(stored)) return stored;
  const permissions = getStorageArray(stored, "dApp permissions");
  if (
    !permissions.some(
      (value) => isRecord(value) && value.parentCapability === "qrl_accounts",
    )
  ) {
    const rawAccounts = getStorageArray(accounts, "dApp accounts");
    permissions.push({
      invoker: urlOrigin,
      parentCapability: "qrl_accounts",
      caveats: [
        {
          type: "restrictReturnedAccounts",
          value: rawAccounts
            .filter(isNormalizableQrlAddress)
            .map(toCanonicalQrlAddress),
        },
      ],
    });
  }
  let found = false;
  for (const permission of permissions) {
    if (!isRecord(permission) || !Array.isArray(permission.caveats)) continue;
    for (const caveat of permission.caveats) {
      if (
        !isRecord(caveat) ||
        caveat.type !== "restrictNetworkSwitching" ||
        !Array.isArray(caveat.value)
      )
        continue;
      const values: unknown[] = caveat.value;
      if (!values.some((value) => matchesStoredChain(value, addedChainId)))
        values.push(addedChainId);
      found = true;
    }
  }
  if (!found)
    permissions.push({
      invoker: urlOrigin,
      parentCapability: "qrl_chains",
      caveats: [{ type: "restrictNetworkSwitching", value: chainIds }],
    });
  return permissions;
};

// Preserve unfamiliar permission fields while applying the existing account
// migration to recognizable caveats. Authorization narrows account grants.
export const normalizeStoredPermissions = (value: unknown): unknown => {
  if (value == null) return [];
  if (!Array.isArray(value)) return value;
  return value.map((permission: unknown) => {
    if (!isRecord(permission) || permissionKey(permission) === undefined)
      return permission;
    const caveats = permission.caveats;
    if (caveats != null && !Array.isArray(caveats)) return permission;
    return {
      ...permission,
      caveats: (caveats ?? []).map((caveat: unknown) => {
        if (
          !isRecord(caveat) ||
          caveat.type !== "restrictReturnedAccounts" ||
          !isStringArray(caveat.value)
        )
          return caveat;
        return {
          ...caveat,
          value: caveat.value.flatMap((address) => {
            try {
              return [toCanonicalQrlAddress(address)];
            } catch {
              return [];
            }
          }),
        };
      }),
    };
  });
};

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

// Replacement setters own the documented fields of their target record. This
// keeps valid replacements (including omitted optional fields) compatible while
// carrying unfamiliar keys and unreadable metadata through from raw storage.
type StorageField =
  | ((value: unknown) => boolean)
  | { fields: StorageShape; nullable?: boolean };
type StorageShape = Record<string, StorageField>;
const isKnownStorageField = (value: unknown, field: StorageField): boolean => {
  if (value === undefined) return true;
  if (typeof field === "function") return field(value);
  if (value === null && field.nullable) return true;
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        Object.prototype.hasOwnProperty.call(field.fields, key) &&
        isKnownStorageField(item, field.fields[key]),
    )
  );
};
const replaceStorageShape = (
  stored: unknown,
  changes: unknown,
  shape: StorageShape,
): unknown => {
  if (!isRecord(changes)) return changes;
  const fields = Object.entries(shape)
    .filter(([key, field]) =>
      isKnownStorageField(getStoredValue(stored, key), field),
    )
    .map(([key]) => key);
  const result = replaceStorageFields(stored, changes, fields);
  for (const [key, field] of Object.entries(shape)) {
    if (
      typeof field !== "function" &&
      Object.prototype.hasOwnProperty.call(changes, key)
    )
      result[key] = replaceStorageShape(
        getStoredValue(stored, key),
        changes[key],
        field.fields,
      );
  }
  return result;
};
const nullableStrings = (value: unknown) =>
  value === null || isStringArray(value);
const stringOrNull = (value: unknown) => value === null || isString(value);
// Currency keys emitted by the current price fetcher. Unknown currencies and
// malformed quote metadata survive a refresh that does not supply them.
const priceQuoteShape: StorageShape = {
  usd: isStoredNumber,
  eur: isStoredNumber,
  pln: isStoredNumber,
  gbp: isStoredNumber,
  chf: isStoredNumber,
  jpy: isStoredNumber,
};
const storageShapes = {
  settings: {
    themePreference: (value) =>
      value === "system" || value === "light" || value === "dark",
    autoLockMinutes: isFiniteNumber,
    currency: isString,
    language: isString,
    defaultGasTier: (value) =>
      isString(value) &&
      ["low", "market", "aggressive", "advanced"].includes(value),
    showBalanceAndPrice: isBoolean,
    sidePanelPreferred: isBoolean,
    sidePanelSurface: (value) => value === "panel" || value === "popup",
    sidePanelNoticePending: isBoolean,
    sidePanelNoticeSeen: isBoolean,
    notificationsEnabled: isBoolean,
    phishingDetectionEnabled: isBoolean,
  } satisfies Record<keyof WalletSettings, StorageField>,
  price: {
    prices: { fields: priceQuoteShape },
    change24h: { fields: priceQuoteShape },
    updatedAt: { fields: priceQuoteShape },
    timestamp: isStoredNumber,
  } satisfies Record<keyof PriceCache, StorageField>,

  chain: {
    chainId: isString,
    chainName: isString,
    rpcUrls: isStringArray,
    blockExplorerUrls: nullableStrings,
    iconUrls: nullableStrings,
    nativeCurrency: {
      nullable: true,
      fields: {
        name: stringOrNull,
        symbol: isString,
        decimals: isFiniteNumber,
      },
    },
    defaultRpcUrl: isString,
    defaultBlockExplorerUrl: isString,
    defaultIconUrl: isString,
    defaultWsRpcUrl: isString,
    isTestnet: isBoolean,
    isCustomChain: isBoolean,
    qrnsRegistryAddress: isCanonicalQrlAddress,
  } satisfies Record<keyof BlockchainDataType, StorageField>,
  token: {
    address: isString,
    symbol: isString,
    decimals: isStoredNumber,
    image: isString,
  } satisfies Record<keyof TokenContractType, StorageField>,
  nft: {
    address: isString,
    name: isString,
    symbol: isString,
    standard: isString,
    image: isString,
  } satisfies Record<keyof NFTCollectionType, StorageField>,
  contact: { address: isString, name: isString } satisfies Record<
    keyof Contact,
    StorageField
  >,
  ledger: {
    address: isString,
    derivationPath: isString,
    publicKey: isString,
    index: isFiniteNumber,
  } satisfies Record<keyof LedgerAccount, StorageField>,
  history: {
    id: isString,
    from: isString,
    to: isString,
    amount: isAmount,
    tokenSymbol: isString,
    tokenName: isString,
    isZrc20Token: isBoolean,
    tokenContractAddress: isString,
    tokenDecimals: isStoredNumber,
    transactionHash: isString,
    blockNumber: isString,
    gasUsed: isString,
    effectiveGasPrice: isString,
    status: isBoolean,
    timestamp: isFiniteNumber,
    chainId: isString,
    paidFeesQrl: isString,
    receiptStatusVerified: isBoolean,
    submissionRejected: isBoolean,
    isInternal: isBoolean,
    pendingStatus: (value) =>
      isString(value) &&
      [
        "pending",
        "unknown",
        "confirmed",
        "failed",
        "replaced",
        "cancelled",
        "dropped",
      ].includes(value),
    nonce: isFiniteNumber,
    maxFeePerGas: isString,
    maxPriorityFeePerGas: isString,
    gasLimit: isFiniteNumber,
    data: isString,
    replacementTransactionHash: isString,
    replacedByAction: (value) => value === "speed-up" || value === "cancel",
  } satisfies Record<keyof TransactionHistoryEntry, StorageField>,
  keystore: {
    address: isString,
    id: isString,
    version: isFiniteNumber,
    crypto: {
      fields: {
        cipher: isString,
        ciphertext: isString,
        kdf: isString,
        cipherparams: { fields: { iv: isString } },
        kdfparams: {
          fields: {
            dklen: isFiniteNumber,
            t: isFiniteNumber,
            m: isFiniteNumber,
            p: isFiniteNumber,
            salt: (value) => isString(value) || value instanceof Uint8Array,
          },
        },
      },
    },
  } satisfies Record<keyof KeyStore, StorageField>,
  draft: {
    receiverAddress: isString,
    amount: isAmount,
    tokenDetails: {
      fields: {
        isZrc20Token: isBoolean,
        tokenContractAddress: isString,
        tokenDecimals: isStoredNumber,
        tokenImage: () => true,
        tokenBalance: isString,
        tokenBalanceBaseUnits: isString,
        tokenName: isString,
        tokenSymbol: isString,
      },
    },
  } satisfies Record<keyof TransactionValuesType, StorageField>,
};
export const replaceStoredEntry = (
  kind: keyof typeof storageShapes,
  stored: unknown,
  changes: unknown,
): unknown => replaceStorageShape(stored, changes, storageShapes[kind]);
