import { makeAutoObservable, runInAction } from "mobx";

/**
 * Stand-in for the store's balance reader in component tests.
 *
 * It mirrors the real one on the two points that matter: the account list
 * is observable, and the reader is a bound plain function rather than a
 * MobX action, so a read during render is tracked. A component that mirrors
 * the value into state, or that reads it only from an effect or a memo
 * whose dependency list leaves it out, keeps the old number here and fails.
 *
 * The production reader itself is covered by
 * `src/stores/qrlStore.balanceReactivity.test.tsx`, which drives a real
 * store.
 */
export class ObservableBalances {
  balances: Record<string, string>;

  constructor(balances: Record<string, string> = {}) {
    this.balances = balances;
    makeAutoObservable(this, { getAccountBalance: false });
  }

  getAccountBalance = (accountAddress: string): string =>
    this.balances[accountAddress] ?? "0.0 Quanta";

  set(accountAddress: string, accountBalance: string) {
    runInAction(() => {
      this.balances = { ...this.balances, [accountAddress]: accountBalance };
    });
  }
}
