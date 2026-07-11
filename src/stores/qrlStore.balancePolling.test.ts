import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetBalance, mockIsListening } = vi.hoisted(() => ({
  mockGetBalance: vi.fn<any>().mockResolvedValue(BigInt(0)),
  mockIsListening: vi.fn<any>().mockResolvedValue(true),
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
    getAllAccounts: vi.fn<any>().mockResolvedValue([]),
    getAllBlockChains: vi.fn<any>().mockResolvedValue([]),
    getActiveBlockChain: vi.fn<any>().mockResolvedValue(""),
    setActiveBlockChain: vi.fn<any>().mockResolvedValue(undefined),
    getActiveAccount: vi.fn<any>().mockResolvedValue(""),
    setActiveAccount: vi.fn<any>().mockResolvedValue(undefined),
    clearActiveAccount: vi.fn<any>().mockResolvedValue(undefined),
    setAllAccounts: vi.fn<any>().mockResolvedValue(undefined),
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

  it("skips poll ticks while the document is hidden", async () => {
    const store = new QrlStore();
    await flush();
    const calls = mockGetBalance.mock.calls.length;

    const hiddenSpy = vi
      .spyOn(document, "hidden", "get")
      .mockReturnValue(true);
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
