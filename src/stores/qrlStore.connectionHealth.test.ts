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

// The v3 network assertion talks to the RPC over fetch; the connection
// probe is the subject here, so let it always agree.
vi.mock("@/configuration/releaseProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@/configuration/releaseProfile")
  >("@/configuration/releaseProfile");
  return { ...actual, assertV3Network: vi.fn().mockResolvedValue(undefined) };
});

import QrlStore, {
  BALANCE_POLL_INTERVAL_MS,
  CONNECTION_REPROBE_TICKS,
} from "./qrlStore";

const ACCOUNT = "Q79b662ce3d663643df4454a8ba3f532c0de6887f";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** A store past initialization, connected, with one account. */
const connectedStore = async () => {
  const store = new QrlStore();
  await flush();
  store.qrlConnection = { ...store.qrlConnection, isConnected: true };
  return store;
};

describe("QrlStore connection health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetBalance.mockReset().mockResolvedValue(BigInt(1e18));
    mockIsListening.mockReset().mockResolvedValue(true);
    mockStorage.getAllAccounts.mockResolvedValue([ACCOUNT]);
    mockStorage.getActiveAccount.mockResolvedValue(ACCOUNT);
    mockStorage.getActiveBlockChain.mockResolvedValue({
      chainId: "0x301825",
      chainName: "v3 Private",
      defaultRpcUrl: "http://rpc.invalid",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it("marks the chain disconnected and the balances stale when a refresh fails", async () => {
    const store = await connectedStore();
    const before = store.qrlAccounts.accounts[0]?.accountBalance;

    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockRejectedValue(new Error("rpc down"));
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();

    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlConnection.areBalancesStale).toBe(true);
    // The last known balances stay on screen, flagged as stale.
    expect(store.qrlAccounts.accounts[0]?.accountBalance).toBe(before);
    store.stopBalancePolling();
  });

  it("goes back to connected and current once the node recovers", async () => {
    const store = await connectedStore();

    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlConnection.areBalancesStale).toBe(true);

    mockGetBalance.mockResolvedValue(BigInt(7e18));
    mockIsListening.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();

    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.qrlConnection.areBalancesStale).toBe(false);
    expect(store.qrlAccounts.accounts[0]?.accountBalance).toContain("7");
    store.stopBalancePolling();
  });

  it("re-probes the node periodically while everything is healthy", async () => {
    const store = await connectedStore();
    const probesAfterInit = mockIsListening.mock.calls.length;

    // Healthy ticks do not probe every time.
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockIsListening.mock.calls.length).toBe(probesAfterInit);

    await vi.advanceTimersByTimeAsync(
      BALANCE_POLL_INTERVAL_MS * CONNECTION_REPROBE_TICKS,
    );
    await flush();
    expect(mockIsListening.mock.calls.length).toBeGreaterThan(probesAfterInit);
    store.stopBalancePolling();
  });

  it("does not flash the loading state on a background re-probe", async () => {
    const store = await connectedStore();
    store.stopBalancePolling();
    store.qrlConnection = { ...store.qrlConnection, isLoading: false };

    let releaseProbe!: (value: boolean) => void;
    mockIsListening.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        releaseProbe = resolve;
      }),
    );
    const probe = store.fetchQrlConnection({ quiet: true });
    await flush();
    // Mid-probe: the status dot must not start pulsing and the chain badge
    // must not go disabled just because a background check is in flight.
    expect(store.qrlConnection.isLoading).toBe(false);

    releaseProbe(true);
    await probe;
    expect(store.qrlConnection.isLoading).toBe(false);
    expect(store.qrlConnection.isConnected).toBe(true);

    // A foreground probe still reports loading.
    const loadingSeen: boolean[] = [];
    mockIsListening.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        releaseProbe = resolve;
      }),
    );
    const foreground = store.fetchQrlConnection();
    await flush();
    loadingSeen.push(store.qrlConnection.isLoading);
    releaseProbe(true);
    await foreground;
    expect(loadingSeen).toEqual([true]);
    expect(store.qrlConnection.isLoading).toBe(false);
  });

  it("does not poll while polling is disallowed and resumes when allowed", async () => {
    const store = await connectedStore();
    store.setPollingAllowed(false);
    const calls = mockGetBalance.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS * 3);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBe(calls);

    store.setPollingAllowed(true);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(calls);
    store.setPollingAllowed(false);
  });
});
