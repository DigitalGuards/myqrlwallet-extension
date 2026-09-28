import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * H1 (PR #71 audit): initializePhishingDetector() must never reject, no
 * matter which of its three blocklist sources (a fresh remote fetch, the
 * persistent cache, the bundled snapshot) is unavailable or malformed.
 * serviceWorker.ts awaits this before resolving serviceWorkerReady, and a
 * rejection there used to leave every dApp connection waiting on that
 * promise hanging forever - see serviceWorker.startupResilience.test.ts
 * for the end-to-end version of that scenario.
 */

const localStore: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const clearLocalStore = () => {
  for (const key of Object.keys(localStore)) delete localStore[key];
};

describe("phishingDetector (H1)", () => {
  beforeEach(() => {
    vi.resetModules();
    clearLocalStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the bundled snapshot, without throwing, when the cache is empty and the network is unreachable", async () => {
    const { initializePhishingDetector, getPhishingDetectorStatus } =
      await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();

    expect(getPhishingDetectorStatus()).toBe("ready");
  });

  it("discards a cached entry with a non-array blacklist before it ever reaches the detector", async () => {
    localStore.PHISHING_BLOCKLIST_CACHE = {
      config: { blacklist: "not-an-array" },
      timestamp: Date.now(),
    };
    const { initializePhishingDetector, getPhishingDetectorStatus } =
      await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();

    // The invalid entry was discarded (not handed to createDetector), so
    // this only succeeds via the bundled fallback - status is still
    // "ready": it never gets stuck on "initializing" or throws out of the
    // function.
    expect(getPhishingDetectorStatus()).toBe("ready");
  });

  it("discards a cached entry that is not an object at all", async () => {
    localStore.PHISHING_BLOCKLIST_CACHE = {
      config: "not-even-an-object",
      timestamp: Date.now(),
    };
    const { initializePhishingDetector, getPhishingDetectorStatus } =
      await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();
    expect(getPhishingDetectorStatus()).toBe("ready");
  });

  it("never rejects when storage.local.get itself throws", async () => {
    const browserModule = await import("webextension-polyfill");
    (browserModule.default.storage.local.get as any).mockRejectedValueOnce(
      new Error("storage exploded"),
    );
    const { initializePhishingDetector, getPhishingDetectorStatus } =
      await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();
    expect(getPhishingDetectorStatus()).toBe("ready");
  });

  it("never rejects when the remote fetch returns a shape that is not a usable config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(["not", "an", "object"]),
      }),
    );
    const { initializePhishingDetector, getPhishingDetectorStatus } =
      await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();
    // Falls through the invalid remote payload to the bundled snapshot.
    expect(getPhishingDetectorStatus()).toBe("ready");
  });

  it("uses a valid remote config even if persisting it to the cache afterwards fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            whitelist: [],
            blacklist: ["phish.example"],
            fuzzylist: [],
            tolerance: 2,
          }),
      }),
    );
    const browserModule = await import("webextension-polyfill");
    (browserModule.default.storage.local.set as any).mockRejectedValueOnce(
      new Error("quota exceeded"),
    );
    const {
      initializePhishingDetector,
      getPhishingDetectorStatus,
      checkDomain,
    } = await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();

    expect(getPhishingDetectorStatus()).toBe("ready");
    expect(checkDomain("https://phish.example").isDomainPhishing).toBe(true);
  });

  it("reports 'unavailable' when every source fails to build a detector at all, without throwing", async () => {
    vi.doMock("eth-phishing-detect/src/detector", () => ({
      default: class {
        constructor() {
          throw new Error("detector construction always fails");
        }
      },
    }));
    const {
      initializePhishingDetector,
      getPhishingDetectorStatus,
      checkDomain,
    } = await import("./phishingDetector");

    await expect(initializePhishingDetector()).resolves.toBeUndefined();

    expect(getPhishingDetectorStatus()).toBe("unavailable");
    // checkDomain() already fails open on a null detector (pre-existing
    // behaviour): a dApp request still gets a real answer, with the
    // degraded status visible in the result for the UI to warn on.
    const result = checkDomain("https://example.com");
    expect(result.isDomainPhishing).toBe(false);
    expect(result.detectorStatus).toBe("unavailable");
  });
});
