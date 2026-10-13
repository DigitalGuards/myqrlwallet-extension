import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/test-utils/deferred";
import { wireDataLifecycle } from "./store";
import PriceStore from "./priceStore";
import TransactionHistoryStore from "./transactionHistoryStore";
import StorageUtil from "@/utilities/storageUtil";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";

/**
 * The balance poll and the price poll are tied to lock state, and the price
 * poll additionally to a setting that loads asynchronously. These exercise
 * that wiring against stand-ins for the four stores, so nothing here
 * depends on a provider, storage or the network.
 */

type LifecycleStores = Parameters<typeof wireDataLifecycle>[0];

const makeStores = (options?: {
  isLocked?: boolean;
  showBalanceAndPrice?: boolean;
  settingsLoad?: Promise<void>;
  isCacheStale?: boolean;
  isConnected?: boolean;
  areBalancesStale?: boolean;
}) => {
  const lockStore = observable({ isLocked: options?.isLocked ?? true });
  const settingsStore = observable(
    {
      showBalanceAndPrice: options?.showBalanceAndPrice ?? true,
      whenSettingsLoaded: () => options?.settingsLoad ?? Promise.resolve(),
    },
    { whenSettingsLoaded: false },
  );
  const qrlStore = observable(
    {
      qrlInstance: {},
      qrlConnection: {
        isConnected: options?.isConnected ?? false,
        areBalancesStale: options?.areBalancesStale ?? false,
      },
      setPollingAllowed: vi.fn(),
      pollBalancesAndConnection: vi.fn().mockResolvedValue(undefined),
      probeConnectionNow: vi
        .fn<LifecycleStores["qrlStore"]["probeConnectionNow"]>()
        .mockResolvedValue({ probed: true, isConnected: true }),
    },
    {
      setPollingAllowed: false,
      pollBalancesAndConnection: false,
      probeConnectionNow: false,
    },
  );
  const priceStore = {
    isCacheStale: options?.isCacheStale ?? false,
    setRefreshEnabled: vi.fn(),
    fetchPrices: vi.fn().mockResolvedValue(undefined),
  };
  const stores = {
    lockStore,
    settingsStore,
    qrlStore,
    priceStore,
  };
  return {
    stores,
    // Every wiring is registered for teardown: leaked reactions would keep
    // reacting to the next case's stores.
    wire: () => {
      const dispose = wireDataLifecycle(stores);
      activeDisposers.push(dispose);
      return dispose.priceWiring.then(() => dispose);
    },
    lockStore,
    settingsStore,
    qrlStore,
    priceStore,
  };
};

const activeDisposers: Array<() => void> = [];

