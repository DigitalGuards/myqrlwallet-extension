import { LOCK_MANAGER_MESSAGES } from "@/scripts/lockManager/lockManager";
import {
  fetchOnChainHistory,
  ON_CHAIN_PAGE_SIZE,
} from "@/services/onChainHistory";
import type {
  TokenFilter,
  TransactionHistoryEntry,
} from "@/types/transactionHistory";
import StorageUtil from "@/utilities/storageUtil";
import browser from "webextension-polyfill";
import {
  action,
  computed,
  makeAutoObservable,
  observable,
  runInAction,
} from "mobx";

type ReceiptStatus = string | number | bigint;

type QrlInstance = {
  getTransactionReceipt: (
    txHash: string,
  ) => Promise<
    | {
        status?: ReceiptStatus;
        blockNumber?: bigint;
        gasUsed?: bigint;
        effectiveGasPrice?: bigint;
      }
    | undefined
  >;
};

class TransactionHistoryStore {
  transactions: TransactionHistoryEntry[] = [];
  onChainTransactions: TransactionHistoryEntry[] = [];
  onChainTotal = 0;
  onChainPage = 0;
  isLoading = false;
  isLoadingOnChain = false;
  filter: TokenFilter = "all";
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  /** Bumped per loadOnChainHistory call so a slow response for a
   *  previously-active account cannot land on the current one. */
  private onChainRequestId = 0;

  constructor() {
    makeAutoObservable(this, {
      transactions: observable,
      onChainTransactions: observable,
      onChainTotal: observable,
      onChainPage: observable,
      isLoading: observable,
      isLoadingOnChain: observable,
      filter: observable,
      mergedTransactions: computed,
      filteredTransactions: computed,
      pendingTransactions: computed,
      hasMoreOnChain: computed,
      loadHistory: action.bound,
      loadOnChainHistory: action.bound,
      loadMoreOnChain: action.bound,
      addTransaction: action.bound,
      updateTransaction: action.bound,
      setFilter: action.bound,
      clearHistory: action.bound,
      startPolling: action.bound,
      stopPolling: action.bound,
    });
  }

  /** Local entries (pending metadata, token detail) joined with the
   *  explorer's view of the address. On hash collision the local entry
   *  wins: it knows token metadata and the pending lifecycle. */
  get mergedTransactions(): TransactionHistoryEntry[] {
    const localHashes = new Set(
      this.transactions.map((tx) => tx.transactionHash.toLowerCase()),
    );
    return [
      ...this.transactions,
      ...this.onChainTransactions.filter(
        (tx) => !localHashes.has(tx.transactionHash.toLowerCase()),
      ),
    ].sort((a, b) => b.timestamp - a.timestamp);
  }

  get hasMoreOnChain(): boolean {
    return this.onChainTransactions.length < this.onChainTotal;
  }

  get filteredTransactions(): TransactionHistoryEntry[] {
    const merged = this.mergedTransactions;
    if (this.filter === "all") return merged;
    if (this.filter === "native")
      return merged.filter(
        (tx) => !tx.isZrc20Token && !tx.tokenContractAddress,
      );
    if (this.filter === "nft")
      return merged.filter(
        (tx) => !tx.isZrc20Token && !!tx.tokenContractAddress,
      );
    return merged.filter((tx) => tx.isZrc20Token);
  }

  get pendingTransactions(): TransactionHistoryEntry[] {
    return this.transactions.filter((tx) => tx.pendingStatus === "pending");
  }

