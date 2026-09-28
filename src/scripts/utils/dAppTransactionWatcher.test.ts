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
const ACCOUNT = `Q${"a".repeat(128)}`;
const CHAIN_ID = "0x301825";

const clearStore = (store: Record<string, unknown>) => {
  for (const key of Object.keys(store)) delete store[key];
};

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
      },
    ]);
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
        hash: "0xdef456",
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
          getTransactionReceipt: vi.fn().mockResolvedValue({
            status: 1n,
            blockNumber: 5n,
            transactionHash: HASH,
          }),
        },
      });
      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleDAppTransactionWatchAlarm", () => {
    const register = () =>
      registerDAppTransactionWatch({
        hash: HASH,
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
            status: 1n,
            blockNumber: 5n,
            transactionHash: HASH,
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
      expect(mockSendMessage).toHaveBeenCalledWith({
        name: "SEND_TX_NOTIFICATION",
        data: {
          status: "confirmed",
          amount: "1.5",
          tokenSymbol: "Quanta",
          txHash: HASH,
        },
      });
      // Resolved watches are dropped, which is why the alarm is cleared
      // once nothing is left to watch.
      expect(mockAlarms.clear).toHaveBeenCalledWith(DAPP_TX_WATCH_ALARM_NAME);
    });

    it("records a failed (mined but reverted) transaction and notifies accordingly", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: {
          getTransactionReceipt: vi.fn().mockResolvedValue({
            status: 0n,
            blockNumber: 5n,
            transactionHash: HASH,
          }),
        },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).toHaveBeenCalledWith(
        ACCOUNT,
        HASH,
        expect.objectContaining({ pendingStatus: "failed", status: false }),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "failed" }),
        }),
      );
    });

    it("leaves an unmined transaction queued for the next tick", async () => {
      await register();
      getQrlProperties.mockResolvedValue({
        qrl: { getTransactionReceipt: vi.fn().mockResolvedValue(null) },
      });

      await handleDAppTransactionWatchAlarm();

      expect(updateTransactionHistoryEntry).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
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
  });
});
