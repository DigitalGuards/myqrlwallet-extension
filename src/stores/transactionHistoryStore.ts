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
import {
  needsReceipt,
  transactionFailureUpdate,
} from "@/functions/transactionOutcome";
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
  getTransactionReceipt: (txHash: string) => Promise<
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
  /** True when the explorer could not be reached for the current account,
   *  so the screen can say the list is local-only. An empty list would
   *  otherwise read as "this account has no history". */
  onChainFailed = false;
  filter: TokenFilter = "all";
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  /** Bumped per loadOnChainHistory call so a slow response for a
   *  previously-active account cannot land on the current one. */
  private onChainRequestId = 0;
  /** Same guard for the local-history read. */
  private localRequestId = 0;
  /** The account whose local entries are currently in `transactions`. */
  private loadedAccountAddress = "";

  constructor() {
    makeAutoObservable(this, {
      transactions: observable,
      onChainTransactions: observable,
      onChainTotal: observable,
      onChainPage: observable,
      isLoading: observable,
      isLoadingOnChain: observable,
      onChainFailed: observable,
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
      reconcileReplacedTransactions: action.bound,
    });
  }

  /** Local entries (pending metadata, token detail) joined with the
   *  explorer's view of the address. On hash collision the local entry
   *  wins: it knows token metadata and the pending lifecycle. Internal
   *  entries bypass that dedup: they share the outer transaction's hash
   *  but represent distinct value movement (e.g. a contract paying out
   *  inside a call this wallet sent). */
  get mergedTransactions(): TransactionHistoryEntry[] {
    const verified = new Map(
      this.onChainTransactions
        .filter((tx) => !tx.isInternal && tx.receiptStatusVerified)
        .map((tx) => [`${tx.chainId}:${tx.transactionHash.toLowerCase()}`, tx]),
    );
    const localHashes = new Set(
      this.transactions.map((tx) => tx.transactionHash.toLowerCase()),
    );
    return [
      ...this.transactions.map((tx) => {
        const receipt = verified.get(
          `${tx.chainId}:${tx.transactionHash.toLowerCase()}`,
        );
        if (!receipt) return tx;
        return {
          ...tx,
          status: receipt.status,
          pendingStatus: receipt.pendingStatus,
          blockNumber: receipt.blockNumber,
          paidFeesQrl: receipt.paidFeesQrl ?? tx.paidFeesQrl,
          receiptStatusVerified: true,
        };
      }),
      ...this.onChainTransactions.filter(
        (tx) =>
          tx.isInternal || !localHashes.has(tx.transactionHash.toLowerCase()),
      ),
    ].sort(
      // Newest first. An internal payout shares its block timestamp with
      // the outer call that produced it, so on a tie the internal entry
      // sorts as the newer item: it is the effect, the call is the cause.
      (a, b) =>
        b.timestamp - a.timestamp ||
        Number(b.isInternal ?? false) - Number(a.isInternal ?? false),
    );
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
    return this.transactions.filter(needsReceipt);
  }

  async loadHistory(accountAddress: string, qrlInstance?: QrlInstance) {
    const requestId = ++this.localRequestId;
    const isAccountChange =
      accountAddress.toLowerCase() !== this.loadedAccountAddress.toLowerCase();
    // Switching accounts clears first. Holding the previous account's rows
    // while the new read is in flight rendered account A's transactions
    // under account B, and a slow read for A could land after B's and stay.
    if (isAccountChange) {
      this.transactions = [];
      this.loadedAccountAddress = accountAddress;
    }
    this.isLoading = true;
    try {
      const history = await StorageUtil.getTransactionHistory(accountAddress);
      if (requestId !== this.localRequestId) return;
      runInAction(() => {
        this.transactions = history;
      });
      if (qrlInstance && history.some(needsReceipt)) {
        this.startPolling(accountAddress, qrlInstance);
      }
    } catch (error) {
      console.error("Failed to load transaction history:", error);
    } finally {
      runInAction(() => {
        if (requestId === this.localRequestId) {
          this.isLoading = false;
        }
      });
    }
  }

  async loadOnChainHistory(accountAddress: string, chainId: string) {
    const requestId = ++this.onChainRequestId;
    this.onChainTransactions = [];
    this.onChainTotal = 0;
    this.onChainPage = 0;
    this.onChainFailed = false;
    this.isLoadingOnChain = true;
    try {
      const { entries, totalCount, failed } = await fetchOnChainHistory(
        accountAddress,
        chainId,
        1,
      );
      runInAction(() => {
        if (requestId !== this.onChainRequestId) return;
        this.onChainTransactions = entries;
        this.onChainTotal = totalCount;
        this.onChainPage = 1;
        this.onChainFailed = failed;
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
      const { entries, totalCount, failed } = await fetchOnChainHistory(
        accountAddress,
        chainId,
        nextPage,
      );
      runInAction(() => {
        if (requestId !== this.onChainRequestId) return;
        this.onChainFailed = failed;
        if (failed) return;
        // Dedup by id, not hash: an internal entry shares its hash with
        // the outer transaction but is its own row (id carries the call
        // tree position).
        const seen = new Set(
          this.onChainTransactions.map((tx) => tx.id.toLowerCase()),
        );
        this.onChainTransactions = [
          ...this.onChainTransactions,
          ...entries.filter((tx) => !seen.has(tx.id.toLowerCase())),
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

  async addTransaction(accountAddress: string, entry: TransactionHistoryEntry) {
    await StorageUtil.setTransactionHistoryEntry(accountAddress, entry);
    await this.loadHistory(accountAddress);
    if (
      entry.pendingStatus === "confirmed" ||
      entry.pendingStatus === "failed"
    ) {
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
          const update = transactionFailureUpdate(
            { receipt },
            tx.transactionHash,
          );
          if (update.receiptStatusVerified) {
            const newStatus = update.pendingStatus;
            // Re-read storage immediately before writing: the service
            // worker's own dApp-transaction watcher (dAppTransactionWatcher.ts)
            // can confirm the same hash out-of-band between this interval
            // starting and now, from `this.transactions`'s own stale
            // snapshot. Notifying again for a hash already terminal in
            // storage would double the desktop notification.
            const freshEntry = (
              await StorageUtil.getTransactionHistory(accountAddress)
            ).find(
              (entry) =>
                entry.transactionHash.toLowerCase() ===
                tx.transactionHash.toLowerCase(),
            );
            const alreadyTerminal =
              freshEntry?.pendingStatus === "confirmed" ||
              freshEntry?.pendingStatus === "failed";
            await this.updateTransaction(
              accountAddress,
              tx.transactionHash,
              update,
            );
            if (!alreadyTerminal) {
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
          }
        } catch (error) {
          console.error(`Polling error for ${tx.transactionHash}:`, error);
        }
      }

      await this.reconcileReplacedTransactions(accountAddress);
    }, 10000);
  }

  /**
   * Settles originals whose replacement already landed.
   *
   * Speed Up marks the original "replaced" from the broadcast callback. If
   * the surface is destroyed between signing and that callback (closing the
   * popup does exactly that), nothing marks it, and the original sits
   * pending forever while its nonce has already been spent. A confirmed
   * transaction from the same account carrying the same nonce is proof the
   * original can never be mined, so it is settled here instead.
   */
  async reconcileReplacedTransactions(accountAddress: string) {
    const stillPending = this.transactions.filter(needsReceipt);
    for (const tx of stillPending) {
      if (tx.nonce === undefined) continue;
      const replacement = this.transactions.find(
        (other) =>
          other.nonce === tx.nonce &&
          other.receiptStatusVerified === true &&
          other.pendingStatus === "confirmed" &&
          !other.isInternal &&
          other.transactionHash.toLowerCase() !==
            tx.transactionHash.toLowerCase(),
      );
      if (!replacement) continue;
      await this.updateTransaction(accountAddress, tx.transactionHash, {
        pendingStatus: "replaced",
        replacementTransactionHash: replacement.transactionHash,
        replacedByAction: "speed-up",
      });
    }
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

export default TransactionHistoryStore;
