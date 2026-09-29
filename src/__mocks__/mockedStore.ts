import {
  type BlockchainDataType,
  DEFAULT_BLOCKCHAIN,
} from "@/configuration/qrlBlockchainConfig";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import type LockStore from "@/stores/lockStore";
import type SettingsStore from "@/stores/settingsStore";
import type { StoreType } from "@/stores/store";
import type QrlStore from "@/stores/qrlStore";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import deepmerge from "deepmerge";
import { createContext, useContext } from "react";
import type { PartialDeep } from "type-fest";

const mockedStoreValues: StoreType = {
  settingsStore: {
    isDarkMode: true,
    theme: "dark",
    isPopupWindow: true,
    isSidePanel: false,
    themePreference: "system",
    autoLockMinutes: 15,
    currency: "USD",
    language: "en",
    defaultGasTier: "market" as const,
    showBalanceAndPrice: true,
    sidePanelPreferred: false,
    setThemePreference: async () => {},
    setAutoLockMinutes: async () => {},
    setCurrency: async () => {},
    setLanguage: async () => {},
    setDefaultGasTier: async () => {},
    setShowBalanceAndPrice: async () => {},
    setSidePanelPreferred: async () => {},
  } as unknown as SettingsStore,
  qrlStore: {
    activeAccount: {
      accountAddress: `Q${"a".repeat(128)}`,
    },
    qrlAccounts: {
      isLoading: false,
      accounts: [],
    },
    qrlConnection: {
      isConnected: true,
      isLoading: false,
      blockchain: DEFAULT_BLOCKCHAIN,
    },
    initProgress: {
      active: false,
      fraction: 1,
      phase: "session",
    },
    qrlInstance: undefined,
    fetchAccounts: async () => {},
    fetchQrlConnection: async () => {},
    getAccountBalance: (_accountAddress: string) => {
      return "0.0 Quanta";
    },
    initializeBlockchain: async () => {},
    selectBlockchain: async (_chainId: string) => {},
    setActiveAccount: async () => {},
    assertAccountRemovable: async (_accountAddress: string) => ({
      remainingKeystores: [],
      remainingAccounts: [],
    }),
    removeAccount: async (_accountAddress: string) => {},
    clearAccountState: () => {},
    getNativeTokenGas: async () => {
      return "";
    },
    signNativeToken: async (
      _from: string,
      _to: string,
      _value: number,
      _mnemonicPhrases: string,
    ) => {
      return {
        transactionHash: undefined,
        rawTransaction: undefined,
        error: "",
      };
    },
    validateActiveAccount: async () => {},
    getGasFeeData: async () => {
      return {
        baseFeePerGas: BigInt(0),
        maxFeePerGas: BigInt(0),
        maxPriorityFeePerGas: BigInt(0),
      };
    },
    getZrc20TokenDetails: async () => ({
      token: undefined,
      error: "",
    }),
    getNftCollectionDetails: async () => ({
      collection: undefined,
      error: "",
    }),
    getOwnedNftTokens: async () => ({ tokens: [], failed: false }),
    getErc1155TokenBalance: async () => undefined,
    getNftTokenUri: async () => "",
    signNftTransfer: async () => ({
      transactionHash: undefined,
      rawTransaction: undefined,
      error: "",
    }),
    getZrc20TokenGas: async (
      _from: string,
      _to: string,
      _value: number,
      _contractAddress: string,
      _decimals: number,
    ) => {
      return "";
    },
    signZrc20Token: async (
      _from: string,
      _to: string,
      _value: number,
      _mnemonicPhrases: string,
      _contractAddress: string,
      _decimals: number,
    ) => {
      return {
        transactionHash: undefined,
        rawTransaction: undefined,
        error: "",
      };
    },
    signAndSendReplacementTransaction: async () => ({
      transactionHash: undefined,
      rawTransaction: undefined,
      error: "",
    }),
    getTransactionReceipt: async () => null,
    sendRawTransaction: async () => undefined,
    refreshBlockchainData: async () => {},
    addChain: async (_chainData: BlockchainDataType) => {
      return { chainFound: false, updatedChainList: [] };
    },
    editChain: async (_chainData: BlockchainDataType) => {
      return { updatedChainList: [] };
    },
  } as unknown as QrlStore,
  dAppRequestStore: {
    dAppRequestData: {
      method: "qrl_requestAccounts",
      requestData: {
        senderData: {
          tabId: 1,
          title: "Mocked Page Title",
          url: "http://localhost/",
          favIconUrl: "http://localhost/mocked-fav-icon.svg",
        },
      },
      phishingResult: {
        isDomainPhishing: false,
      },
    },
    hasDAppConnected: false,
    hasDAppRequest: true,
    responseData: {},
    canProceed: false,
    onPermissionCallBack: async (
      _hasApproved: boolean,
      _record: (data: Record<string, unknown>) => void,
    ) => {},
    approvalProcessingStatus: {
      hasApproved: false,
      isProcessing: false,
      hasCompleted: false,
    },
    readDAppRequestData: async () => {},
    addToResponseData: (_data: any) => {},
    setCanProceed: (_decision: boolean) => {},
    setOnPermissionCallBack: (
      _callBack: (
        hasApproved: boolean,
        record: (data: Record<string, unknown>) => void,
      ) => Promise<void>,
    ) => {},
    setApprovalProcessingStatus: async (_status: {
      isProcessing?: boolean;
      hasApproved?: boolean;
      hasCompleted?: boolean;
    }) => {},
    onPermission: async (_hasApproved: boolean) => {},
    reportPendingTransactionHash: async (_transactionHash: string) => {},
    fetchCurrentTabData: async () => {},
    disconnectFromCurrentTab: async () => {},
  } as unknown as DAppRequestStore,
  lockStore: {
    hasPasswordSet: false,
    isLoading: false,
    isLocked: false,
    readLockState: async () => {},
    unlock: async (password: string) => {
      return password ? "success" : "wrong-password";
    },
    encryptAccount: async (
      _account: Web3BaseWalletAccount,
      _password?: string,
    ) => {},
    initialize: () => {},
    lock: async () => {},
    initializeStorageListener: () => {},
    ensureWalletPassword: async () => {},
    getMnemonicPhrases: async (accountAddress: string) => {
      return accountAddress;
    },
    changePassword: async () => {
      return "success";
    },
    removeAccountKey: async (_accountAddress: string) => {},
    resetWallet: async () => {},
  } as unknown as LockStore,
  ledgerStore: {
    connectionState: "disconnected",
    deviceInfo: null,
    connectionError: "",
    accounts: [],
    isLoadingAccounts: false,
    signingState: "idle",
    signingStatus: null,
    signResult: null,
    isConnected: false,
    isConnecting: false,
    hasError: false,
    hasAccounts: false,
    isSigning: false,
    isAwaitingConfirmation: false,
    connect: async () => {},
    disconnect: async () => {},
    loadAccounts: async () => {},
    fetchPageAccounts: async () => {},
    addAccount: async () => ({
      address: "",
      derivationPath: "",
      publicKey: "",
      index: 0,
    }),
    removeAccount: async () => {},
    verifyAddress: async () => true,
    signTransaction: async () => ({ success: false }),
    signAndSerializeTransaction: async () => "0x",
    fetchPublicKey: async () => ({ publicKey: "" }),
    clearSigningState: () => {},
    clearError: () => {},
    isLedgerAccount: () => false,
    getAccountByAddress: () => undefined,
  } as any,
  transactionHistoryStore: {
    transactions: [],
    onChainTransactions: [],
    onChainTotal: 0,
    onChainPage: 0,
    isLoading: false,
    isLoadingOnChain: false,
    filter: "all" as const,
    filteredTransactions: [],
    mergedTransactions: [],
    pendingTransactions: [],
    hasMoreOnChain: false,
    loadHistory: async (_accountAddress: string, _qrlInstance?: any) => {},
    loadOnChainHistory: async (_accountAddress: string, _chainId: string) => {},
    loadMoreOnChain: async (_accountAddress: string, _chainId: string) => {},
    addTransaction: async (_accountAddress: string, _entry: any) => {},
    updateTransaction: async (
      _accountAddress: string,
      _transactionHash: string,
      _updates: any,
    ) => {},
    setFilter: (_filter: string) => {},
    clearHistory: async (_accountAddress: string) => {},
    startPolling: (_accountAddress: string, _qrlInstance: any) => {},
    stopPolling: () => {},
  } as any,
  contactsStore: {
    contacts: [],
    isLoading: false,
    loadContacts: async () => {},
    addContact: async () => {},
    removeContact: async () => {},
    updateContact: async () => {},
    getContactByAddress: () => undefined,
  },
  accountLabelsStore: {
    labels: {},
    isLoading: false,
    loadLabels: async () => {},
    syncLabels: async () => {},
    ensureLabel: async () => {},
    setLabel: async () => {},
    getLabel: () => "",
    removeLabel: async () => {},
    clearLabels: async () => {},
  },
  hiddenAccountsStore: {
    hiddenAccounts: {},
    hiddenAddresses: [],
    loadHiddenAccounts: async () => {},
    hideAccount: async () => {},
    unhideAccount: async () => {},
    isHidden: () => false,
  } as any,
  priceStore: {
    prices: {},
    change24h: {},
    lastUpdated: 0,
    isLoading: false,
    hasError: false,
    getPrice: () => 0,
    quoteFor: (currency: string) => ({ price: 0, currency, change24h: 0 }),
    updatedAt: {},
    isCacheStale: false,
    initialize: async () => {},
    fetchPrices: async () => {},
    setRefreshEnabled: () => {},
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    getChange24h: () => 0,
  } as any,
  // The real store wires its polling reactions in the constructor and keeps
  // the disposer; nothing is wired here, so tearing down is a no-op.
  disposeDataLifecycle: () => {},
};

export const mockedStore = (
  overrideStoreValues: PartialDeep<StoreType> = {},
) => {
  return deepmerge(mockedStoreValues, overrideStoreValues) as StoreType;
};
const StoreContext = createContext(mockedStore);
export const useStore = () => useContext(StoreContext);
export const StoreProvider = StoreContext.Provider;
