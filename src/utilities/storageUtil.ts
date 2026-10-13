import {
  DEFAULT_BLOCKCHAIN,
  LEGACY_TESTNET_RPC,
  QRL_BLOCKCHAINS,
  QRL_TESTNET_RPC_PROXY,
} from "@/configuration/qrlBlockchainConfig";
import type {
  ConnectedAccountsDataType,
  DAppRequestType,
} from "@/scripts/middlewares/middlewareTypes";
import type { GasTier } from "@/types/gasFee";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import {
  isLegacyQrlAddress,
  isQrlAddress,
  toCanonicalQrlAddress,
} from "@/utilities/addressUtil";
import type { KeyStore } from "@theqrl/web3";
import {
  walletLocalStorage,
  walletSessionStorage,
} from "@/utilities/profileStorage";

import {
  ensureStorageRecord,
  filterStorageRecord,
  getStorageArray,
  getStorageRecord,
  getStoredValue,
  hasCanonicalRegistry,
  isArrayOf,
  isBoolean,
  isConnectedAccounts,
  isContact,
  isDAppRequest,
  isFiniteNumber,
  isLedgerAccount,
  isNFTCollection,
  isNormalizableContact,
  isNormalizableQrlAddress,
  isPriceCache,
  isRecord,
  isStoredBlockchain,
  isStoredKeystore,
  isStringArray,
  isString,
  isTokenContract,
  isTransactionHistoryEntry,
  isTransactionValues,
  isWalletSettings,
  mergeStorageArray,
  mergeStorageRecord,
  normalizeStoredPermissions,
  isStorageIdentity,
  matchesStoredAccount,
  replaceStoredEntry,
  mergeStoredPermissions,
  revokeStoredCaveats,
  replaceStoredRequest,
  replaceStoredSettings,
  replaceStoredPriceCache,
  addStoredChainPermission,
  matchesStoredChain,
  type StoredBlockchain,
  type StoredToken,
  type StoredNFTCollection,
  type StoredContact,
  type StoredLedgerAccount,
  type StoredHistoryEntry,
} from "@/utilities/storageGuards";

const readLocalStorage = async (
  key: string,
): Promise<Record<string, unknown>> => {
  const stored: unknown = await walletLocalStorage.get(key);
  return getStorageRecord(stored);
};
const readSessionStorage = async (
  key: string,
): Promise<Record<string, unknown>> => {
  const stored: unknown = await walletSessionStorage.get(key);
  return getStorageRecord(stored);
};

const KEYSTORES_IDENTIFIER = "KEYSTORES";

export class KeystoreStorageCorruptError extends Error {
  constructor() {
    super("The wallet data in this browser could not be read.");
    this.name = "KeystoreStorageCorruptError";
  }
}

const ACCOUNTS_IDENTIFIER = "ACCOUNTS";
const ALL_ACCOUNTS_IDENTIFIER = "ALL_ACCOUNTS";
const ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";

const LEDGER_IDENTIFIER = "LEDGER";
const LEDGER_ACCOUNTS_IDENTIFIER = "LEDGER_ACCOUNTS";

const BLOCKCHAINS_IDENTIFIER = "BLOCKCHAINS";
const ALL_BLOCKCHAINS_IDENTIFIER = "ALL_BLOCKCHAINS";
const ACTIVE_BLOCKCHAIN_IDENTIFIER = "ACTIVE_BLOCKCHAIN";

const DAPPS_IDENTIFIER = "DAPPS";
const ALL_DAPPS_IDENTIFIER = "ALL_DAPPS";
// Mirrors CAVEAT_TYPES.RESTRICT_RETURNED_ACCOUNTS in middlewareTypes, copied
// as a literal because that module has a runtime dependency on
// @theqrl/qrl-wallet-provider, and importing a *value* from it (types are
// erased at build) pulls the provider into every bundle that touches
// storageUtil, including the popup, which has no Buffer polyfill and dies at
// module init with "Buffer is not defined" before React can mount.
const RESTRICT_RETURNED_ACCOUNTS_CAVEAT = "restrictReturnedAccounts";
const DAPPS_REQUEST_DATA_IDENTIFIER = "DAPPS_REQUEST_DATA";

const TOKENS_IDENTIFIER = "TOKENS";
const ALL_TOKENS_IDENTIFIER = "ALL_TOKENS";

const ACTIVE_PAGE_IDENTIFIER = "ACTIVE_PAGE";

const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";

const TX_HISTORY_IDENTIFIER = "TX_HISTORY";
const ALL_TX_HISTORY_IDENTIFIER = "ALL_TX_HISTORY";

const CONTACTS_IDENTIFIER = "CONTACTS";
const ALL_CONTACTS_IDENTIFIER = "ALL_CONTACTS";

const ACCOUNT_LABELS_IDENTIFIER = "ACCOUNT_LABELS";
const HIDDEN_ACCOUNTS_IDENTIFIER = "HIDDEN_ACCOUNTS";

const sanitizeQrnsRegistry = (
  chain: StoredBlockchain,
  rejectInvalid: boolean,
): StoredBlockchain => {
  if (hasCanonicalRegistry(chain)) return chain;
  const { qrnsRegistryAddress: registryAddress, ...withoutRegistry } = chain;
  if (
    registryAddress === undefined ||
    registryAddress === null ||
    registryAddress === ""
  ) {
    return rejectInvalid
      ? { ...withoutRegistry, qrnsRegistryAddress: undefined }
      : withoutRegistry;
  }
  if (rejectInvalid) {
    throw new Error(
      "QRNS registry must be a canonical uppercase-Q address with 128 hexadecimal characters and a valid checksum",
    );
  }
  return withoutRegistry;
};

const NFT_COLLECTIONS_IDENTIFIER = "NFT_COLLECTIONS";
const ALL_NFT_COLLECTIONS_IDENTIFIER = "ALL_NFT_COLLECTIONS";

const SETTINGS_IDENTIFIER = "SETTINGS";
// Exported so the lock-state storage listener can ignore automated price
// refreshes (they must not count as user activity for auto-lock).
export const PRICE_CACHE_IDENTIFIER = "PRICE_CACHE";

