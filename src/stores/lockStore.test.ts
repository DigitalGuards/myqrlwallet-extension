import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyStore, Web3BaseWalletAccount } from "@theqrl/web3";

type StorageListener = (
  changes: Record<string, unknown>,
  areaName: string,
) => Promise<void>;

type TestPort = {
  onDisconnect: { addListener: (listener: () => void) => void };
  disconnect: () => void;
};

type RuntimeMessage = { name: string; data?: unknown };

// In-memory stores (hoisting-safe).
const localStore = new Map<string, unknown>();
const sessionStore = new Map<string, unknown>();

const { mockSendMessage, mockBrowser } = vi.hoisted(() => {
  const mockSendMessage = vi.fn<(_message: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const mockBrowser = {
    storage: {
      local: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? Object.fromEntries(localStore)
              : localStore.has(key)
                ? { [key]: localStore.get(key) }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) {
            localStore.set(key, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            localStore.delete(item);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          localStore.clear();
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? Object.fromEntries(sessionStore)
              : sessionStore.has(key)
                ? { [key]: sessionStore.get(key) }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) {
            sessionStore.set(key, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            sessionStore.delete(item);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          sessionStore.clear();
          return Promise.resolve();
        }),
      },
      onChanged: { addListener: vi.fn<(listener: StorageListener) => void>() },
    },
    runtime: {
      sendMessage: mockSendMessage,
      connect: vi.fn<() => TestPort>(() => ({
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
    },
  };
  return { mockSendMessage, mockBrowser };
});

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: mockBrowser,
}));

vi.mock("@theqrl/web3", () => ({
  Web3BaseWalletAccount: vi.fn(),
}));

const clearStore = (store: Map<string, unknown>) => {
  store.clear();
};

const isRuntimeMessage = (value: unknown): value is RuntimeMessage =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "name" in value &&
  typeof value.name === "string";

const messagesSent = () =>
  mockSendMessage.mock.calls.map(([message]) => {
    if (!isRuntimeMessage(message)) {
      throw new Error("Expected a named runtime message");
    }
    return message;
  });

