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
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        "quantum-resistant-ledger": { usd: 1.3, usd_24h_change: 4.0 },
      }),
    });

    const store = new PriceStore();
    await store.initialize(true);

    // Should have loaded cache first, then fetched
    expect(mockGetPriceCache).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("should not fetch prices when showBalanceAndPrice is false", async () => {
    const store = new PriceStore();
    await store.initialize(false);

    expect(mockGetPriceCache).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should still load cache even when showBalanceAndPrice is false", async () => {
    const cached = {
      prices: { usd: 1.2 },
      change24h: { usd: 3.0 },
      timestamp: Date.now(),
    };
    mockGetPriceCache.mockResolvedValue(cached);

    const store = new PriceStore();
    await store.initialize(false);

    expect(store.prices).toEqual({ usd: 1.2 });
    expect(store.change24h).toEqual({ usd: 3.0 });
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
});
