import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetBalance, mockIsListening } = vi.hoisted(() => ({
  mockGetBalance: vi.fn().mockResolvedValue(BigInt(0)),
  mockIsListening: vi.fn().mockResolvedValue(true),
}));

vi.mock("@theqrl/web3", () => {
  class MockWeb3 {
    static providers = { HttpProvider: class {} };
    qrl = { getBalance: mockGetBalance, net: { isListening: mockIsListening } };
    constructor(_opts: unknown) {}
  }
  return {
    __esModule: true,
    default: MockWeb3,
    utils: { fromPlanck: (v: bigint) => (Number(v) / 1e18).toString() },
  };
});

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAllAccounts: vi.fn().mockResolvedValue([]),
    getAllBlockChains: vi.fn().mockResolvedValue([]),
    getActiveBlockChain: vi.fn().mockResolvedValue(""),
    setActiveBlockChain: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn().mockResolvedValue(""),
    setActiveAccount: vi.fn().mockResolvedValue(undefined),
    clearActiveAccount: vi.fn().mockResolvedValue(undefined),
    setAllAccounts: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: mockStorage,
}));

import QrlStore, { BALANCE_POLL_INTERVAL_MS } from "./qrlStore";

const ACCOUNT = "Q79b662ce3d663643df4454a8ba3f532c0de6887f";

const flush = async () => {
  // Drain the fire-and-forget initializeBlockchain chain.
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("QrlStore balance polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetBalance.mockReset().mockResolvedValue(BigInt(1e18));
    mockStorage.getAllAccounts.mockResolvedValue([ACCOUNT]);
    mockStorage.getActiveAccount.mockResolvedValue(ACCOUNT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-fetches balances on the poll interval without loading flicker", async () => {
    const store = new QrlStore();
    await flush();
    expect(store.qrlAccounts.accounts[0]?.accountAddress).toBe(ACCOUNT);
    const callsAfterInit = mockGetBalance.mock.calls.length;

    // Funds arrive while the popup stays open (e.g. an internal payout).
    mockGetBalance.mockResolvedValue(BigInt(44e18));
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();

    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(callsAfterInit);
    expect(store.qrlAccounts.accounts[0]?.accountBalance).toContain("44");
    expect(store.qrlAccounts.isLoading).toBe(false);
  });

  it("keeps the last known balances when a poll tick fails", async () => {
    const store = new QrlStore();
    await flush();
    const before = store.qrlAccounts.accounts[0]?.accountBalance;
    expect(before).toBeTruthy();

    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();

    expect(store.qrlAccounts.accounts[0]?.accountBalance).toBe(before);
  });

  it("stopBalancePolling halts the interval", async () => {
    const store = new QrlStore();
    await flush();
    store.stopBalancePolling();
    const calls = mockGetBalance.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS * 3);
    await flush();

    expect(mockGetBalance.mock.calls.length).toBe(calls);
  });

  it.each(["foreground", "quiet"])(
    "discards delayed old-network %s balances",
    async (mode) => {
      const store = new QrlStore();
      await flush();
      store.stopBalancePolling();
      let finishOld!: (value: bigint) => void;
      const oldBalance = new Promise<bigint>((resolve) => {
        finishOld = resolve;
      });
      store.qrlInstance = { getBalance: vi.fn(() => oldBalance) } as never;
      const refresh = () =>
        mode === "foreground"
          ? store.fetchAccounts()
          : store.refreshBalancesQuietly();
      const first = refresh();
      await flush();
      store.qrlConnection.blockchain = {
        ...store.qrlConnection.blockchain,
        chainId: "0x2",
      };
      store.qrlInstance = {
        getBalance: vi.fn(async () => 25n * 10n ** 18n),
      } as never;
      await refresh();
      finishOld(99n * 10n ** 18n);
      await first;
      expect(store.qrlAccounts.accounts[0]?.accountBalance).toBe("25.0 Quanta");
      expect(store.qrlAccounts.isLoading).toBe(false);
    },
  );

  it("keeps the newest same-network refresh and avoids background loading interference", async () => {
    const store = new QrlStore();
    await flush();
    store.stopBalancePolling();
    let finishOld!: (value: bigint) => void;
    const oldBalance = new Promise<bigint>((resolve) => {
      finishOld = resolve;
    });
    const getBalance = vi
      .fn()
      .mockReturnValueOnce(oldBalance)
      .mockResolvedValue(25n * 10n ** 18n);
    store.qrlInstance = { getBalance } as never;
    const first = store.fetchAccounts();
    await flush();
    await store.refreshBalancesQuietly();
    expect(getBalance).toHaveBeenCalledTimes(1);
    await store.fetchAccounts();
    finishOld(99n * 10n ** 18n);
    await first;
    expect(store.qrlAccounts.accounts[0]?.accountBalance).toBe("25.0 Quanta");
    expect(store.qrlAccounts.isLoading).toBe(false);
  });

  it("skips poll ticks while the document is hidden", async () => {
    const store = new QrlStore();
    await flush();
    const calls = mockGetBalance.mock.calls.length;

    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS * 2);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBe(calls);

    hiddenSpy.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(calls);
    store.stopBalancePolling();
  });
});