export type WalletSettings = {
  themePreference?: "system" | "light" | "dark";
  autoLockMinutes?: number;
  currency?: string;
  language?: string;
  defaultGasTier?: GasTier;
  showBalanceAndPrice?: boolean;
  // Legacy boolean. Older builds re-persisted it on every settings write, so
  // a stored `false` is not evidence of a user choice. Kept in sync by
  // settingsStore so a downgrade still reads a sane value; the surface
  // decision itself uses sidePanelSurface (see scripts/utils/sidePanelSurface.ts).
  sidePanelPreferred?: boolean;
  // The explicit surface choice, written only when the user picks one from
  // the header menu or the migration notice. Unset means the default, which
  // is the side panel wherever the API exists.
  sidePanelSurface?: "panel" | "popup";
  // Armed by runtime.onInstalled on an update so existing installs see the
  // one-time "we moved to the side panel" notice exactly once.
  sidePanelNoticePending?: boolean;
  sidePanelNoticeSeen?: boolean;
  notificationsEnabled?: boolean;
  phishingDetectionEnabled?: boolean;
};

export type PriceCache = {
  prices?: unknown;
  change24h?: unknown;
  updatedAt?: unknown;
  timestamp?: unknown;
};

export type TransactionValuesType = {
  receiverAddress?: string;
  amount?: string | number;
  tokenDetails?: {
    isZrc20Token: boolean;
    tokenContractAddress: string;
    tokenDecimals: number | null;
    tokenImage: unknown;
    tokenBalance: string;
    tokenBalanceBaseUnits?: string;
    tokenName: string;
    tokenSymbol: string;
  };
};

export const LockState = Object.freeze({
  LOCKED: "LOCKED",
  UNLOCKED: "UNLOCKED",
});

export type LockStateType = (typeof LockState)[keyof typeof LockState];

/**
 * A utility for storing and retrieving states of different components to and from the browser storage.
 */
