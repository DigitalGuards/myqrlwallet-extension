import StorageUtil from "@/utilities/storageUtil";
import { action, makeAutoObservable, observable, runInAction } from "mobx";

type AccountLike = { accountAddress: string };

class AccountLabelsStore {
  labels: Record<string, string> = {};
  isLoading = false;

  constructor() {
    makeAutoObservable(this, {
      labels: observable,
      isLoading: observable,
      loadLabels: action.bound,
      syncLabels: action.bound,
      setLabel: action.bound,
      removeLabel: action.bound,
      clearLabels: action.bound,
    });
  }

  async loadLabels() {
    this.isLoading = true;
    try {
      const labels = await StorageUtil.getAccountLabels();
      runInAction(() => {
        this.labels = labels;
      });
    } catch (error) {
      console.error("Failed to load account labels:", error);
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async syncLabels(
    accounts: AccountLike[],
    isLedgerAccountFn: (address: string) => boolean,
  ) {
    const stored = await StorageUtil.getAccountLabels();
    let changed = false;

    const usedAccountNums = new Set<number>();
    const usedLedgerNums = new Set<number>();
    for (const label of Object.values(stored)) {
      const accountMatch = label.match(/^Account (\d+)$/);
      if (accountMatch) usedAccountNums.add(Number(accountMatch[1]));
      const ledgerMatch = label.match(/^Ledger (\d+)$/);
      if (ledgerMatch) usedLedgerNums.add(Number(ledgerMatch[1]));
    }

    const nextAvailable = (used: Set<number>) => {
      let n = 1;
      while (used.has(n)) n++;
      used.add(n);
      return n;
    };

    for (const a of accounts) {
      if (!stored[a.accountAddress]) {
        const isLedger = isLedgerAccountFn(a.accountAddress);
        const num = nextAvailable(isLedger ? usedLedgerNums : usedAccountNums);
        stored[a.accountAddress] = isLedger
          ? `Ledger ${num}`
          : `Account ${num}`;
        changed = true;
      }
    }

    if (changed) {
      await StorageUtil.setAccountLabels(stored);
    }
    runInAction(() => {
      this.labels = stored;
    });
  }

  async setLabel(address: string, label: string) {
    const updated = { ...this.labels, [address]: label };
    await StorageUtil.setAccountLabels(updated);
    runInAction(() => {
      this.labels = updated;
    });
  }

  getLabel(address: string): string {
    return this.labels[address] ?? "";
  }

  async removeLabel(address: string) {
    if (!(address in this.labels)) return;
    const updated = { ...this.labels };
    delete updated[address];
    await StorageUtil.setAccountLabels(updated);
    runInAction(() => {
      this.labels = updated;
    });
  }

  async clearLabels() {
    await StorageUtil.clearAccountLabels();
    runInAction(() => {
      this.labels = {};
    });
  }
}

export default AccountLabelsStore;
