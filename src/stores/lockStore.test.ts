import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Plain object stores (hoisting-safe) ────────────────────────────
const localStore: Record<string, any> = {};
const sessionStore: Record<string, any> = {};

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(() => Promise.resolve({} as any)),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(
            key in localStore ? { [key]: localStore[key] } : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete localStore[key];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((key: string) =>
          Promise.resolve(
            key in sessionStore ? { [key]: sessionStore[key] } : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(sessionStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete sessionStore[key];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(sessionStore)) delete sessionStore[k];
          return Promise.resolve();
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: mockSendMessage,
      connect: vi.fn(() => ({
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
    },
  },
}));

vi.mock("@theqrl/web3", () => ({
  Web3BaseWalletAccount: class {},
}));

const clearStore = (store: Record<string, any>) => {
  for (const k of Object.keys(store)) delete store[k];
};

import type { DecryptedKeyType } from "@/scripts/lockManager/lockManager";

const MOCK_KEYS: DecryptedKeyType[] = [
  {
    address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
    mnemonicPhrases: "mocked mnemonic",
  },
];

describe("LockStore – readLockState timestamp check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
  });

  async function createLockStore() {
    // Mock initial IS_LOCKED response for the constructor's initialize()
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });

    const module = await import("./lockStore");
    const store = new module.default();

    // Wait for async constructor initialization
    await new Promise((r) => setTimeout(r, 300));

    return store;
  }

  describe("readLockState with cachedKeys", () => {
    it("should clear cachedKeys when LOCKED timestamp > UNLOCKED timestamp (intentional lock)", async () => {
      const store = await createLockStore();

      // Simulate having cached keys (from a previous unlock)
      (store as any).cachedKeys = MOCK_KEYS;

      // Set timestamps: locked AFTER unlocked = intentional lock
      localStore["LOCK_MANAGER_UNLOCKED_TIMESTAMP"] = 1000;
      localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"] = 2000;

      // SW reports locked
      mockSendMessage.mockResolvedValueOnce({
        isLocked: true,
        hasPasswordSet: true,
      });

      await store.readLockState();

      // cachedKeys should be cleared (not re-sent)
      expect((store as any).cachedKeys).toBeUndefined();
      expect(store.isLocked).toBe(true);

      // SET_DECRYPTED_KEYS should NOT have been sent
      const setKeysCalls = mockSendMessage.mock.calls.filter(
        (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
      );
      expect(setKeysCalls).toHaveLength(0);
    });

    it("should re-send cachedKeys when UNLOCKED timestamp > LOCKED timestamp (SW restart)", async () => {
      const store = await createLockStore();

      (store as any).cachedKeys = MOCK_KEYS;

      // Set timestamps: unlocked AFTER locked = SW restart
      localStore["LOCK_MANAGER_UNLOCKED_TIMESTAMP"] = 2000;
      localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"] = 1000;

      // First call: IS_LOCKED returns locked
      // Second call: SET_DECRYPTED_KEYS succeeds
      // Third call: IS_LOCKED recheck returns unlocked
      mockSendMessage
        .mockResolvedValueOnce({ isLocked: true, hasPasswordSet: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ isLocked: false, hasPasswordSet: true });

      await store.readLockState();

      // Keys should have been re-sent
      const setKeysCalls = mockSendMessage.mock.calls.filter(
        (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
      );
      expect(setKeysCalls).toHaveLength(1);
      expect((setKeysCalls[0] as any)[0].data).toEqual(MOCK_KEYS);

      // Wallet should now be unlocked
      expect(store.isLocked).toBe(false);
    });

    it("should re-send cachedKeys when no timestamps exist (both are 0)", async () => {
      const store = await createLockStore();

      (store as any).cachedKeys = MOCK_KEYS;

      // No timestamps in storage — both default to 0
      // lockedTs (0) is NOT > unlockedTs (0), so keys should be re-sent

      mockSendMessage
        .mockResolvedValueOnce({ isLocked: true, hasPasswordSet: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ isLocked: false, hasPasswordSet: true });

      await store.readLockState();

      const setKeysCalls = mockSendMessage.mock.calls.filter(
        (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
      );
      expect(setKeysCalls).toHaveLength(1);
    });

    it("should not re-send keys when there are no cachedKeys", async () => {
      const store = await createLockStore();

      (store as any).cachedKeys = undefined;

      mockSendMessage.mockResolvedValueOnce({
        isLocked: true,
        hasPasswordSet: true,
      });

      await store.readLockState();

      const setKeysCalls = mockSendMessage.mock.calls.filter(
        (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
      );
      expect(setKeysCalls).toHaveLength(0);
      expect(store.isLocked).toBe(true);
    });

    it("should accept locked state when re-send fails", async () => {
      const store = await createLockStore();

      (store as any).cachedKeys = MOCK_KEYS;

      // Timestamps indicate SW restart
      localStore["LOCK_MANAGER_UNLOCKED_TIMESTAMP"] = 2000;
      localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"] = 1000;

      // IS_LOCKED returns locked, SET_DECRYPTED_KEYS fails
      mockSendMessage
        .mockResolvedValueOnce({ isLocked: true, hasPasswordSet: true })
        .mockRejectedValueOnce(new Error("SW not reachable"));

      await store.readLockState();

      expect(store.isLocked).toBe(true);
    });
  });
});

describe("LockStore – destructive paths", () => {
  const SESSION_KEYS_KEY = "_LM_CACHED_KEYS";
  const OTHER_KEY: DecryptedKeyType = {
    address: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    mnemonicPhrases: "second mnemonic",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
  });

  async function createLockStore() {
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });
    const module = await import("./lockStore");
    const store = new module.default();
    await new Promise((r) => setTimeout(r, 300));
    return store;
  }

  const namesSent = () =>
    mockSendMessage.mock.calls.map((call: any) => call[0]?.name);

  describe("resetWallet", () => {
    it("delegates the wipe to the service worker", async () => {
      const store = await createLockStore();
      (store as any).cachedKeys = MOCK_KEYS;
      (store as any).cachedPassword = "pw";
      mockSendMessage.mockResolvedValue({ success: true });

      await store.resetWallet();

      expect(namesSent()).toContain("LOCK_MANAGER_RESET_WALLET");
      expect((store as any).cachedKeys).toBeUndefined();
      expect((store as any).cachedPassword).toBeUndefined();
    });

    it("wipes session storage itself when the service worker is unreachable", async () => {
      // The session area holds the decrypted-key backup, which by design
      // survives SW restarts: a reset that cleared only local storage would
      // leave every account's plaintext mnemonic on the device.
      const store = await createLockStore();
      sessionStore[SESSION_KEYS_KEY] = MOCK_KEYS;
      localStore["KEYSTORES"] = JSON.stringify([{ address: "qaaa" }]);
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(sessionStore[SESSION_KEYS_KEY]).toBeUndefined();
      expect(localStore["KEYSTORES"]).toBeUndefined();
    });

    it("writes the LOCKED timestamp after the wipe, not before", async () => {
      // readLockState tells an intentional lock from an SW restart by
      // comparing these timestamps. Written before the wipe, the marker
      // would be erased and peer surfaces would "recover" the reset wallet.
      const store = await createLockStore();
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(typeof localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"]).toBe("number");
    });
  });

  describe("readLockState after a reset", () => {
    it("never re-arms the service worker once the wallet has no keystores", async () => {
      // A second surface (side panel, tab) still holds keys from before
      // another surface reset the wallet. Re-sending them would put the
      // wiped wallet's mnemonics back into the SW and its session backup.
      const store = await createLockStore();
      (store as any).cachedKeys = MOCK_KEYS;
      (store as any).cachedPassword = "pw";
      vi.clearAllMocks();
      mockSendMessage.mockResolvedValue({
        isLocked: true,
        hasPasswordSet: false,
      });

      await store.readLockState();

      expect(namesSent()).not.toContain("SET_DECRYPTED_KEYS");
      expect((store as any).cachedKeys).toBeUndefined();
      expect((store as any).cachedPassword).toBeUndefined();
    });
  });

  describe("removeAccountKey", () => {
    it("asks the service worker to scrub the key and drops its own copy", async () => {
      const store = await createLockStore();
      (store as any).cachedKeys = [...MOCK_KEYS, OTHER_KEY];
      vi.clearAllMocks();
      mockSendMessage.mockResolvedValue({ success: true });

      await store.removeAccountKey(OTHER_KEY.address);

      const scrub: any = mockSendMessage.mock.calls.find(
        (call: any) => call[0]?.name === "LOCK_MANAGER_REMOVE_ACCOUNT_KEY",
      );
      expect(scrub?.[0]?.data).toBe(OTHER_KEY.address);
      expect((store as any).cachedKeys).toEqual(MOCK_KEYS);
    });

    it("throws when the service worker cannot be reached", async () => {
      // The caller deletes the keystore next; failing loudly is what stops
      // it doing that while the SW still holds the plaintext mnemonic.
      const store = await createLockStore();
      (store as any).cachedKeys = [...MOCK_KEYS, OTHER_KEY];
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await expect(
        store.removeAccountKey(OTHER_KEY.address),
      ).rejects.toThrow();
    });
  });
});