import browser from "webextension-polyfill";
import type { DecryptedKeyType } from "@/scripts/lockManager/lockManager";
import { LEGACY_QRL_ADDRESS_MIGRATION_ERROR } from "@/utilities/addressUtil";
import { KeystoreStorageCorruptError } from "@/utilities/storageUtil";

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
    const setKeysCalls = messagesSent().filter(
      (message) => message.name === "SET_DECRYPTED_KEYS",
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

  const namesSent = () => messagesSent().map((message) => message.name);

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
      sessionStore.set(profileStorageKey("keepAlive"), Date.now());
      localStore.set(
        profileStorageKey("KEYSTORES"),
        JSON.stringify([{ address: "qaaa" }]),
      );
      const unrelatedLocalData = { label: "local data" };
      const unrelatedSessionData = { label: "session data" };
      localStore.set("UNRELATED_DATA", unrelatedLocalData);
      sessionStore.set("UNRELATED_DATA", unrelatedSessionData);
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(sessionStore.get(profileStorageKey("keepAlive"))).toBeUndefined();
      expect(localStore.get(profileStorageKey("KEYSTORES"))).toBeUndefined();
      expect(localStore.get("UNRELATED_DATA")).toBe(unrelatedLocalData);
      expect(sessionStore.get("UNRELATED_DATA")).toBe(unrelatedSessionData);
    });

    it("writes the LOCKED timestamp after the wipe, not before", async () => {
      // readLockState tells an intentional lock from an SW restart by
      // comparing these timestamps. Written before the wipe, the marker
      // would be erased and peer surfaces would "recover" the reset wallet.
      const store = await createLockStore();
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await store.resetWallet();

      expect(
        typeof localStore.get(
          profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP"),
        ),
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

      const scrub = messagesSent().find(
        (message) => message.name === "LOCK_MANAGER_REMOVE_ACCOUNT_KEY",
      );
      expect(scrub?.data).toBe(OTHER_KEY.address);
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
        localStore.get(profileStorageKey("LOCK_MANAGER_LOCKED_TIMESTAMP")),
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

    const addListenerMock = mockBrowser.storage.onChanged.addListener;
    expect(addListenerMock).toHaveBeenCalledTimes(1);
    const registration = addListenerMock.mock.calls.at(0);
    if (registration === undefined) {
      throw new Error("Expected a storage listener registration");
    }
    return registration[0];
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

    const activityPings = messagesSent().filter(
      (message) => message.name === "LOCK_MANAGER_USER_ACTIVITY",
    );
    expect(activityPings).toHaveLength(1);
  });

  it("sends nothing to the worker on any activity event while locked (real-device regression fix)", async () => {
    // A locked surface has nothing to postpone and nothing to re-verify;
    // messaging the worker for either reason would wake it right back up
    // for nothing (observed on real devices: a focus event unrelated to
    // this store, e.g. from another page opening elsewhere in the same
    // browser, was enough to resurrect an idle-killed worker indefinitely
    // while a locked panel sat open).
    mockSendMessage.mockResolvedValueOnce({
      isLocked: true,
      hasPasswordSet: true,
    });
    const module = await import("./lockStore");
    new module.default();
    await new Promise((r) => setTimeout(r, 300));
    mockSendMessage.mockClear();
    mockBrowser.runtime.connect.mockClear();

    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
    document.dispatchEvent(new Event("wheel"));
    document.dispatchEvent(new Event("focus"));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockBrowser.runtime.connect).not.toHaveBeenCalled();
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

  it("also polls IS_LOCKED on the same throttle while unlocked (M2)", async () => {
    const store = await createLockStore();
    expect(store.isLocked).toBe(false);
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("pointerdown"));

    const lockPolls = messagesSent().filter(
      (message) => message.name === "LOCK_MANAGER_IS_LOCKED",
    );
    expect(lockPolls).toHaveLength(1);
  });

  it("does not poll IS_LOCKED on activity once already locked (M2)", async () => {
    mockSendMessage.mockResolvedValueOnce({
      isLocked: true,
      hasPasswordSet: true,
    });
    const module = await import("./lockStore");
    const store = new module.default();
    await new Promise((r) => setTimeout(r, 300));
    expect(store.isLocked).toBe(true);
    mockSendMessage.mockClear();

    document.dispatchEvent(new Event("pointerdown"));

    const lockPolls = messagesSent().filter(
      (message) => message.name === "LOCK_MANAGER_IS_LOCKED",
    );
    expect(lockPolls).toHaveLength(0);
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
    localStore.set(
      profileStorageKey("KEYSTORES"),
      JSON.stringify([KEYSTORE_A, KEYSTORE_B]),
    );
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
    const setKeysCall = messagesSent().find(
      (message) => message.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCall?.data).toEqual(
      expect.objectContaining({ keys: [KEY_A, KEY_B] }),
    );
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
    const setKeysCalls = messagesSent().filter(
      (message) => message.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCalls).toHaveLength(0);
  });

  it("returns 'failed' (not 'wrong-password') when there are no keystores to check against (N2)", async () => {
    localStore.set(profileStorageKey("KEYSTORES"), JSON.stringify([]));
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
    localStore.set(
      profileStorageKey("KEYSTORES"),
      JSON.stringify([{ ...KEYSTORE_A, address: `Q${"c".repeat(40)}` }]),
    );
    const store = await createLockStore();

    await expect(store.unlock("pw")).rejects.toThrow(
      LEGACY_QRL_ADDRESS_MIGRATION_ERROR,
    );
    expect(spawned).toBe(0);
  });

  it.each([
    "null",
    "{}",
    "[null]",
    "[{}]",
    "not JSON",
    JSON.stringify([{ ...KEYSTORE_A, address: "Q123" }]),
    JSON.stringify([{ address: KEYSTORE_A.address }]),
    JSON.stringify([{ ...KEYSTORE_A, crypto: null }]),
    JSON.stringify([KEYSTORE_A, null]),
  ])("preserves corrupt storage %s during password checks", async (stored) => {
    const store = await createLockStore();
    mockSendMessage.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
    await store.readLockState();
    localStore.set(profileStorageKey("KEYSTORES"), stored);
    vi.clearAllMocks();

    await expect(store.unlock("pw")).rejects.toBeInstanceOf(
      KeystoreStorageCorruptError,
    );
    await expect(store.changePassword("pw", "new-pw")).rejects.toBeInstanceOf(
      KeystoreStorageCorruptError,
    );

    expect(store.isLocked).toBe(true);
    expect(store.hasPasswordSet).toBe(true);
    expect(spawned).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(stored);
    for (const area of [
      mockBrowser.storage.local,
      mockBrowser.storage.session,
    ]) {
      expect(area.set).not.toHaveBeenCalled();
      expect(area.remove).not.toHaveBeenCalled();
      expect(area.clear).not.toHaveBeenCalled();
    }
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
    const setKeysCall = messagesSent().find(
      (message) => message.name === "SET_DECRYPTED_KEYS",
    );
    expect(setKeysCall?.data).toEqual(
      expect.objectContaining({ keys: [KEY_A, KEY_B] }),
    );
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
    const upgradedB: KeyStore = {
      version: 1,
      id: "upgraded-b",
      address: KEYSTORE_B.address,
      crypto: {
        cipher: "aes-256-gcm",
        ciphertext: "ab".repeat(67),
        cipherparams: { iv: "ab".repeat(12) },
        kdf: "argon2id",
        kdfparams: { m: 262144, t: 4, p: 4, dklen: 32, salt: "ab".repeat(32) },
      },
    };
    behaviors = [
      () => ({ success: true, keys: [KEY_A], upgraded: [null] }),
      () => ({ success: true, keys: [KEY_B], upgraded: [upgradedB] }),
    ];

    const unlocked = await store.unlock("pw");

    expect(unlocked).toBe("success");
    const storedKeystores = localStore.get(profileStorageKey("KEYSTORES"));
    if (typeof storedKeystores !== "string") {
      throw new Error("Expected serialized keystores");
    }
    const keystores: unknown = JSON.parse(storedKeystores);
    expect(keystores).toEqual([KEYSTORE_A, upgradedB]);
  });

  it("persists complete password-change results and sends session keys in order", async () => {
    const store = await createLockStore();
    const replacement: KeyStore = {
      version: 1,
      id: "reencrypted-a",
      address: KEYSTORE_A.address,
      crypto: {
        cipher: "aes-256-gcm",
        ciphertext: "ab".repeat(67),
        cipherparams: { iv: "ab".repeat(12) },
        kdf: "argon2id",
        kdfparams: { m: 262144, t: 4, p: 4, dklen: 32, salt: "ab".repeat(32) },
      },
    };
    const second = {
      ...replacement,
      id: "reencrypted-b",
      address: KEYSTORE_B.address,
      extra: { retained: true },
    };
    behaviors = [
      () => ({ success: true, newKeys: [KEY_A], newKeystores: [replacement] }),
      () => ({ success: true, newKeys: [KEY_B], newKeystores: [second] }),
    ];
    const password = "néw-password".normalize("NFD");

    expect(await store.changePassword("old-password", password)).toBe(
      "success",
    );

    expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(
      JSON.stringify([replacement, second]),
    );
    expect(
      messagesSent().filter((message) => message.name === "SET_DECRYPTED_KEYS"),
    ).toEqual([
      {
        name: "SET_DECRYPTED_KEYS",
        data: {
          keys: [KEY_A, KEY_B],
          walletPassword: password.normalize("NFC"),
        },
      },
    ]);
  });

  it.each([
    { label: "missing fields", response: { success: true } },
    {
      label: "empty chunks",
      response: {
        success: true,
        keys: [],
        upgraded: [],
        newKeys: [],
        newKeystores: [],
      },
    },
    {
      label: "foreign address",
      response: {
        success: true,
        keys: [KEY_B],
        upgraded: [null],
        newKeys: [KEY_B],
        newKeystores: [KEYSTORE_B],
      },
    },
    {
      label: "malformed keystores",
      response: {
        success: true,
        keys: [KEY_A],
        upgraded: [KEYSTORE_A],
        newKeys: [KEY_A],
        newKeystores: [KEYSTORE_A],
      },
    },
  ])(
    "preserves stored keystores and session keys after $label worker replies",
    async ({ response }) => {
      const store = await createLockStore();
      const stored = localStore.get(profileStorageKey("KEYSTORES"));
      behaviors = [() => response];

      await expect(store.unlock("pw")).rejects.toThrow(
        "Unable to decrypt the wallet on this device right now.",
      );
      expect(await store.changePassword("pw", "new-pw")).toBe("failed");

      expect(localStore.get(profileStorageKey("KEYSTORES"))).toBe(stored);
      expect(
        messagesSent().filter(
          (message) => message.name === "SET_DECRYPTED_KEYS",
        ),
      ).toEqual([]);
    },
  );
});

