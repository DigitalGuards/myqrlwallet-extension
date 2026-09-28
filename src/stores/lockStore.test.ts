import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? { ...localStore }
              : key in localStore
                ? { [key]: localStore[key] }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete localStore[item];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
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
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(sessionStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete sessionStore[item];
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

import browser from "webextension-polyfill";
import type { DecryptedKeyType } from "@/scripts/lockManager/lockManager";
import { LEGACY_QRL_ADDRESS_MIGRATION_ERROR } from "@/utilities/addressUtil";

describe("LockStore – readLockState reflects the SW directly", () => {
  // No client-side resend or timestamp comparison any more (F4): decrypted
  // keys and the wallet password vanish together now, so readLockState just
  // mirrors whatever the service worker answers.
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

  it("reflects a locked answer directly, with no resend attempt", async () => {
    const store = await createLockStore();
    mockSendMessage.mockResolvedValueOnce({
      isLocked: true,
      hasPasswordSet: true,
    });

    await store.readLockState();

    expect(store.isLocked).toBe(true);
    const setKeysCalls = mockSendMessage.mock.calls.filter(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCalls).toHaveLength(0);
  });

  it("reflects an unlocked answer directly", async () => {
    const store = await createLockStore();
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });

    await store.readLockState();

    expect(store.isLocked).toBe(false);
  });

  it("leaves state unchanged (does not throw) when the SW is unreachable", async () => {
    const store = await createLockStore();
    const before = store.isLocked;
    mockSendMessage.mockRejectedValueOnce(new Error("SW not reachable"));

    await expect(store.readLockState()).resolves.toBeUndefined();

    expect(store.isLocked).toBe(before);
  });
});

describe("LockStore – destructive paths", () => {
  const OTHER_KEY: DecryptedKeyType = {
    address: `Q${"b".repeat(128)}`,
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
      mockSendMessage.mockResolvedValue({ success: true });

      await store.resetWallet();

      expect(namesSent()).toContain("LOCK_MANAGER_RESET_WALLET");
    });

    it("wipes session storage itself when the service worker is unreachable", async () => {
      // Session storage only ever holds non-secret bookkeeping now (the
      // keep-alive timestamp, pending dApp watch data), but a reset must
      // still clear it here too when the SW cannot be reached to do its
      // own authoritative wipe.
      const store = await createLockStore();
      sessionStore[profileStorageKey("keepAlive")] = Date.now();
      localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
        { address: "qaaa" },
      ]);
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(sessionStore[profileStorageKey("keepAlive")]).toBeUndefined();
      expect(localStore[profileStorageKey("KEYSTORES")]).toBeUndefined();
    });

    it("writes the LOCKED timestamp after the wipe, not before", async () => {
      // readLockState tells an intentional lock from an SW restart by
      // comparing these timestamps. Written before the wipe, the marker
      // would be erased and peer surfaces would "recover" the reset wallet.
      const store = await createLockStore();
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(
        typeof localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBe("number");
    });
  });

  describe("readLockState after a reset", () => {
    it("reflects the reset wallet's locked, no-password state directly", async () => {
      const store = await createLockStore();
      vi.clearAllMocks();
      mockSendMessage.mockResolvedValue({
        isLocked: true,
        hasPasswordSet: false,
      });

      await store.readLockState();

      expect(namesSent()).not.toContain("SET_DECRYPTED_KEYS");
      expect(store.isLocked).toBe(true);
      expect(store.hasPasswordSet).toBe(false);
    });
  });

  describe("removeAccountKey", () => {
    it("asks the service worker to scrub the key", async () => {
      const store = await createLockStore();
      vi.clearAllMocks();
      mockSendMessage.mockResolvedValue({ success: true });

      await store.removeAccountKey(OTHER_KEY.address);

      const scrub: any = mockSendMessage.mock.calls.find(
        (call: any) => call[0]?.name === "LOCK_MANAGER_REMOVE_ACCOUNT_KEY",
      );
      expect(scrub?.[0]?.data).toBe(OTHER_KEY.address);
    });

    it("throws when the service worker cannot be reached", async () => {
      // The caller deletes the keystore next; failing loudly is what stops
      // it doing that while the SW still holds the plaintext mnemonic.
      const store = await createLockStore();
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await expect(store.removeAccountKey(OTHER_KEY.address)).rejects.toThrow();
    });
  });

  describe("lock (F6)", () => {
    it("does not write the LOCKED timestamp itself, trusting the service worker's own write", async () => {
      // LockManager.lock() (mocked here as a bare success response) now
      // writes the LOCKED timestamp itself, durably, before clearing
      // anything. The surface used to also write it, unawaited - a race
      // that let another open surface see a stale timestamp and mistake
      // the lock for a service-worker restart. Nothing in the surface's
      // own lock() should touch local storage directly any more.
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ isLocked: true });

      await store.lock();

      expect(
        localStore[profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")],
      ).toBeUndefined();
      expect(store.isLocked).toBe(true);
    });
  });
});

