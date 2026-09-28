import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Plain object stores (hoisting-safe) ────────────────────────────
const sessionStore: Record<string, unknown> = {};
const alarmsStore: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      session: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? { ...sessionStore }
              : key in sessionStore
                ? { [key]: sessionStore[key] }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(sessionStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete sessionStore[item];
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: vi.fn((name: string, info: unknown) => {
        alarmsStore[name] = info;
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => {
        delete alarmsStore[name];
        return Promise.resolve(true);
      }),
      get: vi.fn((name: string) => Promise.resolve(alarmsStore[name] ?? null)),
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const {
  getActiveBlockChain,
  getTransactionHistory,
  updateTransactionHistoryEntry,
} = vi.hoisted(() => ({
  getActiveBlockChain: vi.fn(),
  getTransactionHistory: vi.fn(),
  updateTransactionHistoryEntry: vi.fn(),
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getActiveBlockChain,
    getTransactionHistory,
    updateTransactionHistoryEntry,
  },
}));

const { getQrlProperties } = vi.hoisted(() => ({
  getQrlProperties: vi.fn(),
}));

vi.mock("./unrestrictedMethodExecutor", () => ({ getQrlProperties }));

const { mockShowTransactionNotification } = vi.hoisted(() => ({
  mockShowTransactionNotification: vi.fn().mockResolvedValue(undefined),
}));

// The watcher runs in the service worker, so it calls the notification
// helper directly. Mocked here to observe that call.
vi.mock("./transactionNotification", () => ({
  showTransactionNotification: (...args: unknown[]) =>
    mockShowTransactionNotification(...args),
}));

const { mockIsLocked } = vi.hoisted(() => ({
  mockIsLocked: vi.fn(),
}));

// The real LockManager pulls in the @theqrl/web3 crypto graph and reads
// keystores from storage; this watcher only needs its isLocked() answer
// (F7), the same narrow surface restrictedMethodsMiddleware.test.ts mocks.
vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: (...args: unknown[]) => mockIsLocked(...args) },
  LOCK_MANAGER_MESSAGES: { SEND_TX_NOTIFICATION: "SEND_TX_NOTIFICATION" },
}));

import browser from "webextension-polyfill";
import {
  DAPP_TX_WATCH_ALARM_NAME,
  handleDAppTransactionWatchAlarm,
  registerDAppTransactionWatch,
} from "./dAppTransactionWatcher";

const mockAlarms = browser.alarms as unknown as {
  create: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};
const mockSendMessage = browser.runtime.sendMessage as ReturnType<typeof vi.fn>;

const HASH = "0xabc123";
const HASH_2 = "0xdef456";
const ACCOUNT = `Q${"a".repeat(128)}`;
const CHAIN_ID = "0x301825";

const clearStore = (store: Record<string, unknown>) => {
  for (const key of Object.keys(store)) delete store[key];
};