describe("data lifecycle wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (activeDisposers.length > 0) activeDisposers.pop()?.();
    vi.useRealTimers();
  });

  it("keeps balance polling off while the wallet is locked", async () => {
    const { wire, qrlStore } = makeStores({ isLocked: true });
    await wire();

    expect(qrlStore.setPollingAllowed).toHaveBeenCalledWith(false);
    expect(qrlStore.pollBalancesAndConnection).not.toHaveBeenCalled();
  });

  it("starts polling with an immediate refresh on unlock and stops again on lock", async () => {
    const { wire, lockStore, qrlStore } = makeStores({ isLocked: true });
    await wire();
    qrlStore.setPollingAllowed.mockClear();

    runInAction(() => {
      lockStore.isLocked = false;
    });
    expect(qrlStore.setPollingAllowed).toHaveBeenLastCalledWith(true);
    // Unlocking lands on a balance screen, so it refreshes at once instead
    // of showing whatever was last fetched for a whole interval.
    expect(qrlStore.pollBalancesAndConnection).toHaveBeenCalledTimes(1);

    runInAction(() => {
      lockStore.isLocked = true;
    });
    expect(qrlStore.setPollingAllowed).toHaveBeenLastCalledWith(false);
    expect(qrlStore.pollBalancesAndConnection).toHaveBeenCalledTimes(1);
  });

  it("never fetches prices when the setting is off, even before settings load", async () => {
    const { promise: settingsLoad, resolve: releaseSettings } =
      deferred<undefined>();
    const { wire, settingsStore, priceStore } = makeStores({
      isLocked: false,
      // The store default is true; the stored value says otherwise and
      // arrives later. Nothing may act on the default in the meantime.
      showBalanceAndPrice: true,
      settingsLoad,
      isCacheStale: true,
    });
    const wired = wire();

    expect(priceStore.setRefreshEnabled).not.toHaveBeenCalled();
    expect(priceStore.fetchPrices).not.toHaveBeenCalled();

    runInAction(() => {
      settingsStore.showBalanceAndPrice = false;
    });
    releaseSettings(undefined);
    await wired;

    expect(priceStore.setRefreshEnabled).toHaveBeenCalledWith(false);
    expect(priceStore.fetchPrices).not.toHaveBeenCalled();
  });

  it("arms the price poll once settings confirm the setting is on", async () => {
    const { wire, priceStore } = makeStores({
      isLocked: false,
      showBalanceAndPrice: true,
      isCacheStale: true,
    });
    await wire();

    expect(priceStore.setRefreshEnabled).toHaveBeenCalledWith(true);
    // Whether arming also refreshes right now is the store's call, so the
    // toggle in Settings and this wiring cannot answer it differently.
    expect(priceStore.fetchPrices).not.toHaveBeenCalled();
  });

  it("stops the price poll while the wallet is locked and restarts it on unlock", async () => {
    const { wire, lockStore, priceStore } = makeStores({
      isLocked: false,
      showBalanceAndPrice: true,
    });
    await wire();
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);

    runInAction(() => {
      lockStore.isLocked = true;
    });
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(false);

    runInAction(() => {
      lockStore.isLocked = false;
    });
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);
  });

  it("reacts to the setting being turned off and on later", async () => {
    const { wire, settingsStore, priceStore } = makeStores({
      isLocked: false,
      showBalanceAndPrice: true,
    });
    await wire();

    runInAction(() => {
      settingsStore.showBalanceAndPrice = false;
    });
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(false);

    runInAction(() => {
      settingsStore.showBalanceAndPrice = true;
    });
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);
  });
  it("arms the price reaction even when the settings read failed", async () => {
    // A failed load resolves with the defaults, so the wiring below still
    // has to run: without it the price refresh is dead for the session.
    const { wire, priceStore } = makeStores({
      isLocked: false,
      showBalanceAndPrice: true,
      settingsLoad: Promise.resolve(),
      isCacheStale: true,
    });
    await wire();

    expect(priceStore.setRefreshEnabled).toHaveBeenCalledWith(true);
  });

  it("handles a rejected settings promise without an unhandled rejection", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { wire, qrlStore, priceStore } = makeStores({
      isLocked: false,
      settingsLoad: Promise.reject(new Error("storage unavailable")),
    });

    // The rejection is caught and logged; the lock half of the wiring is
    // unaffected and the promise settles, so nothing escapes.
    await expect(wire()).resolves.toBeTypeOf("function");
    expect(consoleError).toHaveBeenCalled();
    expect(qrlStore.setPollingAllowed).toHaveBeenCalledWith(true);
    expect(priceStore.setRefreshEnabled).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("stops reacting once disposed", async () => {
    const { wire, lockStore, qrlStore, priceStore } = makeStores({
      isLocked: true,
      showBalanceAndPrice: true,
    });
    const dispose = await wire();
    dispose();
    qrlStore.setPollingAllowed.mockClear();
    priceStore.setRefreshEnabled.mockClear();

    runInAction(() => {
      lockStore.isLocked = false;
    });

    expect(qrlStore.setPollingAllowed).not.toHaveBeenCalled();
    expect(priceStore.setRefreshEnabled).not.toHaveBeenCalled();
  });

  describe("connection recovery", () => {
    it("re-probes as soon as the browser is back online", async () => {
      const { wire, qrlStore } = makeStores({ isConnected: false });
      await wire();

      window.dispatchEvent(new Event("online"));

      expect(qrlStore.probeConnectionNow).toHaveBeenCalledTimes(1);
    });

    it("re-probes when a surface comes back to the front", async () => {
      const { wire, qrlStore } = makeStores({ isConnected: false });
      await wire();

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));

      expect(qrlStore.probeConnectionNow).toHaveBeenCalledTimes(2);
    });

    it("re-probes a connection that is up but serving stale balances", async () => {
      // A balance read that gave up while net_listening still answered
      // leaves a green dot over numbers nobody has confirmed. That state
      // recovered only on the automatic schedule.
      const { wire, qrlStore } = makeStores({
        isConnected: true,
        areBalancesStale: true,
      });
      await wire();

      window.dispatchEvent(new Event("focus"));

      expect(qrlStore.probeConnectionNow).toHaveBeenCalledTimes(1);
    });

    it("leaves a hidden surface alone", async () => {
      const { wire, qrlStore } = makeStores({ isConnected: false });
      await wire();
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));

      expect(qrlStore.probeConnectionNow).not.toHaveBeenCalled();
      hidden.mockRestore();
    });

    it("leaves a healthy connection alone when a surface is focused", async () => {
      const { wire, qrlStore } = makeStores({ isConnected: true });
      await wire();

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));

      expect(qrlStore.probeConnectionNow).not.toHaveBeenCalled();
    });

    it("stops listening once disposed", async () => {
      const { wire, qrlStore } = makeStores({ isConnected: false });
      const dispose = await wire();
      dispose();

      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));

      expect(qrlStore.probeConnectionNow).not.toHaveBeenCalled();
    });
  });
});