describe("LockStore – storage listener ignores automated traffic (F2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
  });

  async function createLockStoreAndGetStorageListener() {
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });
    const module = await import("./lockStore");
    new module.default();
    await new Promise((r) => setTimeout(r, 300));

    const addListenerMock = browser.storage.onChanged.addListener as any;
    expect(addListenerMock).toHaveBeenCalledTimes(1);
    return addListenerMock.mock.calls[0][0] as (
      changes: Record<string, unknown>,
      areaName: string,
    ) => Promise<void>;
  }

  it("does not call readLockState for an automated keepAlive-only session write", async () => {
    const listener = await createLockStoreAndGetStorageListener();
    mockSendMessage.mockClear();

    await listener(
      { [profileStorageKey("keepAlive")]: { newValue: Date.now() } },
      "session",
    );

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("does not call readLockState for an automated dApp-watch-only session write", async () => {
    const listener = await createLockStoreAndGetStorageListener();
    mockSendMessage.mockClear();

    await listener(
      { [profileStorageKey("DAPP_TX_WATCHES")]: { newValue: [] } },
      "session",
    );

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("does not call readLockState for the one-time legacy key-backup scrub event either", async () => {
    // LockManager's startup scrub of a pre-upgrade plaintext key backup
    // (scrubLegacySessionSecrets) fires a single storage event for this
    // key; it is no more "the user did something" than the other two.
    const listener = await createLockStoreAndGetStorageListener();
    mockSendMessage.mockClear();

    await listener(
      { [profileStorageKey("_LM_CACHED_KEYS")]: { newValue: undefined } },
      "session",
    );

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("still calls readLockState for an unrecognized session-storage change", async () => {
    const listener = await createLockStoreAndGetStorageListener();
    mockSendMessage.mockClear();
    mockSendMessage.mockResolvedValue({ isLocked: true, hasPasswordSet: true });

    await listener(
      { [profileStorageKey("SOME_FUTURE_KEY")]: { newValue: "x" } },
      "session",
    );

    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("still calls readLockState for a local storage change unrelated to the price cache", async () => {
    const listener = await createLockStoreAndGetStorageListener();
    mockSendMessage.mockClear();
    mockSendMessage.mockResolvedValue({ isLocked: true, hasPasswordSet: true });

    await listener(
      { [profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")]: { newValue: 1 } },
      "local",
    );

    expect(mockSendMessage).toHaveBeenCalled();
  });
});

describe("LockStore – throttled user-activity ping (F2)", () => {
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

  it("sends USER_ACTIVITY on pointer activity", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("pointerdown"));

    expect(mockSendMessage).toHaveBeenCalledWith({
      name: "LOCK_MANAGER_USER_ACTIVITY",
    });
  });

  it("sends USER_ACTIVITY on keyboard activity", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("keydown"));

    expect(mockSendMessage).toHaveBeenCalledWith({
      name: "LOCK_MANAGER_USER_ACTIVITY",
    });
  });

  it("throttles repeated activity to at most once per 30s", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));

    const activityPings = mockSendMessage.mock.calls.filter(
      (call: any) => call[0]?.name === "LOCK_MANAGER_USER_ACTIVITY",
    );
    expect(activityPings).toHaveLength(1);
  });

  it("sends USER_ACTIVITY on a mouse wheel/scroll gesture (N3)", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("wheel"));

    expect(mockSendMessage).toHaveBeenCalledWith({
      name: "LOCK_MANAGER_USER_ACTIVITY",
    });
  });

  it("sends USER_ACTIVITY on a scroll event from a nested scrolling container (N3)", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    // A capturing listener on document sees this even though "scroll" does
    // not bubble: the scrolling container (e.g. an account/history list)
    // fires its own scroll event on itself.
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.dispatchEvent(new Event("scroll", { bubbles: false }));

    expect(mockSendMessage).toHaveBeenCalledWith({
      name: "LOCK_MANAGER_USER_ACTIVITY",
    });

    document.body.removeChild(container);
  });

  it("sends USER_ACTIVITY when the document becomes visible again (N3)", async () => {
    await createLockStore();
    mockSendMessage.mockClear();

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockSendMessage).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(mockSendMessage).toHaveBeenCalledWith({
      name: "LOCK_MANAGER_USER_ACTIVITY",
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

  const KEYSTORE_A = { address: `Q${"a".repeat(128)}`, crypto: {} };
  const KEYSTORE_B = { address: `Q${"b".repeat(128)}`, crypto: {} };
  const KEY_A = {
    address: KEYSTORE_A.address,
    mnemonicPhrases: "mnemonic a",
  };
  const KEY_B = {
    address: KEYSTORE_B.address,
    mnemonicPhrases: "mnemonic b",
  };

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
    localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
      KEYSTORE_A,
      KEYSTORE_B,
    ]);
  });

  async function createLockStore() {
    mockSendMessage.mockResolvedValue({
      isLocked: false,
      hasPasswordSet: true,
    });
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

    expect(unlocked).toBe("success");
    expect(spawned).toBe(2);
    const setKeysCall: any = mockSendMessage.mock.calls.find(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCall?.[0]?.data?.keys).toEqual([KEY_A, KEY_B]);
  });

  it("returns 'wrong-password' without retrying when a worker reports a wrong password", async () => {
    const store = await createLockStore();
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: false, wrongPassword: true }),
    ];

    const unlocked = await store.unlock("bad-pw");

    expect(unlocked).toBe("wrong-password");
    expect(spawned).toBe(2);
    const setKeysCalls = mockSendMessage.mock.calls.filter(
      (call: any) => call[0]?.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCalls).toHaveLength(0);
  });

  it("returns 'failed' (not 'wrong-password') when there are no keystores to check against (N2)", async () => {
    localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([]);
    const store = await createLockStore();

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe("failed");
    expect(spawned).toBe(0);
  });

  it("returns 'failed' (not 'wrong-password') and leaves isLocked untouched when the final IS_LOCKED re-check still reports locked (N2/N8)", async () => {
    // Mirrors the SessionPasswordPrompt scenario: the store's isLocked is
    // already false (an in-progress Import/Create screen is showing) when
    // this runs. A worker already confirmed the password decrypts the
    // keystore, so a lingering "still locked" answer after SET_DECRYPTED_KEYS
    // must not be reported as a wrong password, and must not flip isLocked
    // to true and unmount that screen.
    const store = await createLockStore();
    expect(store.isLocked).toBe(false);
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: true, keys: [KEY_B], upgraded: [null] }),
    ];
    mockSendMessage.mockResolvedValueOnce({ success: true }); // SET_DECRYPTED_KEYS
    mockSendMessage.mockResolvedValueOnce({
      isLocked: true,
      hasPasswordSet: true,
    }); // final IS_LOCKED re-check

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe("failed");
    expect(store.isLocked).toBe(false);
  });

  it("requires explicit migration before decrypting a legacy-address keystore", async () => {
    localStore[profileStorageKey("KEYSTORES")] = JSON.stringify([
      { ...KEYSTORE_A, address: `Q${"c".repeat(40)}` },
    ]);
    const store = await createLockStore();

    await expect(store.unlock("pw")).rejects.toThrow(
      LEGACY_QRL_ADDRESS_MIGRATION_ERROR,
    );
    expect(spawned).toBe(0);
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

    expect(unlocked).toBe("success");
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
    const upgradedB = {
      address: KEYSTORE_B.address,
      crypto: { upgraded: true },
    };
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: true, keys: [KEY_B], upgraded: [upgradedB] }),
    ];

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe("success");
    expect(JSON.parse(localStore[profileStorageKey("KEYSTORES")])).toEqual([
      KEYSTORE_A,
      upgradedB,
    ]);
  });
});

