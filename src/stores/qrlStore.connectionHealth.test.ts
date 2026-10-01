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
  RPC_READ_TIMEOUT_MS,
  CONNECTION_REPROBE_TICKS,
  MANUAL_PROBE_COOLDOWN_MS,
  MAX_POLL_BACKOFF_MS,
  VISIBLE_MAX_POLL_BACKOFF_MS,
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
    // One failure pushes the next tick out by the first backoff step.
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS * 2);
    await flush();

    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.qrlConnection.areBalancesStale).toBe(false);
    expect(store.qrlAccounts.accounts[0]?.accountBalance).toContain("7");
    store.stopBalancePolling();
  });

  it("backs off while the node is down and resumes the plain cadence on recovery", async () => {
    const store = await connectedStore();
    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockResolvedValue(false);

    // First failure: the next tick is pushed out one backoff step, so the
    // very next interval is skipped.
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    const afterFirstFailure = mockGetBalance.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBe(afterFirstFailure);

    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    const afterSecondFailure = mockGetBalance.mock.calls.length;
    expect(afterSecondFailure).toBeGreaterThan(afterFirstFailure);

    // The doubling would go further, but a visible surface caps the
    // spacing at a minute, so the next interval is still skipped.
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBe(afterSecondFailure);

    // Recovery resets the spacing: the next interval polls again.
    mockGetBalance.mockResolvedValue(BigInt(3e18));
    mockIsListening.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS * 4);
    await flush();
    expect(store.qrlConnection.isConnected).toBe(true);
    const afterRecovery = mockGetBalance.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(afterRecovery);
    store.stopBalancePolling();
  });

  it("caps the backoff at a minute while a surface is visible", async () => {
    const store = await connectedStore();
    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockResolvedValue(false);

    // Well past the point where doubling would exceed the cap.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(MAX_POLL_BACKOFF_MS);
      await flush();
    }
    const beforeCappedWait = mockGetBalance.mock.calls.length;
    // A wallet on screen is never left more than the visible cap behind,
    // so one of those is enough to buy another probe.
    await vi.advanceTimersByTimeAsync(VISIBLE_MAX_POLL_BACKOFF_MS);
    await flush();

    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(beforeCappedWait);
    store.stopBalancePolling();
  });

  it("probes at once when asked, resetting the backoff", async () => {
    const store = await connectedStore();
    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockResolvedValue(false);

    // Sit out enough failures to be parked on the cap.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(VISIBLE_MAX_POLL_BACKOFF_MS);
      await flush();
    }
    expect(store.qrlConnection.isConnected).toBe(false);

    mockGetBalance.mockResolvedValue(BigInt(9e18));
    mockIsListening.mockResolvedValue(true);
    const beforeProbe = mockIsListening.mock.calls.length;

    await store.probeConnectionNow();
    await flush();

    expect(mockIsListening.mock.calls.length).toBe(beforeProbe + 1);
    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.qrlConnection.areBalancesStale).toBe(false);
    expect(store.qrlConnection.isProbing).toBe(false);

    // The schedule is back to the plain cadence, so the next ordinary
    // interval polls again.
    const afterProbe = mockGetBalance.mock.calls.length;
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();
    expect(mockGetBalance.mock.calls.length).toBeGreaterThan(afterProbe);
    store.stopBalancePolling();
  });

  it("refuses a second manual probe inside the cooldown", async () => {
    const store = await connectedStore();
    mockGetBalance.mockRejectedValue(new Error("rpc down"));
    mockIsListening.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    await flush();

    const beforeFirst = mockIsListening.mock.calls.length;
    await store.probeConnectionNow({ manual: true });
    await flush();
    const afterFirst = mockIsListening.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(beforeFirst);

    // Impatient second click, inside the window.
    await store.probeConnectionNow({ manual: true });
    await flush();
    expect(mockIsListening.mock.calls.length).toBe(afterFirst);

    // Past the window it is allowed again.
    await vi.advanceTimersByTimeAsync(MANUAL_PROBE_COOLDOWN_MS);
    await store.probeConnectionNow({ manual: true });
    await flush();
    expect(mockIsListening.mock.calls.length).toBeGreaterThan(afterFirst);
    store.stopBalancePolling();
  });

  it("joins an in-flight tick and adds no reads of its own", async () => {
    const store = await connectedStore();
    let release: (() => void) | undefined;
    mockGetBalance.mockImplementation(
      () =>
        new Promise<bigint>((resolve) => {
          release = () => {
            resolve(BigInt(2e18));
          };
        }),
    );

    const first = store.pollBalancesAndConnection();
    await flush();
    const callsDuringFirst = mockGetBalance.mock.calls.length;

    // A second tick landing on top of the first joins it, and starts no
    // reads of its own.
    const second = store.pollBalancesAndConnection();
    await flush();
    expect(mockGetBalance.mock.calls.length).toBe(callsDuringFirst);

    release?.();
    await first;
    await second;
    store.stopBalancePolling();
  });

  it("runs a fresh tick when a probe only joined one already running", async () => {
    const store = await connectedStore();
    // The tick in flight is reading against the old, dead route.
    let releaseStale: (() => void) | undefined;
    mockGetBalance.mockImplementation(
      () =>
        new Promise<bigint>((_resolve, reject) => {
          releaseStale = () => {
            reject(new Error("rpc down"));
          };
        }),
    );
    mockIsListening.mockResolvedValue(false);

    const stale = store.pollBalancesAndConnection();
    await flush();

    // Connectivity comes back while that tick is still on the wire, and
    // the online handler probes.
    mockGetBalance.mockResolvedValue(BigInt(5e18));
    mockIsListening.mockResolvedValue(true);
    const probe = store.probeConnectionNow();
    await flush();

    releaseStale?.();
    await stale;
    const result = await probe;
    await flush();

    // Reporting the joined tick's answer would have left the wallet
    // disconnected and re-armed the backoff on a reading taken before the
    // node came back.
    expect(result).toEqual({ probed: true, isConnected: true });
    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.qrlConnection.areBalancesStale).toBe(false);
    store.stopBalancePolling();
  });

  it("gives up on a connection probe that never answers", async () => {
    const store = await connectedStore();
    mockGetBalance.mockResolvedValue(BigInt(1e18));
    // A route that accepts the connection and then says nothing.
    mockIsListening.mockImplementation(() => new Promise<boolean>(() => {}));

    const probe = store.probeConnectionNow({ manual: true });
    await vi.advanceTimersByTimeAsync(RPC_READ_TIMEOUT_MS * 2);
    const result = await probe;

    // Without its own ceiling this waited on the provider's 30s one, and
    // the Retry control stayed disabled for all of it.
    expect(result).toEqual({ probed: true, isConnected: false });
    expect(store.qrlConnection.isProbing).toBe(false);
    store.stopBalancePolling();
  });

  it("gives up on a balance read that never answers", async () => {
    const store = await connectedStore();
    // A blackholed route: the request neither resolves nor rejects.
    mockGetBalance.mockImplementation(() => new Promise<bigint>(() => {}));
    mockIsListening.mockResolvedValue(false);

    const tick = store.pollBalancesAndConnection();
    await vi.advanceTimersByTimeAsync(RPC_READ_TIMEOUT_MS);
    await tick;

    expect(store.qrlConnection.areBalancesStale).toBe(true);
    expect(store.qrlConnection.isConnected).toBe(false);
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
