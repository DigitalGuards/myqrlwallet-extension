import { reaction } from "mobx";
import { createContext, useContext } from "react";
import AccountLabelsStore from "./accountLabelsStore";
import HiddenAccountsStore from "./hiddenAccountsStore";
import ContactsStore from "./contactsStore";
import DAppRequestStore from "./dAppRequestStore";
import LedgerStore from "./ledgerStore";
import LockStore from "./lockStore";
import PriceStore from "./priceStore";
import SettingsStore from "./settingsStore";
import TransactionHistoryStore from "./transactionHistoryStore";
import QrlStore from "./qrlStore";

class Store {
  lockStore;
  settingsStore;
  dAppRequestStore;
  qrlStore;
  ledgerStore;
  transactionHistoryStore;
  contactsStore;
  accountLabelsStore;
  hiddenAccountsStore;
  priceStore;

  constructor() {
    this.lockStore = new LockStore();
    this.settingsStore = new SettingsStore();
    this.dAppRequestStore = new DAppRequestStore();
    this.qrlStore = new QrlStore();
    this.ledgerStore = new LedgerStore();
    this.transactionHistoryStore = new TransactionHistoryStore();
    this.contactsStore = new ContactsStore();
    this.accountLabelsStore = new AccountLabelsStore();
    this.hiddenAccountsStore = new HiddenAccountsStore();
    this.priceStore = new PriceStore();
    // Cached prices paint immediately; whether to keep refreshing them is
    // decided by wireDataLifecycle, once the stored settings are in.
    void this.priceStore.initialize();
    wireDataLifecycle(this);
  }
}

/**
 * Ties the polling loops to the state that justifies them.
 *
 * Both loops used to run unconditionally for the life of the document. A
 * side panel stays open for hours, so a locked wallet kept polling balances
 * every tick and CoinGecko every minute, for a screen showing nothing but
 * the password prompt. Prices additionally waited on the stored setting:
 * reading showBalanceAndPrice at construction time always read the `true`
 * default, so the fetch ran even with the setting off.
 */
export function wireDataLifecycle(store: Store) {
  const { lockStore, priceStore, qrlStore, settingsStore } = store;

  reaction(
    () => lockStore.isLocked,
    (isLocked) => {
      qrlStore.setPollingAllowed(!isLocked);
      // Unlocking lands on a screen that shows balances, so refresh once
      // straight away, without waiting out a whole interval. Before the
      // provider exists, initialization does that itself.
      if (!isLocked && qrlStore.qrlInstance) {
        void qrlStore.pollBalancesAndConnection();
      }
    },
    { fireImmediately: true },
  );

  return settingsStore.whenSettingsLoaded().then(() => {
    reaction(
      () => settingsStore.showBalanceAndPrice && !lockStore.isLocked,
      (shouldRefresh) => {
        priceStore.setRefreshEnabled(shouldRefresh);
        if (shouldRefresh && priceStore.isCacheStale) {
          void priceStore.fetchPrices();
        }
      },
      { fireImmediately: true },
    );
  });
}

export type StoreType = InstanceType<typeof Store>;
export const store = new Store();
const StoreContext = createContext(store);
export const useStore = () => useContext(StoreContext);
export const StoreProvider = StoreContext.Provider;