describe("LockStore – keep-alive port only while unlocked (real-device regression fix)", () => {
  // A locked surface used to hold this port open too, reconnecting on
  // every disconnect. Chrome idle-kills a dormant worker every ~30s
  // regardless, so that surface resurrected it forever, running full
  // startup (phishing detector init etc.) each cycle for a wallet with
  // nothing to protect - and, in Playwright's CDP-driven e2e suite, kept
  // resurrecting the exact worker instance a test had just force-closed,
  // so a poll for that instance's DevTools target to disappear never
  // observed it gone. The port now only exists while genuinely unlocked;
  // any disconnect is applied locally as a lock with no reconnect at all.
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete browser.runtime.lastError;
  });

  async function createLockStoreWithControllablePort(options?: {
    initialIsLocked?: boolean;
    initialHasPasswordSet?: boolean;
  }) {
    const disconnectListeners: Array<() => void> = [];
    let connectCallCount = 0;
    mockBrowser.runtime.connect.mockImplementation(() => {
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
      isLocked: options?.initialIsLocked ?? false,
      hasPasswordSet: options?.initialHasPasswordSet ?? true,
    });
    const module = await import("./lockStore");
    const store = new module.default();
    await vi.advanceTimersByTimeAsync(300);
    return {
      store,
      fireDisconnect: () => {
        disconnectListeners[disconnectListeners.length - 1]?.();
      },
      getConnectCallCount: () => connectCallCount,
    };
  }

  it("reads runtime.lastError on port disconnect so it is never left unchecked", async () => {
    const { fireDisconnect } = await createLockStoreWithControllablePort();
    browser.runtime.lastError = {
      message: "Could not establish connection. Receiving end does not exist.",
    };

    // checkForLastError() reads browser.runtime.lastError as a side effect
    // of being called at all - the assertion here is just that handling a
    // disconnect with lastError set does not throw.
    expect(fireDisconnect).not.toThrow();
  });

  it("flips to locked on disconnect, with zero sendMessage or connect calls", async () => {
    const { store, fireDisconnect, getConnectCallCount } =
      await createLockStoreWithControllablePort();
    expect(store.isLocked).toBe(false);
    mockSendMessage.mockClear();
    const connectCallsBefore = getConnectCallCount();

    fireDisconnect();

    expect(store.isLocked).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
    // No reconnect, immediately or on a later tick.
    expect(getConnectCallCount()).toBe(connectCallsBefore);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getConnectCallCount()).toBe(connectCallsBefore);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("never connects the persistent port while the wallet starts up locked", async () => {
    const { getConnectCallCount } = await createLockStoreWithControllablePort({
      initialIsLocked: true,
      initialHasPasswordSet: true,
    });
    // The constructor's own wakeServiceWorker() nudge (a connect,
    // immediately disconnected: distinct from the persistent port) still
    // runs regardless of lock state, so this baseline already accounts
    // for it before the real assertion below.
    const afterConstruction = getConnectCallCount();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(getConnectCallCount()).toBe(afterConstruction);
  });

  it("connects the port once readLockState() reports unlocked", async () => {
    const { store, getConnectCallCount } =
      await createLockStoreWithControllablePort({
        initialIsLocked: true,
        initialHasPasswordSet: true,
      });
    const beforeUnlock = getConnectCallCount();
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });

    await store.readLockState();

    expect(store.isLocked).toBe(false);
    expect(getConnectCallCount()).toBe(beforeUnlock + 1);
  });

  it("retries a failed port connect once, and only while still unlocked", async () => {
    const { store, getConnectCallCount } =
      await createLockStoreWithControllablePort({
        initialIsLocked: true,
        initialHasPasswordSet: true,
      });
    const failingConnect = vi.fn(() => {
      throw new Error("Could not establish connection.");
    });
    const workingConnect = mockBrowser.runtime.connect.getMockImplementation();
    if (workingConnect === undefined) {
      throw new Error("Expected a connect mock implementation");
    }
    mockBrowser.runtime.connect.mockImplementation(failingConnect);
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });

    await store.readLockState();
    expect(failingConnect).toHaveBeenCalledTimes(1);

    // The single retry fails too: no third attempt follows.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(failingConnect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failingConnect).toHaveBeenCalledTimes(2);

    // A fresh unlock signal starts over, and a retry that succeeds opens
    // the port.
    mockBrowser.runtime.connect.mockImplementationOnce(() => {
      throw new Error("Could not establish connection.");
    });
    mockBrowser.runtime.connect.mockImplementation(workingConnect);
    const before = getConnectCallCount();
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });
    await store.readLockState();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getConnectCallCount()).toBe(before + 1);
  });

  it("drops the pending retry once the wallet locks", async () => {
    const { store } = await createLockStoreWithControllablePort({
      initialIsLocked: true,
      initialHasPasswordSet: true,
    });
    const connect = vi.fn(() => {
      throw new Error("Could not establish connection.");
    });
    mockBrowser.runtime.connect.mockImplementation(connect);
    mockSendMessage.mockResolvedValueOnce({
      isLocked: false,
      hasPasswordSet: true,
    });
    await store.readLockState();
    mockSendMessage.mockResolvedValueOnce({
      isLocked: true,
      hasPasswordSet: true,
    });
    await store.readLockState();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reads runtime.lastError after the wake nudge, so a dormant worker logs nothing unchecked", async () => {
    let lastErrorReads = 0;
    Object.defineProperty(browser.runtime, "lastError", {
      configurable: true,
      get: () => {
        lastErrorReads += 1;
        return undefined;
      },
    });

    await createLockStoreWithControllablePort({
      initialIsLocked: true,
      initialHasPasswordSet: true,
    });

    expect(lastErrorReads).toBeGreaterThan(0);
  });

  it("disconnects the port on lock()", async () => {
    const { store, fireDisconnect, getConnectCallCount } =
      await createLockStoreWithControllablePort();
    const afterConstruction = getConnectCallCount();
    mockSendMessage.mockResolvedValueOnce({ success: true }); // LOCK
    mockSendMessage.mockResolvedValueOnce({ isLocked: true }); // IS_LOCKED

    await store.lock();

    expect(store.isLocked).toBe(true);
    // disconnect() on our own port does not fire our own onDisconnect
    // listener (only the other end disconnecting does) - firing it
    // manually here is just confirming there is nothing left to
    // reconnect.
    expect(fireDisconnect).not.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getConnectCallCount()).toBe(afterConstruction);
  });
});

