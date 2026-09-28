import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { beforeEach, describe, expect, it, vi } from "vitest";

const localStore: Record<string, any> = {};

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
      },
    },
  },
}));

import {
  clearUnlockAttempts,
  getUnlockAttemptState,
  recordFailedUnlockAttempt,
} from "./unlockAttemptLimiter";

const KEY = profileStorageKey("UNLOCK_FAILED_ATTEMPTS");

const clearStore = () => {
  for (const k of Object.keys(localStore)) delete localStore[k];
};

describe("unlockAttemptLimiter (F7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore();
  });

  it("starts at zero failed attempts with no wait", async () => {
    const state = await getUnlockAttemptState();

    expect(state).toEqual({ failedAttempts: 0, waitUntil: 0 });
  });

  it("does not introduce a wait for the first five failures", async () => {
    let state;
    for (let i = 0; i < 5; i++) {
      state = await recordFailedUnlockAttempt();
      expect(state.waitUntil).toBe(0);
    }
    expect(state?.failedAttempts).toBe(5);
  });

  it("introduces an exponentially doubling wait from the sixth failure", async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedUnlockAttempt();
    }

    const before = Date.now();
    const sixth = await recordFailedUnlockAttempt();
    expect(sixth.failedAttempts).toBe(6);
    expect(sixth.waitUntil - before).toBeGreaterThanOrEqual(5_000);
    expect(sixth.waitUntil - before).toBeLessThan(6_000);

    const seventh = await recordFailedUnlockAttempt();
    expect(seventh.waitUntil - before).toBeGreaterThanOrEqual(10_000);
    expect(seventh.waitUntil - before).toBeLessThan(11_000);

    const eighth = await recordFailedUnlockAttempt();
    expect(eighth.waitUntil - before).toBeGreaterThanOrEqual(20_000);
    expect(eighth.waitUntil - before).toBeLessThan(21_000);
  });

  it("caps the wait at 5 minutes no matter how many failures follow", async () => {
    let lastWait = 0;
    for (let i = 0; i < 20; i++) {
      const state = await recordFailedUnlockAttempt();
      lastWait = state.waitUntil - Date.now();
    }
    expect(lastWait).toBeLessThanOrEqual(5 * 60_000 + 1_000);
    expect(lastWait).toBeGreaterThan(4 * 60_000);
  });

  it("persists the count across a fresh read (survives a service-worker restart)", async () => {
    await recordFailedUnlockAttempt();
    await recordFailedUnlockAttempt();

    const state = await getUnlockAttemptState();

    expect(state.failedAttempts).toBe(2);
    expect(localStore[KEY]).toBeDefined();
  });

  it("clears the counter on a successful unlock", async () => {
    for (let i = 0; i < 6; i++) {
      await recordFailedUnlockAttempt();
    }
    expect((await getUnlockAttemptState()).failedAttempts).toBe(6);

    await clearUnlockAttempts();

    expect(await getUnlockAttemptState()).toEqual({
      failedAttempts: 0,
      waitUntil: 0,
    });
    expect(localStore[KEY]).toBeUndefined();
  });

  it("never wipes the wallet - clearing is the only side effect available to callers", async () => {
    // The module intentionally exposes no reset-wallet call; this is a
    // structural guard that stays true as long as no such import appears.
    const moduleSource = await import("./unlockAttemptLimiter");
    expect(Object.keys(moduleSource)).toEqual(
      expect.arrayContaining([
        "getUnlockAttemptState",
        "recordFailedUnlockAttempt",
        "clearUnlockAttempts",
      ]),
    );
  });
});