  async loadHistory(accountAddress: string, qrlInstance?: QrlInstance) {
    this.isLoading = true;
    try {
      const history =
        await StorageUtil.getTransactionHistory(accountAddress);
      runInAction(() => {
        this.transactions = history;
      });
      if (
        qrlInstance &&
        history.some((tx) => tx.pendingStatus === "pending")
      ) {
        this.startPolling(accountAddress, qrlInstance);
      }
    } catch (error) {
      console.error("Failed to load transaction history:", error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async loadOnChainHistory(accountAddress: string, chainId: string) {
    const requestId = ++this.onChainRequestId;
    this.onChainTransactions = [];
    this.onChainTotal = 0;
    this.onChainPage = 0;
    this.isLoadingOnChain = true;
    try {
      const { entries, totalCount } = await fetchOnChainHistory(
        accountAddress,
        chainId,
        1,
      );
      runInAction(() => {
        if (requestId !== this.onChainRequestId) return;
        this.onChainTransactions = entries;
        this.onChainTotal = totalCount;
        this.onChainPage = 1;
      });
    } finally {
      runInAction(() => {
        if (requestId === this.onChainRequestId) {
          this.isLoadingOnChain = false;
        }
      });
    }
  }

  async loadMoreOnChain(accountAddress: string, chainId: string) {
    if (this.isLoadingOnChain || !this.hasMoreOnChain) return;
    const requestId = this.onChainRequestId;
    const nextPage = this.onChainPage + 1;
    this.isLoadingOnChain = true;
    try {
      const { entries, totalCount } = await fetchOnChainHistory(
        accountAddress,
        chainId,
        nextPage,
      );
      runInAction(() => {
        if (requestId !== this.onChainRequestId) return;
        const seen = new Set(
          this.onChainTransactions.map((tx) =>
            tx.transactionHash.toLowerCase(),
          ),
        );
        this.onChainTransactions = [
          ...this.onChainTransactions,
          ...entries.filter(
            (tx) => !seen.has(tx.transactionHash.toLowerCase()),
          ),
        ];
        this.onChainPage = nextPage;
        // A short page means the explorer is exhausted regardless of what
        // the count says, so Load More can never spin forever.
        this.onChainTotal =
          entries.length < ON_CHAIN_PAGE_SIZE
            ? this.onChainTransactions.length
            : totalCount;
      });
    } finally {
      runInAction(() => {
        if (requestId === this.onChainRequestId) {
          this.isLoadingOnChain = false;
        }
      });
    }
  }

  async addTransaction(
    accountAddress: string,
    entry: TransactionHistoryEntry,
  ) {
    await StorageUtil.setTransactionHistoryEntry(accountAddress, entry);
    await this.loadHistory(accountAddress);
    if (entry.pendingStatus === "confirmed" || entry.pendingStatus === "failed") {
      browser.runtime
        .sendMessage({
          name: LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION,
          data: {
            status: entry.pendingStatus,
            amount: entry.amount,
            tokenSymbol: entry.tokenSymbol,
            txHash: entry.transactionHash,
          },
        })
        .catch(() => {});
    }
  }

  async updateTransaction(
    accountAddress: string,
    transactionHash: string,
    updates: Partial<TransactionHistoryEntry>,
  ) {
    await StorageUtil.updateTransactionHistoryEntry(
      accountAddress,
      transactionHash,
      updates,
    );
    await this.loadHistory(accountAddress);
  }

  setFilter(filter: TokenFilter) {
    this.filter = filter;
  }

  async clearHistory(accountAddress: string) {
    await StorageUtil.clearTransactionHistory(accountAddress);
    runInAction(() => {
      this.transactions = [];
    });
  }

  startPolling(accountAddress: string, qrlInstance: QrlInstance) {
    this.stopPolling();

    this.pollingInterval = setInterval(async () => {
      const pending = this.pendingTransactions;
      if (pending.length === 0) {
        this.stopPolling();
        return;
      }

      for (const tx of pending) {
        try {
          const receipt = await qrlInstance.getTransactionReceipt(
            tx.transactionHash,
          );
          if (receipt) {
            const isSuccess = receipt.status?.toString() === "1";
            const newStatus = isSuccess ? "confirmed" : "failed";
            await this.updateTransaction(
              accountAddress,
              tx.transactionHash,
              {
                pendingStatus: newStatus,
                status: isSuccess,
                blockNumber: receipt.blockNumber?.toString() ?? "",
                gasUsed: receipt.gasUsed?.toString() ?? "",
                effectiveGasPrice: (
                  receipt.effectiveGasPrice ?? 0
                ).toString(),
              },
            );
            browser.runtime
              .sendMessage({
                name: LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION,
                data: {
                  status: newStatus,
                  amount: tx.amount,
                  tokenSymbol: tx.tokenSymbol,
                  txHash: tx.transactionHash,
                },
              })
              .catch(() => {});
          }
        } catch (error) {
          console.error(
            `Polling error for ${tx.transactionHash}:`,
            error,
          );
        }
      }
    }, 10000);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

export default TransactionHistoryStore;