describe("LockStore – unlock still succeeds after a spurious port disconnect", () => {
  // Per the real-device regression fix: if the keep-alive port drops for
  // some reason OTHER than the worker actually dying, this store locally
  // believes it is locked (showing the lock screen) even though the
  // worker is still alive and holding the same keys. A real unlock()
  // against that still-alive worker must succeed, and must reconnect the
  // port again.
  class StubWorker {
    onmessage: ((event: { data: Record<string, unknown> }) => void) | null =
      null;
    onerror: ((event: unknown) => void) | null = null;
    postMessage(_request: unknown) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            success: true,
            keys: [{ address: `Q${"a".repeat(128)}`, mnemonicPhrases: "m" }],
            upgraded: [null],
          },
        });
      });
    }
    terminate() {}
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    vi.stubGlobal("Worker", StubWorker);
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 4,
      configurable: true,
    });
    localStore.set(
      profileStorageKey("KEYSTORES"),
      JSON.stringify([{ address: `Q${"a".repeat(128)}`, crypto: {} }]),
    );
  });

  it("unlocks against a live worker and reconnects the port", async () => {
    const disconnectListeners: Array<() => void> = [];
    let connectCallCount = 0;
    mockBrowser.runtime.connect.mockImplementation(() => {
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
    const store = new module.default();
    await new Promise((r) => setTimeout(r, 300));
    expect(store.isLocked).toBe(false);
    const connectCallsAfterInitialUnlock = connectCallCount;

    // A spurious disconnect: the worker is still alive (SET_DECRYPTED_KEYS
    // and IS_LOCKED below both still succeed) even though this specific
    // port dropped.
    disconnectListeners[disconnectListeners.length - 1]?.();
    expect(store.isLocked).toBe(true);

    mockSendMessage.mockImplementation((message) => {
      if (!isRuntimeMessage(message)) {
        return Promise.reject(new Error("Expected a named runtime message"));
      }
      if (message.name === "SET_DECRYPTED_KEYS") {
        return Promise.resolve({ success: true });
      }
      if (message.name === "LOCK_MANAGER_IS_LOCKED") {
        return Promise.resolve({ isLocked: false, hasPasswordSet: true });
      }
      return Promise.resolve({ success: true });
    });

    const result = await store.unlock("correct-password");

    expect(result).toBe("success");
    expect(store.isLocked).toBe(false);
    expect(connectCallCount).toBeGreaterThan(connectCallsAfterInitialUnlock);
  });
});