describe("LockStore – unlock worker fan-out", () => {
  type WorkerResponse = Record<string, unknown>;
  type WorkerBehavior = (request: {
    keystores: unknown[];
    password: string;
  }) => WorkerResponse | "error";

  /**
   * Stub for the global Worker: each spawned instance consumes the next
   * scripted behavior, mirroring the pool's fresh-worker-per-chunk model.
   */
  let behaviors: WorkerBehavior[] = [];
  let spawned = 0;

  class StubWorker {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    private readonly behavior: WorkerBehavior;
    constructor() {
      const next = behaviors[Math.min(spawned, behaviors.length - 1)];
      this.behavior = next;
      spawned += 1;
    }
    postMessage(request: { keystores: unknown[]; password: string }) {
      queueMicrotask(() => {
        const result = this.behavior(request);
        if (result === "error") {
          this.onerror?.(new Event("error"));
        } else {
          this.onmessage?.({ data: result });
        }
      });
    }
    terminate() {}
  }

  const KEYSTORE_A = { address: "qaaa", crypto: {} };
  const KEYSTORE_B = { address: "qbbb", crypto: {} };
  const KEY_A = { address: "Qaaa", mnemonicPhrases: "mnemonic a" };
  const KEY_B = { address: "Qbbb", mnemonicPhrases: "mnemonic b" };

  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    behaviors = [];
    spawned = 0;
    vi.stubGlobal("Worker", StubWorker);
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 4,
      configurable: true,
    });
    localStore["KEYSTORES"] = JSON.stringify([KEYSTORE_A, KEYSTORE_B]);
  });

  async function createLockStore() {
    mockSendMessage.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    const module = await import("./lockStore");
    const store = new module.default();
    await new Promise((r) => setTimeout(r, 300));
    return store;
  }

  it("fans keystores out over one worker per chunk and merges the keys in order", async () => {
    const store = await createLockStore();
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: true, keys: [KEY_B], upgraded: [null] }),
    ];

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe(true);
    expect(spawned).toBe(2);
    const setKeysCall: any = mockSendMessage.mock.calls.find(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCall?.[0]?.data?.keys).toEqual([KEY_A, KEY_B]);
  });

  it("returns false without retrying when a worker reports a wrong password", async () => {
    const store = await createLockStore();
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: false, wrongPassword: true }),
    ];

    const unlocked = await store.unlock("bad-pw");

    expect(unlocked).toBe(false);
    expect(spawned).toBe(2);
    const setKeysCalls = mockSendMessage.mock.calls.filter(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCalls).toHaveLength(0);
  });

  it("retries sequentially after an infrastructure failure and succeeds", async () => {
    const store = await createLockStore();
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => "error",
      // Sequential retry gets ALL keystores in one request.
      (req) => ({
        success: true,
        keys: req.keystores.length === 2 ? [KEY_A, KEY_B] : [],
        upgraded: [null, null],
      }),
    ];

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe(true);
    expect(spawned).toBe(3);
    const setKeysCall: any = mockSendMessage.mock.calls.find(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCall?.[0]?.data?.keys).toEqual([KEY_A, KEY_B]);
  });

  it("throws a distinct error when the sequential retry also fails on infrastructure", async () => {
    const store = await createLockStore();
    behaviors = [
      () => "error",
      () => ({ success: true, keys: [KEY_B], upgraded: [null] }),
      () => ({ success: false, wrongPassword: false }),
    ];

    await expect(store.unlock("pw")).rejects.toThrow(/free memory/);
    expect(spawned).toBe(3);
  });

  it("persists upgraded keystores index-aligned with the original list", async () => {
    const store = await createLockStore();
    const upgradedB = { address: "qbbb", crypto: { upgraded: true } };
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: true, keys: [KEY_B], upgraded: [upgradedB] }),
    ];

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe(true);
    expect(JSON.parse(localStore["KEYSTORES"])).toEqual([
      KEYSTORE_A,
      upgradedB,
    ]);
  });
});