/** A promise plus its own resolve, for controlling exactly when a mocked
 *  async call settles across an await boundary inside the code under test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const minedReceipt = (hash: string) => ({
  status: 1n,
  blockNumber: 5n,
  transactionHash: hash,
});

describe("dAppTransactionWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(sessionStore);
    clearStore(alarmsStore);
    getActiveBlockChain.mockResolvedValue({ chainId: CHAIN_ID });
    getTransactionHistory.mockResolvedValue([
      {
        transactionHash: HASH,
        amount: "1.5",
        tokenSymbol: "Quanta",
        pendingStatus: "pending",
      },
    ]);
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
  });

  describe("registerDAppTransactionWatch", () => {
    it("arms the alarm once for the first registration", async () => {
      await registerDAppTransactionWatch({
        hash: HASH,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });

      expect(mockAlarms.create).toHaveBeenCalledTimes(1);
      expect(mockAlarms.create).toHaveBeenCalledWith(
        DAPP_TX_WATCH_ALARM_NAME,
        expect.objectContaining({ periodInMinutes: expect.any(Number) }),
      );
    });

    it("does not re-arm (reset) an alarm that is already scheduled", async () => {
      await registerDAppTransactionWatch({
        hash: HASH,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });
      await registerDAppTransactionWatch({
        hash: HASH_2,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });

      expect(mockAlarms.create).toHaveBeenCalledTimes(1);
    });

    it("replaces a re-registration of the same hash, so it is only ever watched once", async () => {
      await registerDAppTransactionWatch({
        hash: HASH,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });
      await registerDAppTransactionWatch({
        hash: HASH,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });

      // Draining the alarm should confirm exactly one watch for HASH, not
      // notify twice.
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn().mockResolvedValue(minedReceipt(HASH)),
        },
      });
      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledTimes(1);
      expect(mockShowTransactionNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleDAppTransactionWatchAlarm", () => {
    const register = (hash = HASH) =>
      registerDAppTransactionWatch({
        hash,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });

    it("clears the alarm when nothing is watched", async () => {
      await handleDAppTransactionWatchAlarm();

      expect(mockAlarms.clear).toHaveBeenCalledWith(DAPP_TX_WATCH_ALARM_NAME);
    });

    it("confirms a mined, successful transaction and drops the watch", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn().mockResolvedValue({
            ...minedReceipt(HASH),
            gasUsed: 21000n,
            effectiveGasPrice: 100n,
          }),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledWith(
        ACCOUNT,
        HASH,
        expect.objectContaining({ pendingStatus: "confirmed", status: true }),
      );
      // Called directly. Chrome does not deliver a context's own runtime
      // messages back to it, so the service worker's own
      // SEND_TX_NOTIFICATION listener would never have seen a message sent
      // from here.
      expect(mockShowTransactionNotification).toHaveBeenCalledWith({
        status: "confirmed",
        amount: "1.5",
        tokenSymbol: "Quanta",
        txHash: HASH,
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
      // Resolved watches are dropped, which is why the alarm is cleared
      // once nothing is left to watch.
      expect(mockAlarms.clear).toHaveBeenCalledWith(DAPP_TX_WATCH_ALARM_NAME);
    });

    it("records a failed (mined but reverted) transaction and notifies accordingly", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi
            .fn()
            .mockResolvedValue({ ...minedReceipt(HASH), status: 0n }),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledWith(
        ACCOUNT,
        HASH,
        expect.objectContaining({ pendingStatus: "failed", status: false }),
      );
      expect(mockShowTransactionNotification).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("leaves an unmined transaction queued for the next tick", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: { getTransactionReceipt: vi.fn().mockResolvedValue(null) },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).not.toHaveBeenCalled();
      expect(mockShowTransactionNotification).not.toHaveBeenCalled();
      // Not yet resolved: the alarm must stay armed for the next tick.
      expect(mockAlarms.clear).not.toHaveBeenCalledWith(
        DAPP_TX_WATCH_ALARM_NAME,
      );

      // Restart-safety: a second tick re-reads the same state from session
      // storage from scratch and still finds the watch.
      await handleDAppTransactionWatchAlarm();
      expect(updateTransactionHistoryEntry).not.toHaveBeenCalled();
    });

    it("drops a watch once it is older than 30 minutes, without querying the node", async () => {
      await register();
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 31 * 60 * 1000);
        getQrlProperties.mockResolvedValue({
          qrl: { getTransactionReceipt: vi.fn() },
        });

        await handleDAppTransactionWatchAlarm();

        expect(getQrlProperties).not.toHaveBeenCalled();
        expect(mockAlarms.clear).toHaveBeenCalledWith(DAPP_TX_WATCH_ALARM_NAME);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a watch queued when the active chain does not match it yet", async () => {
      await register();
      getActiveBlockChain.mockResolvedValue({ chainId: "0xdeadbeef" });
      const getTransactionReceipt = vi.fn();
      getQrlProperties.mockResolvedValue({ qrl: { getTransactionReceipt } });

      await handleDAppTransactionWatchAlarm();

      expect(getTransactionReceipt).not.toHaveBeenCalled();
      expect(mockAlarms.clear).not.toHaveBeenCalledWith(
        DAPP_TX_WATCH_ALARM_NAME,
      );
    });

    it("keeps a watch queued when fetching the receipt throws", async () => {
      await register();
      getQrlProperties.mockRejectedValue(new Error("The node is down"));

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).not.toHaveBeenCalled();
      expect(mockAlarms.clear).not.toHaveBeenCalledWith(
        DAPP_TX_WATCH_ALARM_NAME,
      );
    });

    it("keeps a watch queued when the receipt fetch itself times out", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: { getTransactionReceipt: () => new Promise(() => {}) },
      });

      vi.useFakeTimers();
      try {
        const tick = handleDAppTransactionWatchAlarm();
        await vi.advanceTimersByTimeAsync(10_000);
        await tick;
      } finally {
        vi.useRealTimers();
      }

      expect(updateTransactionHistoryEntry).not.toHaveBeenCalled();
      expect(mockAlarms.clear).not.toHaveBeenCalledWith(
        DAPP_TX_WATCH_ALARM_NAME,
      );
    });

    it("fetches getQrlProperties once for two watches checked in the same tick", async () => {
      await register(HASH);
      await register(HASH_2);
      getTransactionHistory.mockResolvedValue([
        {
          transactionHash: HASH,
          amount: "1",
          tokenSymbol: "Quanta",
          pendingStatus: "pending",
        },
        {
          transactionHash: HASH_2,
          amount: "2",
          tokenSymbol: "Quanta",
          pendingStatus: "pending",
        },
      ]);
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn((hash: string) =>
            Promise.resolve(minedReceipt(hash)),
          ),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(getQrlProperties).toHaveBeenCalledTimes(1);
      expect(updateTransactionHistoryEntry).toHaveBeenCalledTimes(2);
    });

    it("does not run two ticks at once, and does not double-fetch a receipt for one already in flight", async () => {
      await register();
      const receipt = deferred<unknown>();
      const getTransactionReceipt = vi.fn(() => receipt.promise);
      getQrlProperties.mockResolvedValue({ qrl: { getTransactionReceipt } });

      const firstTick = handleDAppTransactionWatchAlarm();
      // The alarm firing again before the first tick settles (a slow RPC
      // outlasting the 30 s period) must be a no-op: the guard leaves the
      // watch to the tick already running. Asserted only after both
      // settle: nothing here may throw before `receipt` resolves, or the
      // first tick's promise (and the module-level in-flight flag with it)
      // would hang forever and break every later test in this file.
      const secondTick = handleDAppTransactionWatchAlarm();
      receipt.resolve(minedReceipt(HASH));
      await Promise.all([firstTick, secondTick]);

      expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(updateTransactionHistoryEntry).toHaveBeenCalledTimes(1);
    });

    it("does not lose a watch registered while a tick is still running", async () => {
      await register(HASH);
      const receipt = deferred<unknown>();
      getQrlProperties.mockResolvedValue({
        qrl: { getTransactionReceipt: () => receipt.promise },
      });

      const tick = handleDAppTransactionWatchAlarm();
      // A second qrl_sendTransaction gets approved, and registers its own
      // watch, before the in-flight tick (still waiting on HASH's receipt)
      // writes anything back.
      await registerDAppTransactionWatch({
        hash: HASH_2,
        account: ACCOUNT,
        chainId: CHAIN_ID,
      });
      receipt.resolve(minedReceipt(HASH));
      await tick;

      // HASH resolved and was dropped; HASH_2 must still be there for the
      // next tick to find. The stale snapshot the first tick read before
      // HASH_2 existed must never be the thing written back.
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi
            .fn()
            .mockResolvedValue(minedReceipt(HASH_2)),
        },
      });
      getTransactionHistory.mockResolvedValue([
        {
          transactionHash: HASH_2,
          amount: "1",
          tokenSymbol: "Quanta",
          pendingStatus: "pending",
        },
      ]);
      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledWith(
        ACCOUNT,
        HASH_2,
        expect.objectContaining({ pendingStatus: "confirmed" }),
      );
    });

    it("updates history but does not notify while the wallet is locked", async () => {
      await register();
      mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn().mockResolvedValue(minedReceipt(HASH)),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledWith(
        ACCOUNT,
        HASH,
        expect.objectContaining({ pendingStatus: "confirmed" }),
      );
      expect(mockShowTransactionNotification).not.toHaveBeenCalled();
    });

    it("skips the notification, but still drops the watch, when the history poller already confirmed it first", async () => {
      await register();
      getTransactionHistory.mockResolvedValue([
        {
          transactionHash: HASH,
          amount: "1.5",
          tokenSymbol: "Quanta",
          pendingStatus: "confirmed",
        },
      ]);
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn().mockResolvedValue(minedReceipt(HASH)),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalled();
      expect(mockShowTransactionNotification).not.toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith(DAPP_TX_WATCH_ALARM_NAME);
    });
  });
});
