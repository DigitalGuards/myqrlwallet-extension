import StorageUtil from "@/utilities/storageUtil";
import {
  action,
  computed,
  makeAutoObservable,
  observable,
  runInAction,
} from "mobx";

const COINGECKO_API_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=quantum-resistant-ledger&vs_currencies=usd,eur,pln,gbp,chf,jpy&include_24hr_change=true";

const REFRESH_INTERVAL_MS = 60_000;
const CACHE_MAX_AGE_MS = 10 * 60_000;

class PriceStore {
  prices: Record<string, number> = {};
  change24h: Record<string, number> = {};
  lastUpdated = 0;
  isLoading = false;
  hasError = false;

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    makeAutoObservable(this, {
      prices: observable,
      change24h: observable,
      lastUpdated: observable,
      isLoading: observable,
      hasError: observable,
      getPrice: computed,
      isCacheStale: computed,
      startAutoRefresh: action.bound,
      stopAutoRefresh: action.bound,
      setRefreshEnabled: action.bound,
      fetchPrices: action.bound,
    });
  }

  get getPrice(): (currency: string) => number {
    return (currency: string) => this.prices[currency.toLowerCase()] ?? 0;
  }

  /** True while the auto-refresh interval is armed. */
  get isRefreshing(): boolean {
    return this.refreshInterval !== null;
  }

  get isCacheStale(): boolean {
    return Date.now() - this.lastUpdated > CACHE_MAX_AGE_MS;
  }

  /**
   * Loads the cached prices so the first paint has numbers.
   *
   * Refreshing is a separate decision (setRefreshEnabled): it depends on
   * the stored "show balance and price" setting, which loads
   * asynchronously, and on the wallet being unlocked.
   */
  async initialize(showBalanceAndPrice = false) {
    // Load cached prices first for instant display
    const cached = await StorageUtil.getPriceCache();
    if (cached) {
      runInAction(() => {
        this.prices = cached.prices;
        this.change24h = cached.change24h;
        this.lastUpdated = cached.timestamp;
      });
    }

    if (showBalanceAndPrice) {
      this.setRefreshEnabled(true);
      await this.fetchPrices();
    }
  }

  /**
   * Starts or stops the price poll. Disabled means no network call at all:
   * the setting is off, or the wallet is locked and nobody is looking.
   */
  setRefreshEnabled(enabled: boolean) {
    if (!enabled) {
      this.stopAutoRefresh();
      return;
    }
    if (this.refreshInterval) return;
    this.startAutoRefresh();
  }

  async fetchPrices() {
    this.isLoading = true;
    this.hasError = false;

    try {
      const response = await fetch(COINGECKO_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const qrlData = data["quantum-resistant-ledger"];
      if (!qrlData) throw new Error("No QRL data in response");

      const prices: Record<string, number> = {};
      const change24h: Record<string, number> = {};

      for (const [key, value] of Object.entries(qrlData)) {
        if (key.endsWith("_24h_change")) {
          const currency = key.replace("_24h_change", "");
          change24h[currency] = value as number;
        } else {
          prices[key] = value as number;
        }
      }

      const now = Date.now();
      runInAction(() => {
        this.prices = prices;
        this.change24h = change24h;
        this.lastUpdated = now;
        this.hasError = false;
      });

      await StorageUtil.setPriceCache({
        prices,
        change24h,
        timestamp: now,
      });
    } catch (error) {
      console.error("Failed to fetch QRL price:", error);
      runInAction(() => {
        this.hasError = true;
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      this.fetchPrices();
    }, REFRESH_INTERVAL_MS);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  getChange24h(currency: string): number {
    return this.change24h[currency.toLowerCase()] ?? 0;
  }
}

export default PriceStore;
