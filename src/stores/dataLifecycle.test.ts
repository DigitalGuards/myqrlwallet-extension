import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireDataLifecycle } from "./store";

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
}) => {
  const lockStore = observable({ isLocked: options?.isLocked ?? true });
  const settingsStore = observable(
    {
      showBalanceAndPrice: options?.showBalanceAndPrice ?? true,
      whenSettingsLoaded: () => options?.settingsLoad ?? Promise.resolve(),
    },
    { whenSettingsLoaded: false },
  );
  const qrlStore = {
    qrlInstance: {} as unknown,
    setPollingAllowed: vi.fn(),
    pollBalancesAndConnection: vi.fn().mockResolvedValue(undefined),
  };
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
    wire: () => wireDataLifecycle(stores as unknown as LifecycleStores),
    lockStore,
    settingsStore,
    qrlStore,
    priceStore,
  };
};

describe("data lifecycle wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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
    let releaseSettings!: () => void;
    const settingsLoad = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
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
    releaseSettings();
    await wired;

    expect(priceStore.setRefreshEnabled).toHaveBeenCalledWith(false);
    expect(priceStore.fetchPrices).not.toHaveBeenCalled();
  });

  it("refreshes prices once settings confirm the setting is on", async () => {
    const { wire, priceStore } = makeStores({
      isLocked: false,
      showBalanceAndPrice: true,
      isCacheStale: true,
    });
    await wire();

    expect(priceStore.setRefreshEnabled).toHaveBeenCalledWith(true);
    expect(priceStore.fetchPrices).toHaveBeenCalledTimes(1);
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
});