describe("LockStore – the wallet password stays in the service worker", () => {
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

  const lastMessageNamed = (name: string) =>
    messagesSent()
      .filter((message) => message.name === name)
      .pop();

  describe("ensureWalletPassword", () => {
    it("resolves when the worker reports a held password, having asked only for a boolean", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ hasPassword: true });

      await expect(store.ensureWalletPassword()).resolves.toBeUndefined();

      // The probe carries a name and nothing else.
      expect(lastMessageNamed("HAS_WALLET_PASSWORD")).toEqual({
        name: "HAS_WALLET_PASSWORD",
      });
    });

    it("throws WALLET_PASSWORD_UNAVAILABLE when the worker holds no password", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ hasPassword: false });

      await expect(store.ensureWalletPassword()).rejects.toThrow(
        "WALLET_PASSWORD_UNAVAILABLE",
      );
    });

    it("throws WALLET_PASSWORD_UNAVAILABLE when the service worker is unreachable", async () => {
      // A restarted worker and an explicit lock look identical from here,
      // and both mean the user has to unlock again before any write.
      const store = await createLockStore();
      mockSendMessage.mockRejectedValue(new Error("SW not reachable"));

      await expect(store.ensureWalletPassword()).rejects.toThrow(
        "WALLET_PASSWORD_UNAVAILABLE",
      );
    });

    it("treats an answer it cannot read as unavailable", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue(undefined);

      await expect(store.ensureWalletPassword()).rejects.toThrow(
        "WALLET_PASSWORD_UNAVAILABLE",
      );
    });
  });

  describe("encryptAccount", () => {
    const account: Web3BaseWalletAccount = {
      address: `Q${"a".repeat(128)}`,
      seed: "0xseed",
      signTransaction: vi.fn(() => {
        throw new Error("Unexpected account.signTransaction call");
      }),
      sign: vi.fn(() => {
        throw new Error("Unexpected account.sign call");
      }),
      encrypt: vi.fn(() => {
        throw new Error("Unexpected account.encrypt call");
      }),
    };

    it("puts no password on the wire when the caller supplies none", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ success: true });

      await store.encryptAccount(account);

      const sent = lastMessageNamed("ENCRYPT_ACCOUNT");
      expect(sent?.data).toEqual({ seed: "0xseed" });
      expect(sent?.data).not.toHaveProperty("password");
    });

    it("forwards an explicit password, for first-run onboarding", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ success: true });

      await store.encryptAccount(account, "typed-pw");

      expect(lastMessageNamed("ENCRYPT_ACCOUNT")?.data).toEqual({
        seed: "0xseed",
        password: "typed-pw",
      });
    });

    it("refuses an explicit empty password without reaching the worker", async () => {
      const store = await createLockStore();
      mockSendMessage.mockResolvedValue({ success: true });

      await expect(store.encryptAccount(account, "")).rejects.toThrow(
        "WALLET_PASSWORD_UNAVAILABLE",
      );
      expect(lastMessageNamed("ENCRYPT_ACCOUNT")).toBeUndefined();
    });
  });
});
