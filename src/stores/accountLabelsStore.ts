import StorageUtil from "@/utilities/storageUtil";
import { action, makeAutoObservable, observable, runInAction } from "mobx";

type AccountLike = { accountAddress: string };

/** Numbers already taken by default labels, so a new one never collides. */
const collectUsedNumbers = (stored: Record<string, string>) => {
  const usedAccountNums = new Set<number>();
  const usedLedgerNums = new Set<number>();
  for (const label of Object.values(stored)) {
    const accountMatch = label.match(/^Account (\d+)$/);
    if (accountMatch) usedAccountNums.add(Number(accountMatch[1]));
    const ledgerMatch = label.match(/^Ledger (\d+)$/);
    if (ledgerMatch) usedLedgerNums.add(Number(ledgerMatch[1]));
  }
  return { usedAccountNums, usedLedgerNums };
};

const nextAvailable = (used: Set<number>) => {
  let n = 1;
  while (used.has(n)) n++;
  used.add(n);
  return n;
};

/**
 * Name for an account that has no stored label yet, derived from its
 * position in the wallet's account list.
 *
 * Purely a display value: nothing persists it, and a stored label always
 * wins over it. It exists so a screen can name an account during the
 * milliseconds before the stored labels come back from storage, without
 * ever falling back to the raw address.
 */
export const positionalAccountLabel = (index: number) => `Account ${index + 1}`;

class AccountLabelsStore {
  labels: Record<string, string> = {};
  isLoading = false;

  constructor() {
    makeAutoObservable(this, {
      labels: observable,
      isLoading: observable,
      loadLabels: action.bound,
      syncLabels: action.bound,
      ensureLabel: action.bound,
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

  /**
   * Give one account its default name straight away.
   *
   * Called the moment an account is created or imported, so the header
   * shows "Account N" immediately instead of falling back to the raw
   * address until something else happens to run syncLabels (previously
   * only the account list and the recipient picker did, which is why a
   * fresh account showed its address until you navigated around).
   *
   * Numbering comes from the same helper syncLabels uses, so the two
   * paths cannot hand out the same number.
   */
  async ensureLabel(address: string, isLedger = false) {
    if (!address) return;
    const stored = await StorageUtil.getAccountLabels();
    if (stored[address]) {
      runInAction(() => {
        this.labels = stored;
      });
      return;
    }

    const { usedAccountNums, usedLedgerNums } = collectUsedNumbers(stored);
    const num = nextAvailable(isLedger ? usedLedgerNums : usedAccountNums);
    stored[address] = isLedger ? `Ledger ${num}` : `Account ${num}`;

    await StorageUtil.setAccountLabels(stored);
    runInAction(() => {
      this.labels = stored;
    });
  }

  async syncLabels(
    accounts: AccountLike[],
    isLedgerAccountFn: (address: string) => boolean,
  ) {
    const stored = await StorageUtil.getAccountLabels();
    let changed = false;

    const { usedAccountNums, usedLedgerNums } = collectUsedNumbers(stored);

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

  /**
   * The name to show for an account right now, with no storage round trip.
   *
   * Stored labels (including renamed and "Ledger N" ones) win. An account
   * the wallet already lists but has no stored label for gets its
   * positional name, which covers the window between an account becoming
   * active and `loadLabels` resolving. An address the wallet does not list
   * yet resolves to the empty string, so the caller can show a neutral
   * placeholder instead of the raw address.
   */
  displayLabel(address: string, accounts: readonly AccountLike[]): string {
    if (!address) return "";
    const stored = this.labels[address];
    if (stored) return stored;
    const index = accounts.findIndex(
      (account) => account.accountAddress === address,
    );
    return index === -1 ? "" : positionalAccountLabel(index);
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
