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

/**
 * Fallback quote source.
 *
 * CoinGecko's keyless endpoint is not something a wallet can rely on: its
 * CDN answers 403 "Request blocked" for entire networks and the demo tier
 * rate-limits the rest, and a browser has no way around either. The
 * explorer carries the same CoinGecko market data, refreshed server side,
 * and is already a host this wallet talks to for history, tokens and NFTs.
 * It quotes USD only, which still beats a Home card with no fiat line at
 * all. The web wallet reads its price from the same endpoint.
 */
const EXPLORER_PRICE_URL = "https://zondscan.com/api/overview";

const REFRESH_INTERVAL_MS = 60_000;
const CACHE_MAX_AGE_MS = 10 * 60_000;

type PriceQuotes = {
  prices: Record<string, number>;
  change24h: Record<string, number>;
};

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
    runInAction(() => {
      // Storage is slower than a warm network call, so a live fetch armed
      // alongside this can land first. Only older data is replaced, which
      // keeps the cache read from putting stale prices back on screen.
      if (!cached || cached.timestamp <= this.lastUpdated) return;
      this.prices = cached.prices;
      this.change24h = cached.change24h;
      this.lastUpdated = cached.timestamp;
    });

    if (showBalanceAndPrice) {
      this.setRefreshEnabled(true);
      await this.fetchPrices();
    }
  }

  /**
   * Starts or stops the price poll. Disabled means no network call at all:
   * the setting is off, or the wallet is locked and nobody is looking.
   *
   * This is the single place that decides "refresh now or wait for the
   * tick", so the settings toggle and the lifecycle wiring cannot drift
   * apart. Arming the interval alone used to leave a surface without a
   * price for a whole minute, and the action popup rarely lives that long.
   */
  setRefreshEnabled(enabled: boolean) {
    if (!enabled) {
      this.stopAutoRefresh();
      return;
    }
    if (this.isCacheStale) void this.fetchPrices();
    if (this.refreshInterval) return;
    this.startAutoRefresh();
  }

  /** Reads the multi-currency quotes from CoinGecko. */
  async #fetchFromCoinGecko(): Promise<PriceQuotes> {
    const response = await fetch(COINGECKO_API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data: unknown = await response.json();
    const qrlData = (data as Record<string, unknown> | null)?.[
      "quantum-resistant-ledger"
    ];
    if (!qrlData || typeof qrlData !== "object") {
      throw new Error("No QRL data in response");
    }

    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};

    for (const [key, value] of Object.entries(qrlData)) {
      if (typeof value !== "number") continue;
      if (key.endsWith("_24h_change")) {
        change24h[key.replace("_24h_change", "")] = value;
      } else {
        prices[key] = value;
      }
    }

    if (Object.keys(prices).length === 0) {
      throw new Error("No prices in response");
    }
    return { prices, change24h };
  }

  /** Reads the USD quote the explorer already refreshes server side. */
  async #fetchFromExplorer(): Promise<PriceQuotes> {
    const response = await fetch(EXPLORER_PRICE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      currentPrice?: unknown;
      priceChange24h?: unknown;
    } | null;
    const price = data?.currentPrice;
    if (typeof price !== "number" || !(price > 0)) {
      throw new Error("No usable price in the explorer overview");
    }
    const change = data?.priceChange24h;
    return {
      prices: { usd: price },
      change24h: typeof change === "number" ? { usd: change } : {},
    };
  }

  async #loadQuotes(): Promise<PriceQuotes> {
    try {
      return await this.#fetchFromCoinGecko();
    } catch (coinGeckoError) {
      try {
        return await this.#fetchFromExplorer();
      } catch (explorerError) {
        throw new Error(
          `CoinGecko: ${String(coinGeckoError)}; explorer: ${String(explorerError)}`,
        );
      }
    }
  }

  async fetchPrices() {
    // A tick landing on top of a slow request would race two writes into
    // the same observables and double the outbound traffic.
    if (this.isLoading) return;
    this.isLoading = true;
    this.hasError = false;

    try {
      const quotes = await this.#loadQuotes();
      // Merged so a source that carries fewer currencies than the last one
      // (the explorer quotes USD only) does not blank the rest.
      const prices = { ...this.prices, ...quotes.prices };
      const change24h = { ...this.change24h, ...quotes.change24h };
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
      void this.fetchPrices();
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
