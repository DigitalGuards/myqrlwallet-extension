import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetPriceCache, mockSetPriceCache } = vi.hoisted(() => ({
  mockGetPriceCache: vi.fn().mockResolvedValue(null),
  mockSetPriceCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getPriceCache: (...args: any[]) => mockGetPriceCache(...args),
    setPriceCache: (...args: any[]) => mockSetPriceCache(...args),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

const COINGECKO_HOST = "api.coingecko.com";

/** Answers the CoinGecko call and lets every other URL fail. */
const mockCoinGecko = (qrlData: Record<string, number>) => {
  mockFetch.mockImplementation(async (url: string) =>
    String(url).includes(COINGECKO_HOST)
      ? {
          ok: true,
          json: async () => ({ "quantum-resistant-ledger": qrlData }),
        }
      : { ok: false, status: 404 },
  );
};

/** Refuses the CoinGecko call the way its CDN does, and answers the
 *  explorer fallback. */
const mockCoinGeckoBlocked = (overview: unknown) => {
  mockFetch.mockImplementation(async (url: string) =>
    String(url).includes(COINGECKO_HOST)
      ? { ok: false, status: 403 }
      : { ok: true, json: async () => overview },
  );
};

describe("PriceStore", () => {
  let PriceStore: typeof import("@/stores/priceStore").default;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetPriceCache.mockResolvedValue(null);
    mockFetch.mockReset();
    const module = await import("@/stores/priceStore");
    PriceStore = module.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with default state", () => {
    const store = new PriceStore();
    expect(store.prices).toEqual({});
    expect(store.change24h).toEqual({});
    expect(store.lastUpdated).toBe(0);
    expect(store.isLoading).toBe(false);
    expect(store.hasError).toBe(false);
  });

  it("should return 0 for unknown currency via getPrice", () => {
    const store = new PriceStore();
    expect(store.getPrice("usd")).toBe(0);
    expect(store.getPrice("UNKNOWN")).toBe(0);
  });

  it("should return price for known currency (case-insensitive)", () => {
    const store = new PriceStore();
    store.prices = { usd: 1.5, eur: 1.3 };
    expect(store.getPrice("usd")).toBe(1.5);
    expect(store.getPrice("USD")).toBe(1.5);
    expect(store.getPrice("eur")).toBe(1.3);
  });

  it("should return 0 for unknown currency via getChange24h", () => {
    const store = new PriceStore();
    expect(store.getChange24h("usd")).toBe(0);
  });

  it("should return change24h for known currency", () => {
    const store = new PriceStore();
    store.change24h = { usd: 2.5 };
    expect(store.getChange24h("usd")).toBe(2.5);
    expect(store.getChange24h("USD")).toBe(2.5);
  });

  it("should report cache as stale when lastUpdated is 0", () => {
    const store = new PriceStore();
    expect(store.isCacheStale).toBe(true);
  });

  it("should report cache as not stale when recently updated", () => {
    const store = new PriceStore();
    store.lastUpdated = Date.now();
    expect(store.isCacheStale).toBe(false);
  });

  // ── initialize ──

  it("should load cached prices on initialize", async () => {
    const cached = {
      prices: { usd: 1.2 },
      change24h: { usd: 3.1 },
      timestamp: Date.now() - 1000,
    };
    mockGetPriceCache.mockResolvedValue(cached);
    mockCoinGecko({ usd: 1.3, usd_24h_change: 4.0 });

    const store = new PriceStore();
    await store.initialize(true);

    expect(mockGetPriceCache).toHaveBeenCalled();
    expect(store.getPrice("usd")).toBe(1.2);
    expect(store.isRefreshing).toBe(true);
    // The cached quote is a second old, so there is nothing to refresh yet.
    // initialize goes through setRefreshEnabled like every other caller.
    expect(mockFetch).not.toHaveBeenCalled();
    store.setRefreshEnabled(false);
  });

  it("refreshes on initialize when the cached prices are stale", async () => {
    mockGetPriceCache.mockResolvedValue({
      prices: { usd: 1.2 },
      change24h: { usd: 3.1 },
      timestamp: Date.now() - 20 * 60_000,
    });
    mockCoinGecko({ usd: 1.3, usd_24h_change: 4.0 });

    const store = new PriceStore();
    await store.initialize(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(store.getPrice("usd")).toBe(1.3);
    store.setRefreshEnabled(false);
  });

  it("should not fetch prices when showBalanceAndPrice is false", async () => {
    const store = new PriceStore();
    await store.initialize(false);

    expect(mockGetPriceCache).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should still load cache even when showBalanceAndPrice is false", async () => {
    const cachedAt = Date.now();
    const cached = {
      prices: { usd: 1.2 },
      change24h: { usd: 3.0 },
      timestamp: cachedAt,
    };
    mockGetPriceCache.mockResolvedValue(cached);

    const store = new PriceStore();
    await store.initialize(false);

    expect(store.prices).toEqual({ usd: 1.2 });
    expect(store.change24h).toEqual({ usd: 3.0 });
    // A cache from an older build carries one timestamp; every quote in it
    // is dated to that so the per-currency window still has something to
    // measure against.
    expect(store.updatedAt).toEqual({ usd: cachedAt });
  });

  it("keeps the per-currency stamps a newer cache carries", async () => {
    const now = Date.now();
    mockGetPriceCache.mockResolvedValue({
      prices: { usd: 1.2, eur: 1.1 },
      change24h: {},
      updatedAt: { usd: now, eur: now - 5 * 60_000 },
      timestamp: now,
    });

    const store = new PriceStore();
    await store.initialize(false);

    expect(store.updatedAt).toEqual({ usd: now, eur: now - 5 * 60_000 });
  });

  it("loads the cache without refreshing when called with no argument", async () => {
    const cached = {
      prices: { usd: 1.2 },
      change24h: { usd: 3.0 },
      timestamp: Date.now(),
    };
    mockGetPriceCache.mockResolvedValue(cached);

    const store = new PriceStore();
    await store.initialize();

    expect(store.prices).toEqual({ usd: 1.2 });
    // Refreshing is decided separately, after the stored setting loads.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(store.isRefreshing).toBe(false);
  });

  it("keeps a fresher fetch when the cache read lands after it", async () => {
    let releaseCache: (value: unknown) => void = () => {};
    mockGetPriceCache.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseCache = resolve;
      }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        "quantum-resistant-ledger": { usd: 9.99, usd_24h_change: 1 },
      }),
    });

    const store = new PriceStore();
    const initializing = store.initialize();
    // Storage is slower than a warm network call here, which is exactly
    // the order that used to put an hours-old cached price back on screen.
    await store.fetchPrices();
    expect(store.getPrice("usd")).toBe(9.99);

    releaseCache({
      prices: { usd: 1.11 },
      change24h: { usd: 0 },
      timestamp: Date.now() - 600_000,
    });
    await initializing;

    expect(store.getPrice("usd")).toBe(9.99);
  });

  // ── setRefreshEnabled ──

  it("arms and disarms the refresh interval", async () => {
    mockCoinGecko({ usd: 1.3, usd_24h_change: 4.0 });
    const store = new PriceStore();

    store.setRefreshEnabled(true);
    expect(store.isRefreshing).toBe(true);

    // Arming refreshes at once, then once per interval.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    store.setRefreshEnabled(false);
    expect(store.isRefreshing).toBe(false);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes as soon as the poll is armed with nothing on screen", async () => {
    mockCoinGecko({ usd: 1.3, usd_24h_change: 4.0 });
    const store = new PriceStore();

    store.setRefreshEnabled(true);
    await vi.advanceTimersByTimeAsync(0);

    // The regression: the poll used to arm an interval and nothing else,
    // so the fiat line stayed blank for a minute, and the action popup
    // rarely lives that long.
    expect(store.getPrice("usd")).toBe(1.3);
    store.setRefreshEnabled(false);
  });

  it("waits for the tick when the prices on hand are still fresh", async () => {
    mockCoinGecko({ usd: 1.3 });
    const store = new PriceStore();
    store.lastUpdated = Date.now();

    store.setRefreshEnabled(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).not.toHaveBeenCalled();
    store.setRefreshEnabled(false);
  });

  it("does not restart the interval when already armed", async () => {
    mockCoinGecko({ usd: 1.3 });
    const store = new PriceStore();
    store.setRefreshEnabled(true);
    const first = store.isRefreshing;
    store.setRefreshEnabled(true);

    expect(first).toBe(true);
    expect(store.isRefreshing).toBe(true);
    store.setRefreshEnabled(false);
    await vi.advanceTimersByTimeAsync(0);
  });

  // ── fetchPrices ──

  it("should fetch prices from CoinGecko and update state", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        "quantum-resistant-ledger": {
          usd: 1.5,
          eur: 1.3,
          usd_24h_change: 2.5,
          eur_24h_change: 2.1,
        },
      }),
    });

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.prices).toEqual({ usd: 1.5, eur: 1.3 });
    expect(store.change24h).toEqual({ usd: 2.5, eur: 2.1 });
    expect(store.lastUpdated).toBeGreaterThan(0);
    expect(store.isLoading).toBe(false);
    expect(store.hasError).toBe(false);
    expect(mockSetPriceCache).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: { usd: 1.5, eur: 1.3 },
        change24h: { usd: 2.5, eur: 2.1 },
      }),
    );
  });

  it("should set hasError on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.hasError).toBe(true);
    expect(store.isLoading).toBe(false);
    consoleSpy.mockRestore();
  });

  it("should set hasError on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.hasError).toBe(true);
    expect(store.isLoading).toBe(false);
    consoleSpy.mockRestore();
  });

  it("should set hasError when response has no QRL data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.hasError).toBe(true);
    consoleSpy.mockRestore();
  });

  // ── startAutoRefresh / stopAutoRefresh ──

  it("should start auto-refresh and call fetchPrices on interval", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        "quantum-resistant-ledger": { usd: 1.5 },
      }),
    });

    const store = new PriceStore();
    store.startAutoRefresh();

    // Advance by 60 seconds
    vi.advanceTimersByTime(60_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalled();

    store.stopAutoRefresh();
  });

  it("should stop auto-refresh and clear interval", () => {
    const store = new PriceStore();
    store.startAutoRefresh();
    store.stopAutoRefresh();

    // Advance past interval - should not trigger fetch
    mockFetch.mockClear();
    vi.advanceTimersByTime(120_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should stop previous refresh before starting new one", () => {
    const store = new PriceStore();
    store.startAutoRefresh();
    store.startAutoRefresh();
    store.stopAutoRefresh();

    // Should be fully stopped
    mockFetch.mockClear();
    vi.advanceTimersByTime(120_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stopAutoRefresh should be a no-op when not refreshing", () => {
    const store = new PriceStore();
    // Should not throw
    store.stopAutoRefresh();
  });

  // ── fallback quote source ──

  it("falls back to the explorer when CoinGecko refuses the request", async () => {
    // CoinGecko's keyless endpoint answers 403 for whole networks, which
    // used to leave the Home card with no fiat line at all.
    mockCoinGeckoBlocked({ currentPrice: 0.67, priceChange24h: -0.47 });

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.getPrice("USD")).toBe(0.67);
    expect(store.getChange24h("USD")).toBe(-0.47);
    expect(store.hasError).toBe(false);
    expect(mockSetPriceCache).toHaveBeenCalledWith(
      expect.objectContaining({ prices: { usd: 0.67 } }),
    );
  });

  it("keeps a currency the fallback does not carry while its own quote is fresh", async () => {
    mockCoinGecko({ usd: 1.5, eur: 1.3, eur_24h_change: 2.1 });
    const store = new PriceStore();
    await store.fetchPrices();

    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 1 });
    await store.fetchPrices();

    expect(store.getPrice("usd")).toBe(2);
    // The explorer quotes USD only; blanking a euro quote from a minute
    // ago would empty the fiat line for everyone off dollars.
    expect(store.getPrice("eur")).toBe(1.3);
    expect(store.getChange24h("eur")).toBe(2.1);
  });

  it("drops a carried-over currency once its own quote ages out", async () => {
    mockCoinGecko({ usd: 1.5, eur: 1.3, eur_24h_change: 2.1 });
    const store = new PriceStore();
    await store.fetchPrices();

    // CoinGecko stays blocked past the cache window. Carrying the euro
    // quote further and restamping it as current would present a quote
    // hours or days old as the live price.
    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 1 });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await store.fetchPrices();

    expect(store.getPrice("usd")).toBe(2);
    expect(store.getPrice("eur")).toBe(0);
    expect(store.change24h.eur).toBeUndefined();
  });

  it("quotes a currency with nothing of its own in dollars", async () => {
    mockCoinGecko({ usd: 1.5, eur: 1.3, eur_24h_change: 2.1 });
    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.quoteFor("EUR")).toEqual({
      price: 1.3,
      currency: "EUR",
      change24h: 2.1,
    });

    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 1 });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await store.fetchPrices();

    // The fallback carries dollars alone, so a euro user sees the dollar
    // estimate with the dollar symbol, so the fiat line stays on screen.
    expect(store.quoteFor("EUR")).toEqual({
      price: 2,
      currency: "USD",
      change24h: 1,
    });
  });

  it("restores the user's currency as soon as CoinGecko answers again", async () => {
    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 1 });
    const store = new PriceStore();
    await store.fetchPrices();
    expect(store.quoteFor("EUR").currency).toBe("USD");

    mockCoinGecko({ usd: 1.5, eur: 1.4, eur_24h_change: 2.2 });
    await store.fetchPrices();

    expect(store.quoteFor("EUR")).toEqual({
      price: 1.4,
      currency: "EUR",
      change24h: 2.2,
    });
  });

  it("reports no quote at all when nothing has ever been fetched", () => {
    const store = new PriceStore();
    expect(store.quoteFor("EUR")).toEqual({
      price: 0,
      currency: "EUR",
      change24h: 0,
    });
  });

  it("treats an explorer 24h change of exactly 0 as missing", async () => {
    // The explorer reports 0 when it has no 24h baseline, which means the
    // trend data is simply absent.
    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 0 });
    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.getPrice("usd")).toBe(2);
    expect(store.change24h.usd).toBeUndefined();
  });

  it("gives both requests a timeout so a hung socket cannot wedge the poll", async () => {
    mockCoinGeckoBlocked({ currentPrice: 2, priceChange24h: 1 });
    const store = new PriceStore();
    await store.fetchPrices();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mockFetch.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reports an error only when both sources fail", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const store = new PriceStore();
    await store.fetchPrices();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(store.hasError).toBe(true);
    consoleSpy.mockRestore();
  });

  it("ignores an explorer answer with no usable price", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCoinGeckoBlocked({ currentPrice: 0 });

    const store = new PriceStore();
    await store.fetchPrices();

    expect(store.getPrice("usd")).toBe(0);
    expect(store.hasError).toBe(true);
    consoleSpy.mockRestore();
  });

  it("does not start a second request while one is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    mockFetch.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          release = resolve;
        }),
    );

    const store = new PriceStore();
    const first = store.fetchPrices();
    void store.fetchPrices();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    release({
      ok: true,
      json: async () => ({ "quantum-resistant-ledger": { usd: 4 } }),
    });
    await first;
    expect(store.getPrice("usd")).toBe(4);
  });
});
