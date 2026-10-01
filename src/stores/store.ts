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
    this.disposeDataLifecycle = wireDataLifecycle(this);
  }

  /** Tears down the lifecycle reactions. Held so a test (or a future
   *  multi-store surface) can dispose them; the singleton below lives as
   *  long as its document. */
  disposeDataLifecycle: () => void;
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
  const disposers: Array<() => void> = [];
  let disposed = false;

  disposers.push(
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
    ),
  );

  // The backoff recovers on its own clock, so a node that came back could
  // sit unnoticed behind the remaining interval. A side panel stays open
  // for hours, which is exactly where that was felt. Anything suggesting
  // the answer just changed re-probes at once; the automatic schedule is
  // untouched and still the primary path.
  if (typeof window !== "undefined") {
    const probeNow = () => {
      void qrlStore.probeConnectionNow();
    };
    const probeIfUnreachable = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (qrlStore.qrlConnection.isConnected) return;
      probeNow();
    };
    window.addEventListener("online", probeNow);
    window.addEventListener("focus", probeIfUnreachable);
    disposers.push(() => {
      window.removeEventListener("online", probeNow);
      window.removeEventListener("focus", probeIfUnreachable);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", probeIfUnreachable);
      disposers.push(() => {
        document.removeEventListener("visibilitychange", probeIfUnreachable);
      });
    }
  }

  // The price reaction waits on storage, so it is armed asynchronously. A
  // failed settings load must not take the wiring down with it: the load
  // resolves with defaults and this still runs.
  const priceWiring = settingsStore
    .whenSettingsLoaded()
    .then(() => {
      if (disposed) return;
      disposers.push(
        reaction(
          () => settingsStore.showBalanceAndPrice && !lockStore.isLocked,
          (shouldRefresh) => {
            // setRefreshEnabled owns the "refresh now or wait for the
            // tick" decision, so this wiring and the settings toggle
            // cannot arrive at different answers.
            priceStore.setRefreshEnabled(shouldRefresh);
          },
          { fireImmediately: true },
        ),
      );
    })
    .catch((error: unknown) => {
      console.error("Failed to wire the price refresh:", error);
    });

  const dispose = () => {
    disposed = true;
    while (disposers.length > 0) disposers.pop()?.();
  };
  // The promise is exposed for tests that need to await the asynchronous
  // half; production code only ever needs the disposer.
  dispose.priceWiring = priceWiring;
  return dispose;
}

export type StoreType = InstanceType<typeof Store>;
export const store = new Store();
const StoreContext = createContext(store);
export const useStore = () => useContext(StoreContext);
export const StoreProvider = StoreContext.Provider;