describe("store response and polling boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([null, [], "unavailable", { "quantum-resistant-ledger": [1, 2] }])(
    "uses the explorer fallback for a malformed CoinGecko record: %j",
    async (data) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json(data))
        .mockResolvedValueOnce(
          Response.json({ currentPrice: 2, priceChange24h: -3 }),
        );
      vi.stubGlobal("fetch", fetch);
      const persist = vi
        .spyOn(StorageUtil, "setPriceCache")
        .mockResolvedValue();
      const prices = new PriceStore();

      await prices.fetchPrices();

      expect(prices.prices).toEqual({ usd: 2 });
      expect(prices.change24h).toEqual({ usd: -3 });
      expect(prices.hasError).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({ prices: { usd: 2 } }),
      );
    },
  );

  it.each([null, [], "unavailable", { currentPrice: "2" }])(
    "retains quotes and storage when the fallback record is malformed: %j",
    async (data) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(new Response(null, { status: 503 }))
          .mockResolvedValueOnce(Response.json(data)),
      );
      const persist = vi
        .spyOn(StorageUtil, "setPriceCache")
        .mockResolvedValue();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const prices = new PriceStore();
      prices.prices = { usd: 1.5, eur: 1.2 };
      prices.change24h = { eur: 2 };
      prices.lastUpdated = 123;

      await prices.fetchPrices();

      expect(prices.prices).toEqual({ usd: 1.5, eur: 1.2 });
      expect(prices.change24h).toEqual({ eur: 2 });
      expect(prices.lastUpdated).toBe(123);
      expect(prices.hasError).toBe(true);
      expect(prices.isLoading).toBe(false);
      expect(persist).not.toHaveBeenCalled();
    },
  );

  it("reports a reconciliation rejection and continues the next polling tick", async () => {
    const error = new Error("history storage unavailable");
    const reconcile = vi
      .spyOn(TransactionHistoryStore.prototype, "reconcileReplacedTransactions")
      .mockRejectedValueOnce(error)
      .mockResolvedValue();
    const history = new TransactionHistoryStore();
    const pending: TransactionHistoryEntry = {
      id: "pending",
      from: `Q${"a".repeat(128)}`,
      to: `Q${"b".repeat(128)}`,
      amount: "1",
      tokenSymbol: "Quanta",
      tokenName: "Quanta",
      isZrc20Token: false,
      tokenContractAddress: "",
      tokenDecimals: 18,
      transactionHash: "0xpending",
      blockNumber: "",
      gasUsed: "",
      effectiveGasPrice: "",
      status: false,
      timestamp: 1,
      chainId: "0x1",
      pendingStatus: "pending",
    };
    history.transactions = [pending];
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const receipts = {
      getTransactionReceipt: vi
        .fn<() => Promise<undefined>>()
        .mockResolvedValue(undefined),
    };
    history.startPolling(pending.from, receipts);

    await vi.advanceTimersByTimeAsync(10000);

    expect(report).toHaveBeenCalledWith(
      "Failed to poll transaction history:",
      error,
    );
    expect(history.transactions).toEqual([pending]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(receipts.getTransactionReceipt).toHaveBeenCalledTimes(2);
    history.stopPolling();
    await vi.advanceTimersByTimeAsync(10000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