const StorageUtil = {
  // Cap retained tx-history entries per account+chain so unbounded
  // growth under `unlimitedStorage` cannot wedge the popup ↔ SW port
  // (Chromium's 64 MB silent-drop limit).
  TX_HISTORY_MAX_PER_ACCOUNT_CHAIN: 1000,
  /**
   * A function for storing the keystore data.
   * Call the getKeystore function to retrieve the stored value, and clearKeystore for clearing the stored value.
   */
  async setKeystores(keystores: KeyStore[]) {
    if (
      keystores.some(
        (keystore) =>
          !isQrlAddress(keystore.address) &&
          !isLegacyQrlAddress(keystore.address),
      )
    ) {
      throw new Error("Cannot persist a keystore with an invalid QRL address");
    }
    const storageData = await readLocalStorage(KEYSTORES_IDENTIFIER);
    const stored = storageData[KEYSTORES_IDENTIFIER];
    let raw: unknown = stored;
    if (typeof stored === "string" && stored !== "") {
      try {
        raw = JSON.parse(stored);
      } catch {
        throw new KeystoreStorageCorruptError();
      }
    }
    await walletLocalStorage.set({
      [KEYSTORES_IDENTIFIER]: JSON.stringify(
        mergeStorageArray(
          getStorageArray(raw === "" ? undefined : raw, KEYSTORES_IDENTIFIER),
          keystores,
          isStoredKeystore,
          (keystore) => keystore.address.toLowerCase(),
          (raw, replacement) =>
            replaceStoredEntry("keystore", raw, replacement),
        ),
      ),
    });
  },

  async getKeystores(): Promise<KeyStore[]> {
    const storageData = await readLocalStorage(KEYSTORES_IDENTIFIER);
    const stored: unknown = storageData[KEYSTORES_IDENTIFIER];
    if (stored === undefined || stored === "") return [];
    if (typeof stored !== "string") throw new KeystoreStorageCorruptError();

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new KeystoreStorageCorruptError();
    }
    if (!isArrayOf(parsed, isStoredKeystore)) {
      throw new KeystoreStorageCorruptError();
    }
    return parsed;
  },

  async clearKeystores() {
    await walletLocalStorage.remove(KEYSTORES_IDENTIFIER);
  },

  async updateLockStateTimeStamp(lockState: LockStateType) {
    const lockStatusIdentifier = `LOCK_MANAGER_${lockState}_TIMESTAMP`;
    await walletLocalStorage.set({
      [lockStatusIdentifier]: Date.now(),
    });
  },

  async getLockStateTimeStamp(lockState: LockStateType): Promise<number> {
    const key = `LOCK_MANAGER_${lockState}_TIMESTAMP`;
    const data = await readLocalStorage(key);
    const timestamp = data[key];
    return isFiniteNumber(timestamp) ? timestamp : 0;
  },

  /**
   * A function for storing the transaction state values, so that the user need not fill in the field values if the extension is closed and opened again.
   * Call the getTransactionValues fuction to retieve the stored value.
   */
  async setTransactionValues(transactionValues: TransactionValuesType) {
    const { chainId } = await this.getActiveBlockChain();
    const transactionValuesIdentifier = `${chainId}_${TRANSACTION_VALUES_IDENTIFIER}`;
    const transactionValuesWithDefaultValues = {
      receiverAddress: transactionValues.receiverAddress ?? "",
      amount: transactionValues.amount ?? 0,
      tokenDetails: transactionValues.tokenDetails,
    };
    const storageData = await readLocalStorage(transactionValuesIdentifier);
    await walletLocalStorage.set({
      [transactionValuesIdentifier]: replaceStoredEntry(
        "draft",
        storageData[transactionValuesIdentifier],
        transactionValuesWithDefaultValues,
      ),
    });
  },

  async getTransactionValues() {
    const { chainId } = await this.getActiveBlockChain();
    const transactionValuesIdentifier = `${chainId}_${TRANSACTION_VALUES_IDENTIFIER}`;
    let transactionValues: TransactionValuesType = {
      receiverAddress: "",
      amount: 0,
    };

    const storedTransactionValues = await readLocalStorage(
      transactionValuesIdentifier,
    );
    const stored = storedTransactionValues[transactionValuesIdentifier];
    if (isTransactionValues(stored)) {
      transactionValues = {
        ...transactionValues,
        ...stored,
      };
    }

    return transactionValues;
  },

  async clearTransactionValues() {
    const { chainId } = await this.getActiveBlockChain();
    const transactionValuesIdentifier = `${chainId}_${TRANSACTION_VALUES_IDENTIFIER}`;
    await walletLocalStorage.remove(transactionValuesIdentifier);
  },

  /**
   * A function for storing the accounts created and imported within the qrl web3 wallet extension.
   * Call the getAllAccounts function to retrieve the stored value.
   */
  async setAllAccounts(accountList: string[]) {
    const canonicalAccounts = accountList.map(toCanonicalQrlAddress);
    const existing = (await readLocalStorage(ACCOUNTS_IDENTIFIER))[
      ACCOUNTS_IDENTIFIER
    ];
    await walletLocalStorage.set({
      [ACCOUNTS_IDENTIFIER]: {
        ...getStorageRecord(existing),
        [ALL_ACCOUNTS_IDENTIFIER]: mergeStorageArray(
          getStorageArray(
            getStoredValue(existing, ALL_ACCOUNTS_IDENTIFIER),
            ALL_ACCOUNTS_IDENTIFIER,
          ),
          canonicalAccounts,
          isNormalizableQrlAddress,
          toCanonicalQrlAddress,
        ),
      },
    });
  },

  async getStoredAccounts() {
    const storedAllAccounts = (await readLocalStorage(ACCOUNTS_IDENTIFIER))[
      ACCOUNTS_IDENTIFIER
    ];
    const accounts = getStoredValue(storedAllAccounts, ALL_ACCOUNTS_IDENTIFIER);
    return getStorageArray(accounts, ALL_ACCOUNTS_IDENTIFIER).filter(isString);
  },

  /**
   * Return only QIP-55 accounts to live wallet and provider flows. Legacy
   * entries stay byte-for-byte in storage for an explicit seed-aware
   * migration.
   */
  async getAllAccounts() {
    const storedAccounts = await this.getStoredAccounts();
    return storedAccounts.flatMap((address) => {
      try {
        return [toCanonicalQrlAddress(address)];
      } catch {
        return [];
      }
    });
  },

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value, and clearActiveAccount for clearing the stored value.
   */
  async setActiveAccount(activeAccount?: string) {
    if (activeAccount) {
      const canonicalAddress = toCanonicalQrlAddress(activeAccount);
      const existing = (await readLocalStorage(ACCOUNTS_IDENTIFIER))[
        ACCOUNTS_IDENTIFIER
      ];
      await walletLocalStorage.set({
        [ACCOUNTS_IDENTIFIER]: {
          ...getStorageRecord(existing),
          [ACTIVE_ACCOUNT_IDENTIFIER]: canonicalAddress,
        },
      });
    } else {
      await this.clearActiveAccount();
    }
  },

  async getActiveAccount() {
    const storedAccounts = (await readLocalStorage(ACCOUNTS_IDENTIFIER))[
      ACCOUNTS_IDENTIFIER
    ];
    const storedAddress = getStoredValue(
      storedAccounts,
      ACTIVE_ACCOUNT_IDENTIFIER,
    );
    try {
      return toCanonicalQrlAddress(storedAddress);
    } catch {
      return "";
    }
  },

  async clearActiveAccount() {
    const storedAccounts =
      (await readLocalStorage(ACCOUNTS_IDENTIFIER))[ACCOUNTS_IDENTIFIER] ?? {};
    const accounts = getStorageRecord(storedAccounts);
    Reflect.deleteProperty(accounts, ACTIVE_ACCOUNT_IDENTIFIER);
    await walletLocalStorage.set({
      [ACCOUNTS_IDENTIFIER]: accounts,
    });
  },

  /**
   * A function for storing all the available blockchains.
   * Call the getAllBlockChains function to retrieve all the stored blockchains.
   */
  async setAllBlockChains(blockchains: StoredBlockchain[]) {
    if (!isArrayOf(blockchains, isStoredBlockchain))
      throw new Error("Invalid stored chain identity");
    const canonicalBlockchains = blockchains.map((chain) =>
      sanitizeQrnsRegistry(chain, true),
    );
    const existing = (await readLocalStorage(BLOCKCHAINS_IDENTIFIER))[
      BLOCKCHAINS_IDENTIFIER
    ];
    await walletLocalStorage.set({
      [BLOCKCHAINS_IDENTIFIER]: {
        ...getStorageRecord(existing),
        [ALL_BLOCKCHAINS_IDENTIFIER]: mergeStorageArray(
          getStorageArray(
            getStoredValue(existing, ALL_BLOCKCHAINS_IDENTIFIER),
            ALL_BLOCKCHAINS_IDENTIFIER,
          ),
          canonicalBlockchains,
          isStoredBlockchain,
          (chain) => chain.chainId,
          (raw, replacement) => replaceStoredEntry("chain", raw, replacement),
        ),
      },
    });
  },

  async getAllBlockChains() {
    const storedBlockchains = (await readLocalStorage(BLOCKCHAINS_IDENTIFIER))[
      BLOCKCHAINS_IDENTIFIER
    ];
    const storedChains = getStoredValue(
      storedBlockchains,
      ALL_BLOCKCHAINS_IDENTIFIER,
    );
    const chains = getStorageArray(
      storedChains,
      ALL_BLOCKCHAINS_IDENTIFIER,
      QRL_BLOCKCHAINS,
    ).filter(isStoredBlockchain);
    // Read-time migrations. Stored lists persisted before 0.4.10 still carry
    // the cleartext builtin-testnet RPC: rewrite only that exact default on
    // non-custom chains; custom chains and user-edited URLs are untouched.
    // Stored lists persisted before the Quanta display-unit rename still
    // carry the old "QRL" currency symbol on the builtin chains: the
    // currency fields are not editable for non-custom chains, so rewriting
    // the old default cannot clobber a user value. Custom chains keep
    // whatever symbol the user or dApp provided.
    return chains.map((chain) => {
      let migrated = sanitizeQrnsRegistry(chain, false);
      if (
        !migrated.isCustomChain &&
        Array.isArray(migrated.rpcUrls) &&
        migrated.rpcUrls[0] === LEGACY_TESTNET_RPC
      ) {
        migrated = {
          ...migrated,
          rpcUrls: [QRL_TESTNET_RPC_PROXY],
          defaultRpcUrl: QRL_TESTNET_RPC_PROXY,
        };
      }
      if (
        !migrated.isCustomChain &&
        isRecord(migrated.nativeCurrency) &&
        migrated.nativeCurrency.symbol === "QRL"
      ) {
        migrated = {
          ...migrated,
          nativeCurrency: {
            ...migrated.nativeCurrency,
            name: "Quanta",
            symbol: "Quanta",
          },
        };
      }
      return migrated;
    });
  },

  /**
   * A function for storing the blockchain selection.
   * Call the getActiveBlockChain function to retrieve the stored value.
   */
  async setActiveBlockChain(selectedBlockchainId: string) {
    const existing = (await readLocalStorage(BLOCKCHAINS_IDENTIFIER))[
      BLOCKCHAINS_IDENTIFIER
    ];
    await walletLocalStorage.set({
      [BLOCKCHAINS_IDENTIFIER]: {
        ...getStorageRecord(existing),
        [ACTIVE_BLOCKCHAIN_IDENTIFIER]: selectedBlockchainId,
      },
    });
  },

  async getActiveBlockChain() {
    const storedBlockchains = (await readLocalStorage(BLOCKCHAINS_IDENTIFIER))[
      BLOCKCHAINS_IDENTIFIER
    ];
    const blockchains = await this.getAllBlockChains();
    const storedActiveChainId: unknown = getStoredValue(
      storedBlockchains,
      ACTIVE_BLOCKCHAIN_IDENTIFIER,
    );
    const activeChainId = (
      typeof storedActiveChainId === "string"
        ? storedActiveChainId
        : DEFAULT_BLOCKCHAIN.chainId
    ).toLowerCase();
    const findChain = (chainId: string) =>
      blockchains.find((chain) => chain.chainId.toLowerCase() === chainId);
    // Resolve the default chain against the stored list too, so edits to it
    // apply before the user has ever switched chain.
    return (
      findChain(activeChainId) ??
      findChain(DEFAULT_BLOCKCHAIN.chainId.toLowerCase()) ??
      DEFAULT_BLOCKCHAIN
    );
  },

  /**
   * A function for storing the route to be displayed on opening the extension.
   * Call the getActivePage function to retrieve the stored value, and clearActivePage for clearing the stored value.
   */
  async setActivePage(activePage: string) {
    if (activePage) {
      await walletLocalStorage.set({ [ACTIVE_PAGE_IDENTIFIER]: activePage });
    } else {
      await walletLocalStorage.remove(ACTIVE_PAGE_IDENTIFIER);
    }
  },

  async getActivePage() {
    const storedActivePage = await readLocalStorage(ACTIVE_PAGE_IDENTIFIER);
    const page = storedActivePage[ACTIVE_PAGE_IDENTIFIER];
    return typeof page === "string" ? page : "";
  },

  async clearActivePage() {
    await walletLocalStorage.remove(ACTIVE_PAGE_IDENTIFIER);
  },

  /**
   * A function for storing the list of imported tokens.
   * Call the getTokenContractsList function to retrieve the stored value, and clearFromTokenList for clearing the stored value.
   */
  async setTokenContractsList(
    accountAddress: string,
    tokenContract: StoredToken,
  ) {
    if (!isStorageIdentity(accountAddress) || !isTokenContract(tokenContract))
      throw new Error("Invalid stored token identity");
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TOKENS_IDENTIFIER);
    const chainData = ensureStorageRecord(
      storageData,
      TOKENS_IDENTIFIER,
      ALL_TOKENS_IDENTIFIER,
      accountAddress,
      chainId,
    );
    const storedTokenContracts = getStorageArray(
      chainData.tokens,
      ALL_TOKENS_IDENTIFIER,
    );
    chainData.tokens = [
      ...storedTokenContracts.filter(
        (token) =>
          !isTokenContract(token) || token.address !== tokenContract.address,
      ),
      replaceStoredEntry(
        "token",
        storedTokenContracts.find(
          (token) =>
            isTokenContract(token) && token.address === tokenContract.address,
        ),
        tokenContract,
      ),
    ];

    await walletLocalStorage.set(storageData);
  },

  async getTokenContractsList(accountAddress: string) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TOKENS_IDENTIFIER);
    const storedTokenContracts = getStoredValue(
      storageData,
      TOKENS_IDENTIFIER,
      ALL_TOKENS_IDENTIFIER,
      accountAddress,
      chainId,
      "tokens",
    );
    return getStorageArray(storedTokenContracts, ALL_TOKENS_IDENTIFIER).filter(
      isTokenContract,
    );
  },

  async clearFromTokenContractsList(
    accountAddress: string,
    contractAddress: string,
  ) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TOKENS_IDENTIFIER);
    const chainData = ensureStorageRecord(
      storageData,
      TOKENS_IDENTIFIER,
      ALL_TOKENS_IDENTIFIER,
      accountAddress,
      chainId,
    );
    chainData.tokens = getStorageArray(
      chainData.tokens,
      ALL_TOKENS_IDENTIFIER,
    ).filter(
      (token) => !isTokenContract(token) || token.address !== contractAddress,
    );

    await walletLocalStorage.set({ ...storageData });
  },

  async setNFTCollectionsList(
    accountAddress: string,
    collection: StoredNFTCollection,
  ) {
    if (!isNFTCollection(collection))
      throw new Error("Invalid stored NFT identity");
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(NFT_COLLECTIONS_IDENTIFIER);
    const chainData = ensureStorageRecord(
      storageData,
      NFT_COLLECTIONS_IDENTIFIER,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
      accountAddress,
      chainId,
    );
    const storedCollections = getStorageArray(
      chainData.collections,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
    );
    chainData.collections = [
      ...storedCollections.filter(
        (c) => !isNFTCollection(c) || c.address !== collection.address,
      ),
      replaceStoredEntry(
        "nft",
        storedCollections.find(
          (item) =>
            isNFTCollection(item) && item.address === collection.address,
        ),
        collection,
      ),
    ];

    await walletLocalStorage.set(storageData);
  },

  async getNFTCollectionsList(accountAddress: string) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(NFT_COLLECTIONS_IDENTIFIER);
    const storedCollections = getStoredValue(
      storageData,
      NFT_COLLECTIONS_IDENTIFIER,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
      accountAddress,
      chainId,
      "collections",
    );
    return getStorageArray(
      storedCollections,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
    ).filter(isNFTCollection);
  },

  async clearFromNFTCollectionsList(
    accountAddress: string,
    contractAddress: string,
  ) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(NFT_COLLECTIONS_IDENTIFIER);
    const chainData = ensureStorageRecord(
      storageData,
      NFT_COLLECTIONS_IDENTIFIER,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
      accountAddress,
      chainId,
    );
    chainData.collections = getStorageArray(
      chainData.collections,
      ALL_NFT_COLLECTIONS_IDENTIFIER,
    ).filter((c) => !isNFTCollection(c) || c.address !== contractAddress);

    await walletLocalStorage.set({ ...storageData });
  },

  /**
   * A function for storing the request info temporarily by the dApp, which will be read by the qrl web3 wallet.
   * Call the getDAppsRequestData function to retrieve the stored value, and clearDAppsRequestData for clearing the stored value.
   */
  async setDAppsRequestData(dAppsRequestData: DAppRequestType) {
    const storageData = await readSessionStorage(DAPPS_IDENTIFIER);
    const dApps = ensureStorageRecord(storageData, DAPPS_IDENTIFIER);
    dApps[DAPPS_REQUEST_DATA_IDENTIFIER] = replaceStoredRequest(
      dApps[DAPPS_REQUEST_DATA_IDENTIFIER],
      dAppsRequestData,
    );
    await walletSessionStorage.set(storageData);
  },

  async getDAppsRequestData() {
    const storedDAppsRequestData = (await readSessionStorage(DAPPS_IDENTIFIER))[
      DAPPS_IDENTIFIER
    ];
    const request = getStoredValue(
      storedDAppsRequestData,
      DAPPS_REQUEST_DATA_IDENTIFIER,
    );
    return isDAppRequest(request) ? request : undefined;
  },

  /**
   * Clear the pending dApp request only while the slot still holds the
   * given request. Anything that resolves an approval asynchronously (the
   * approval surface after its callback, the middleware's timeouts) can
   * finish after a newer request has taken the slot, and an unconditional
   * clear there wipes the request the user is currently looking at.
   *
   * An undefined requestId falls back to the unconditional clear so callers
   * from before requestIds existed keep working.
   */
  async clearDAppsRequestDataForRequestId(requestId?: string) {
    if (requestId === undefined) {
      await this.clearDAppsRequestData();
      return;
    }
    const storageData = await readSessionStorage(DAPPS_IDENTIFIER);
    const dApps = getStorageRecord(storageData, DAPPS_IDENTIFIER);
    if (
      getStoredValue(dApps, DAPPS_REQUEST_DATA_IDENTIFIER, "requestId") !==
      requestId
    )
      return;
    Reflect.deleteProperty(dApps, DAPPS_REQUEST_DATA_IDENTIFIER);
    await walletSessionStorage.set(storageData);
  },

  async clearDAppsRequestData() {
    const storedDAppsRequestData =
      (await readSessionStorage(DAPPS_IDENTIFIER))[DAPPS_IDENTIFIER] ?? {};
    const dApps = getStorageRecord(storedDAppsRequestData);
    Reflect.deleteProperty(dApps, DAPPS_REQUEST_DATA_IDENTIFIER);
    await walletSessionStorage.set({
      [DAPPS_IDENTIFIER]: dApps,
    });
  },

  /**
   * A function for storing the connected accounts info temporarily, which will be read by method like 'qrl_accounts'.
   * Call the getDAppsConnectedAccountsData function to retrieve the stored value, and clearDAppsConnectedAccountsData for clearing the stored value.
   */
  async setDAppsConnectedAccountsData(
    data: Omit<ConnectedAccountsDataType, "blockchains"> & {
      blockchains: StoredBlockchain[];
    },
  ) {
    if (!isConnectedAccounts(data))
      throw new Error("Invalid stored dApp identity");
    const urlOrigin = data.urlOrigin;
    const accounts = data.accounts.map(toCanonicalQrlAddress);
    const blockchains = data.blockchains.map((chain) =>
      sanitizeQrnsRegistry(chain, true),
    );
    const rawPermissions: unknown = data.permissions;
    if (rawPermissions != null && !Array.isArray(rawPermissions))
      throw new Error("Invalid stored dApp permissions");
    const permissions = normalizeStoredPermissions(rawPermissions);

    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const dApp = ensureStorageRecord(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
      urlOrigin,
    );
    Object.assign(dApp, {
      urlOrigin,
      accounts: mergeStorageArray(
        getStorageArray(dApp.accounts, "dApp accounts"),
        accounts,
        isNormalizableQrlAddress,
        toCanonicalQrlAddress,
      ),
      blockchains: mergeStorageArray(
        getStorageArray(dApp.blockchains, "dApp blockchains"),
        blockchains,
        isStoredBlockchain,
        (chain) => chain.chainId.toLowerCase(),
        (raw, replacement) => replaceStoredEntry("chain", raw, replacement),
      ),
      permissions: mergeStoredPermissions(dApp.permissions, permissions),
    });

    await walletLocalStorage.set(storageData);
  },

  async getDAppsConnectedAccountsData(urlOrigin: string = "") {
    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const storedData = getStoredValue(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
      urlOrigin,
    );
    if (!isConnectedAccounts(storedData)) return undefined;

    if (!isStringArray(storedData.accounts)) return undefined;
    const accounts = storedData.accounts.flatMap((address) => {
      try {
        return [toCanonicalQrlAddress(address)];
      } catch {
        return [];
      }
    });
    if (accounts.length === 0) return undefined;

    const permissions = normalizeStoredPermissions(storedData.permissions);
    const blockchains = (
      Array.isArray(storedData.blockchains) ? storedData.blockchains : []
    )
      .filter(isStoredBlockchain)
      .map((chain) => sanitizeQrnsRegistry(chain, false));
    return { ...storedData, accounts, blockchains, permissions };
  },

  async addDAppChain(urlOrigin: string, chain: StoredBlockchain) {
    if (!isStorageIdentity(urlOrigin) || !isStoredBlockchain(chain))
      throw new Error("Invalid stored dApp chain identity");
    const blockchain = sanitizeQrnsRegistry(chain, true);
    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const dApp = ensureStorageRecord(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
      urlOrigin,
    );
    if (!Object.prototype.hasOwnProperty.call(dApp, "urlOrigin"))
      dApp.urlOrigin = urlOrigin;
    if (!Object.prototype.hasOwnProperty.call(dApp, "accounts"))
      dApp.accounts = [];
    const chains = getStorageArray(dApp.blockchains, "dApp blockchains");
    if (
      !chains.some((value) =>
        matchesStoredChain(
          getStoredValue(value, "chainId"),
          blockchain.chainId,
        ),
      )
    )
      chains.push(blockchain);
    dApp.blockchains = chains;
    dApp.permissions = addStoredChainPermission(
      dApp.permissions,
      urlOrigin,
      dApp.accounts,
      chains.filter(isStoredBlockchain).map((value) => value.chainId),
      blockchain.chainId,
    );
    await walletLocalStorage.set(storageData);
  },

  async removeDAppChain(urlOrigin: string, chainId: string) {
    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const allDApps = getStorageRecord(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
    );
    let changed = false;
    for (const [origin, data] of Object.entries(allDApps)) {
      if (
        !isRecord(data) ||
        (origin !== urlOrigin && data.urlOrigin !== urlOrigin)
      )
        continue;
      if (Array.isArray(data.blockchains)) {
        const remaining: unknown[] = data.blockchains.filter(
          (value: unknown) =>
            !matchesStoredChain(getStoredValue(value, "chainId"), chainId),
        );
        if (remaining.length !== data.blockchains.length) {
          data.blockchains = remaining;
          changed = true;
        }
      }
      if (
        revokeStoredCaveats(
          data.permissions,
          "restrictNetworkSwitching",
          (value) => matchesStoredChain(value, chainId),
        )
      )
        changed = true;
    }
    if (changed) await walletLocalStorage.set(storageData);
  },

  async clearDAppsConnectedAccountsData(urlOrigin: string = "") {
    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const allDApps = getStorageRecord(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
    );
    for (const [origin, data] of Object.entries(allDApps)) {
      if (
        origin === urlOrigin ||
        getStoredValue(data, "urlOrigin") === urlOrigin
      )
        Reflect.deleteProperty(allDApps, origin);
    }
    await walletLocalStorage.set(storageData);
  },

  /**
   * Erase everything stored per-account for a removed address: transaction
   * history, imported token contracts, and NFT collections, on *every*
   * chain.
   *
   * All three maps key by account address at the same level, with chain IDs
   * nested underneath, so dropping the address key clears every chain at
   * once. Leaving these behind would keep a full record of the account and
   * its activity after the user removed it.
   */
  async clearAllAccountData(accountAddress: string) {
    const maps: Array<[string, string]> = [
      [TX_HISTORY_IDENTIFIER, ALL_TX_HISTORY_IDENTIFIER],
      [TOKENS_IDENTIFIER, ALL_TOKENS_IDENTIFIER],
      [NFT_COLLECTIONS_IDENTIFIER, ALL_NFT_COLLECTIONS_IDENTIFIER],
    ];
    for (const [identifier, allIdentifier] of maps) {
      const storageData = await readLocalStorage(identifier);
      const byAccount = getStorageRecord(
        storageData,
        identifier,
        allIdentifier,
      );
      const matches = Object.keys(byAccount).filter((address) =>
        matchesStoredAccount(address, accountAddress),
      );
      if (matches.length === 0) continue;
      for (const match of matches) Reflect.deleteProperty(byAccount, match);
      await walletLocalStorage.set(storageData);
    }
  },

  /**
   * Revoke a removed account across every connected dApp: drop it from each
   * origin's account list and from the returned-accounts caveat that gates
   * authorization, and disconnect origins left with no accounts.
   *
   * Without this, qrl_accounts keeps advertising an address the wallet can
   * no longer sign for, and a transaction request naming it still passes
   * the authorization check and opens a full approval screen.
   */
  async removeAccountFromAllDApps(accountAddress: string) {
    const storageData = await readLocalStorage(DAPPS_IDENTIFIER);
    const allDApps = getStorageRecord(
      storageData,
      DAPPS_IDENTIFIER,
      ALL_DAPPS_IDENTIFIER,
    );
    const matches = (value: unknown) =>
      matchesStoredAccount(value, accountAddress);
    let changed = false;
    for (const [origin, data] of Object.entries(allDApps)) {
      if (!isRecord(data)) continue;
      if (Array.isArray(data.accounts)) {
        const remaining: unknown[] = data.accounts.filter(
          (value: unknown) => !matches(value),
        );
        if (remaining.length !== data.accounts.length) {
          changed = true;
          if (remaining.length === 0) {
            Reflect.deleteProperty(allDApps, origin);
            continue;
          }
          data.accounts = remaining;
        }
      }
      if (
        revokeStoredCaveats(
          data.permissions,
          RESTRICT_RETURNED_ACCOUNTS_CAVEAT,
          matches,
        )
      )
        changed = true;
    }
    if (changed) await walletLocalStorage.set(storageData);
  },

  async setContacts(contacts: StoredContact[]) {
    const canonicalContacts = contacts.map((contact) => ({
      ...contact,
      address: toCanonicalQrlAddress(contact.address),
    }));
    const storageData = await readLocalStorage(CONTACTS_IDENTIFIER);
    const stored = getStoredValue(
      storageData,
      CONTACTS_IDENTIFIER,
      ALL_CONTACTS_IDENTIFIER,
    );
    await walletLocalStorage.set({
      [CONTACTS_IDENTIFIER]: {
        ...getStorageRecord(storageData, CONTACTS_IDENTIFIER),
        [ALL_CONTACTS_IDENTIFIER]: mergeStorageArray(
          getStorageArray(stored, ALL_CONTACTS_IDENTIFIER),
          canonicalContacts,
          isNormalizableContact,
          (contact) => toCanonicalQrlAddress(contact.address),
          (raw, replacement) => replaceStoredEntry("contact", raw, replacement),
        ),
      },
    });
  },

  async getContacts(): Promise<StoredContact[]> {
    const storageData = await readLocalStorage(CONTACTS_IDENTIFIER);
    const storedContacts = getStoredValue(
      storageData,
      CONTACTS_IDENTIFIER,
      ALL_CONTACTS_IDENTIFIER,
    );
    const contacts = getStorageArray(
      storedContacts,
      ALL_CONTACTS_IDENTIFIER,
    ).filter(isContact);
    return contacts.flatMap((contact) => {
      try {
        return [
          {
            ...contact,
            address: toCanonicalQrlAddress(contact.address),
          },
        ];
      } catch {
        return [];
      }
    });
  },

  async clearContacts() {
    await walletLocalStorage.remove(CONTACTS_IDENTIFIER);
  },

  /**
   * Account labels - a map from account address to a user-defined label.
   */
  async setAccountLabels(labels: Record<string, string>) {
    const storageData = await readLocalStorage(ACCOUNT_LABELS_IDENTIFIER);
    await walletLocalStorage.set({
      [ACCOUNT_LABELS_IDENTIFIER]: mergeStorageRecord(
        storageData[ACCOUNT_LABELS_IDENTIFIER],
        labels,
        isString,
        (address) =>
          isNormalizableQrlAddress(address) || isLegacyQrlAddress(address),
      ),
    });
  },

  async getAccountLabels(): Promise<Record<string, string>> {
    const storageData = await readLocalStorage(ACCOUNT_LABELS_IDENTIFIER);
    const labels = storageData[ACCOUNT_LABELS_IDENTIFIER];
    return filterStorageRecord(labels, isString);
  },

  async setAccountLabel(address: string, label: string) {
    const storageData = await readLocalStorage(ACCOUNT_LABELS_IDENTIFIER);
    const labels = getStorageRecord(storageData, ACCOUNT_LABELS_IDENTIFIER);
    await walletLocalStorage.set({
      [ACCOUNT_LABELS_IDENTIFIER]: { ...labels, [address]: label },
    });
  },

  async clearAccountLabels() {
    await walletLocalStorage.remove(ACCOUNT_LABELS_IDENTIFIER);
  },

  async setHiddenAccounts(hidden: Record<string, boolean>) {
    const storageData = await readLocalStorage(HIDDEN_ACCOUNTS_IDENTIFIER);
    await walletLocalStorage.set({
      [HIDDEN_ACCOUNTS_IDENTIFIER]: mergeStorageRecord(
        storageData[HIDDEN_ACCOUNTS_IDENTIFIER],
        hidden,
        isBoolean,
        (address) =>
          isNormalizableQrlAddress(address) || isLegacyQrlAddress(address),
      ),
    });
  },

  async getHiddenAccounts(): Promise<Record<string, boolean>> {
    const storageData = await readLocalStorage(HIDDEN_ACCOUNTS_IDENTIFIER);
    const hidden = storageData[HIDDEN_ACCOUNTS_IDENTIFIER];
    return filterStorageRecord(hidden, isBoolean);
  },

  async clearHiddenAccounts() {
    await walletLocalStorage.remove(HIDDEN_ACCOUNTS_IDENTIFIER);
  },

  async setSettings(settings: WalletSettings) {
    const storageData = await readLocalStorage(SETTINGS_IDENTIFIER);
    await walletLocalStorage.set({
      [SETTINGS_IDENTIFIER]: replaceStoredSettings(
        storageData[SETTINGS_IDENTIFIER],
        settings,
      ),
    });
  },

  async getSettings(): Promise<WalletSettings> {
    const storageData = await readLocalStorage(SETTINGS_IDENTIFIER);
    const settings = storageData[SETTINGS_IDENTIFIER];
    return isWalletSettings(settings) ? settings : {};
  },

  async clearAllData() {
    await walletLocalStorage.clear();
  },

  /**
   * Stores Ledger accounts.
   *
   * WHY SEPARATE STORAGE:
   * Ledger accounts are stored separately from regular accounts because:
   * 1. They don't have private keys stored locally
   * 2. They need additional metadata (derivation path, device info)
   * 3. Signing requires different flow (device interaction)
   *
   * STRUCTURE:
   * {
   *   LEDGER: {
   *     LEDGER_ACCOUNTS: [
   *       { address, derivationPath, publicKey, index },
   *       ...
   *     ]
   *   }
   * }
   */
  async setLedgerAccounts(accounts: StoredLedgerAccount[]) {
    if (!isArrayOf(accounts, isLedgerAccount))
      throw new Error("Invalid stored Ledger identity");
    const existing =
      (await readLocalStorage(LEDGER_IDENTIFIER))[LEDGER_IDENTIFIER] ?? {};

    await walletLocalStorage.set({
      [LEDGER_IDENTIFIER]: {
        ...getStorageRecord(existing),
        [LEDGER_ACCOUNTS_IDENTIFIER]: mergeStorageArray(
          getStorageArray(
            getStoredValue(existing, LEDGER_ACCOUNTS_IDENTIFIER),
            LEDGER_ACCOUNTS_IDENTIFIER,
          ),
          accounts,
          isLedgerAccount,
          (account) => account.address.toLowerCase(),
          (raw, replacement) => replaceStoredEntry("ledger", raw, replacement),
        ),
      },
    });
  },

  /**
   * Retrieves all stored Ledger accounts.
   *
   * @returns Array of Ledger accounts (empty array if none)
   */
  async getLedgerAccounts(): Promise<StoredLedgerAccount[]> {
    const storedLedger = (await readLocalStorage(LEDGER_IDENTIFIER))[
      LEDGER_IDENTIFIER
    ];
    const accounts = getStoredValue(storedLedger, LEDGER_ACCOUNTS_IDENTIFIER);
    return getStorageArray(accounts, LEDGER_ACCOUNTS_IDENTIFIER).filter(
      isLedgerAccount,
    );
  },

  /**
   * Clears all stored Ledger accounts.
   * Use with caution - removes all Ledger account data.
   */
  async clearLedgerAccounts() {
    const storedLedger =
      (await readLocalStorage(LEDGER_IDENTIFIER))[LEDGER_IDENTIFIER] ?? {};
    const ledger = getStorageRecord(storedLedger);
    Reflect.deleteProperty(ledger, LEDGER_ACCOUNTS_IDENTIFIER);
    await walletLocalStorage.set({
      [LEDGER_IDENTIFIER]: ledger,
    });
  },

  /**
   * Adds a Ledger account address to the global accounts list.
   *
   * @param address - Ledger account address to add
   */
  async addLedgerAccountToAllAccounts(address: string) {
    const storageData = await readLocalStorage(ACCOUNTS_IDENTIFIER);
    const accounts = ensureStorageRecord(storageData, ACCOUNTS_IDENTIFIER);
    const raw = getStorageArray(
      accounts[ALL_ACCOUNTS_IDENTIFIER],
      ALL_ACCOUNTS_IDENTIFIER,
    );
    if (raw.some((item) => matchesStoredAccount(item, address))) return;
    accounts[ALL_ACCOUNTS_IDENTIFIER] = [
      ...raw.map((item) =>
        isNormalizableQrlAddress(item) ? toCanonicalQrlAddress(item) : item,
      ),
      toCanonicalQrlAddress(address),
    ];
    await walletLocalStorage.set(storageData);
  },

  /** Remove only the matching address from the raw global account list. */
  async removeLedgerAccountFromAllAccounts(address: string) {
    const storageData = await readLocalStorage(ACCOUNTS_IDENTIFIER);
    const accounts = ensureStorageRecord(storageData, ACCOUNTS_IDENTIFIER);
    accounts[ALL_ACCOUNTS_IDENTIFIER] = getStorageArray(
      accounts[ALL_ACCOUNTS_IDENTIFIER],
      ALL_ACCOUNTS_IDENTIFIER,
    )
      .filter((item) => !matchesStoredAccount(item, address))
      .map((item) =>
        isNormalizableQrlAddress(item) ? toCanonicalQrlAddress(item) : item,
      );
    await walletLocalStorage.set(storageData);
  },

  /**
   * Checks if an address belongs to a Ledger account.
   *
   * @param address - Address to check
   * @returns true if address is a Ledger account
   */
  async isLedgerAccount(address: string): Promise<boolean> {
    const ledgerAccounts = await this.getLedgerAccounts();
    return ledgerAccounts.some(
      (a) => a.address.toLowerCase() === address.toLowerCase(),
    );
  },

  /**
   * Gets a Ledger account by address.
   *
   * @param address - Address to look up
   * @returns Ledger account or undefined if not found
   */
  async getLedgerAccountByAddress(
    address: string,
  ): Promise<StoredLedgerAccount | undefined> {
    const ledgerAccounts = await this.getLedgerAccounts();
    return ledgerAccounts.find(
      (a) => a.address.toLowerCase() === address.toLowerCase(),
    );
  },

  async setTransactionHistoryEntry(
    accountAddress: string,
    entry: StoredHistoryEntry,
  ) {
    if (!isTransactionHistoryEntry(entry))
      throw new Error("Invalid stored transaction identity");
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TX_HISTORY_IDENTIFIER);
    const chainData = ensureStorageRecord(
      storageData,
      TX_HISTORY_IDENTIFIER,
      ALL_TX_HISTORY_IDENTIFIER,
      accountAddress,
      chainId,
    );
    const existing = getStorageArray(
      chainData.transactions,
      ALL_TX_HISTORY_IDENTIFIER,
    );
    const merged = [
      replaceStoredEntry(
        "history",
        existing.find(
          (tx) =>
            isTransactionHistoryEntry(tx) &&
            tx.transactionHash === entry.transactionHash,
        ),
        entry,
      ),
      ...existing.filter(
        (tx) =>
          !isTransactionHistoryEntry(tx) ||
          tx.transactionHash !== entry.transactionHash,
      ),
    ];
    // The retention cap counts readable entries only, so an unrelated write
    // never evicts a raw record it cannot read. For a fully readable list this
    // equals merged.slice(0, cap).
    let readable = 0;
    chainData.transactions = merged.filter(
      (tx) =>
        !isTransactionHistoryEntry(tx) ||
        ++readable <= StorageUtil.TX_HISTORY_MAX_PER_ACCOUNT_CHAIN,
    );

    await walletLocalStorage.set(storageData);
  },

  async getTransactionHistory(
    accountAddress: string,
  ): Promise<StoredHistoryEntry[]> {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TX_HISTORY_IDENTIFIER);
    const transactions = getStoredValue(
      storageData,
      TX_HISTORY_IDENTIFIER,
      ALL_TX_HISTORY_IDENTIFIER,
      accountAddress,
      chainId,
      "transactions",
    );
    return getStorageArray(transactions, ALL_TX_HISTORY_IDENTIFIER).filter(
      isTransactionHistoryEntry,
    );
  },

  async updateTransactionHistoryEntry(
    accountAddress: string,
    transactionHash: string,
    updates: Partial<TransactionHistoryEntry>,
  ) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TX_HISTORY_IDENTIFIER);
    const storedTransactions = getStoredValue(
      storageData,
      TX_HISTORY_IDENTIFIER,
      ALL_TX_HISTORY_IDENTIFIER,
      accountAddress,
      chainId,
      "transactions",
    );
    const transactions = getStorageArray(
      storedTransactions,
      ALL_TX_HISTORY_IDENTIFIER,
    );

    // confirmed / failed are terminal states; refuse updates that would
    // revert a tx back to pending (or otherwise change a terminal status).
    const TERMINAL: unknown[] = ["confirmed", "failed"];
    const updatedTransactions = transactions.map((tx) => {
      if (
        !isTransactionHistoryEntry(tx) ||
        tx.transactionHash !== transactionHash
      )
        return tx;
      const merged = { ...tx, ...updates };
      const hasReceipt =
        !!updates.receiptStatusVerified &&
        !!updates.blockNumber &&
        (updates.pendingStatus === "confirmed" ||
          updates.pendingStatus === "failed");
      if (TERMINAL.includes(tx.pendingStatus) && !hasReceipt) {
        merged.pendingStatus = tx.pendingStatus;
        merged.status = tx.status;
      }
      return merged;
    });

    const chainData = ensureStorageRecord(
      storageData,
      TX_HISTORY_IDENTIFIER,
      ALL_TX_HISTORY_IDENTIFIER,
      accountAddress,
      chainId,
    );
    chainData.transactions = updatedTransactions;

    await walletLocalStorage.set(storageData);
  },

  async getPendingTransactions(
    accountAddress: string,
  ): Promise<StoredHistoryEntry[]> {
    const history = await this.getTransactionHistory(accountAddress);
    return history.filter((tx) => tx.pendingStatus === "pending");
  },

  async clearTransactionHistory(accountAddress: string) {
    const { chainId } = await this.getActiveBlockChain();

    const storageData = await readLocalStorage(TX_HISTORY_IDENTIFIER);
    const chainData = getStoredValue(
      storageData,
      TX_HISTORY_IDENTIFIER,
      ALL_TX_HISTORY_IDENTIFIER,
      accountAddress,
      chainId,
    );
    if (isRecord(chainData)) {
      chainData.transactions = [];
      await walletLocalStorage.set(storageData);
    }
  },

  async setPriceCache(cache: PriceCache) {
    const storageData = await readLocalStorage(PRICE_CACHE_IDENTIFIER);
    await walletLocalStorage.set({
      [PRICE_CACHE_IDENTIFIER]: replaceStoredPriceCache(
        storageData[PRICE_CACHE_IDENTIFIER],
        cache,
      ),
    });
  },

  async getPriceCache(): Promise<PriceCache | null> {
    const storageData = await readLocalStorage(PRICE_CACHE_IDENTIFIER);
    const cache = storageData[PRICE_CACHE_IDENTIFIER];
    return isPriceCache(cache) ? cache : null;
  },
};

export default StorageUtil;