describe("LockStore – keep-alive port reconnect (real-device fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (browser.runtime as any).lastError;
  });

  async function createLockStoreWithControllablePort() {
    const disconnectListeners: Array<() => void> = [];
    let connectCallCount = 0;
    (browser.runtime.connect as any).mockImplementation(() => {
      connectCallCount += 1;
      return {
        onDisconnect: {
          addListener: (cb: () => void) => {
            disconnectListeners.push(cb);
          },
        },
        disconnect: vi.fn(),
      };
    });
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });
    const module = await import("./lockStore");
    new module.default();
    await vi.advanceTimersByTimeAsync(300);
    return {
      fireDisconnect: () =>
        disconnectListeners[disconnectListeners.length - 1]?.(),
      getConnectCallCount: () => connectCallCount,
    };
  }

  it("reads runtime.lastError on port disconnect so it is never left unchecked", async () => {
    const { fireDisconnect } = await createLockStoreWithControllablePort();
    (browser.runtime as any).lastError = {
      message: "Could not establish connection. Receiving end does not exist.",
    };

    // checkForLastError() reads browser.runtime.lastError as a side effect
    // of being called at all - the assertion here is just that handling a
    // disconnect with lastError set does not throw.
    expect(() => fireDisconnect()).not.toThrow();
  });

  it("reconnects with an increasing backoff on repeated disconnects", async () => {
    const { fireDisconnect, getConnectCallCount } =
      await createLockStoreWithControllablePort();
    const baseline = getConnectCallCount();

    fireDisconnect();
    // Nothing yet: the first reconnect is scheduled after the short base
    // delay (250ms).
    expect(getConnectCallCount()).toBe(baseline);
    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectCallCount()).toBe(baseline + 1);

    // Immediately disconnect again (before the port had a chance to look
    // "stable") - the second reconnect must wait longer than the first.
    fireDisconnect();
    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectCallCount()).toBe(baseline + 1); // still pending
    await vi.advanceTimersByTimeAsync(250); // total 500ms since the 2nd disconnect
    expect(getConnectCallCount()).toBe(baseline + 2);
  });

  it("resets the backoff once a port has stayed connected for a while", async () => {
    const { fireDisconnect, getConnectCallCount } =
      await createLockStoreWithControllablePort();
    const baseline = getConnectCallCount();

    fireDisconnect();
    await vi.advanceTimersByTimeAsync(250); // 1st reconnect, base delay
    expect(getConnectCallCount()).toBe(baseline + 1);

    // Let the new connection sit long enough to be treated as stable.
    await vi.advanceTimersByTimeAsync(5_000);

    fireDisconnect();
    await vi.advanceTimersByTimeAsync(250); // back to the short base delay
    expect(getConnectCallCount()).toBe(baseline + 2);
  });
});
