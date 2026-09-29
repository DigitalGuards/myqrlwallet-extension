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

/**
 * L7b: MetaMask's eth-phishing-detect config protects ethereum-ecosystem
 * brands, so a lookalike of a QRL domain used to sail through the detector.
 * The locally maintained QRL config is passed alongside it, which means these
 * assertions hold whichever source (remote, cache, bundled snapshot) supplied
 * the MetaMask half. These tests run on the bundled-snapshot path: fetch is
 * stubbed to reject and the cache is empty, so nothing touches the network.
 */
describe("phishingDetector QRL ecosystem coverage (L7b)", () => {
  beforeEach(() => {
    vi.resetModules();
    // The H1 suite above vi.doMock()s the detector class with a constructor
    // that always throws. vi.resetModules() clears the module registry and
    // leaves that mock registered, so it has to be dropped explicitly.
    vi.doUnmock("eth-phishing-detect/src/detector");
    clearLocalStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const loadReadyDetector = async () => {
    const module = await import("./phishingDetector");
    await module.initializePhishingDetector();
    expect(module.getPhishingDetectorStatus()).toBe("ready");
    return module;
  };

  it.each([
    // Capital i standing in for a lowercase L, lowercased by URL parsing.
    ["https://qrlwaIlet.com", "qrlwallet.com"],
    ["https://qr1wallet.com", "qrlwallet.com"],
    ["https://zondscan.co", "zondscan.com"],
    ["https://quantaswap.i0", "quantaswap.io"],
    ["https://myqr1wallet.com", "myqrlwallet.com"],
    ["https://theqr1.org", "theqrl.org"],
    ["https://sh0rscan.com", "shorscan.com"],
  ])("flags the lookalike %s as fuzzy phishing", async (url, expectedMatch) => {
    const { checkDomain } = await loadReadyDetector();

    const result = checkDomain(url);

    expect(result.isDomainPhishing).toBe(true);
    expect(result.matchType).toBe("fuzzy");
    expect(result.matchedDomain).toBe(expectedMatch);
  });

  it.each([
    "https://qrlwallet.com",
    "https://dev.qrlwallet.com",
    "https://myqrlwallet.com",
    "https://theqrl.org",
    "https://zondscan.com",
    "https://explorer.zondscan.com",
    "https://quantaswap.io",
    "https://dev.quantaswap.io",
    "https://quantapool.com",
    "https://quantapool.io",
    "https://quantastark.com",
    "https://shorscan.com",
  ])("passes the real QRL domain %s clean", async (url) => {
    const { checkDomain } = await loadReadyDetector();

    const result = checkDomain(url);

    expect(result.isDomainPhishing).toBe(false);
  });

  it.each([
    "https://example.com",
    "https://en.wikipedia.org",
    "https://github.com",
  ])("leaves the unrelated domain %s alone", async (url) => {
    const { checkDomain } = await loadReadyDetector();

    const result = checkDomain(url);

    expect(result.isDomainPhishing).toBe(false);
  });
});

/**
 * L-7: the first cut of the QRL config ran a tolerance of 2 over a fuzzylist
 * that held every domain we operate. Measured against the real detector, that
 * accused a list of real, unrelated sites: quantascan.io and quantascan.com (a
 * third-party QRL explorer), theqrl.com, theqrl.net, zondscan.io,
 * zondscan.org, quantastack.com and quantastar.com. Three changes answer it,
 * and all of them are exercised here through the real detector:
 *
 * 1. Every real site that shares a protected label is allowlisted by exact
 *    name in qrlPhishingConfig.ts: the foundation's theqrl.com, the
 *    third-party explorer quantascan, and our own sibling registrations.
 * 2. The tolerance is 1 and quantastark.com left the fuzzylist, so ordinary
 *    product names one edit away (quantastack, quantastar) are left alone.
 * 3. A homograph check decodes punycode and folds confusables, catching what
 *    a levenshtein distance over an xn-- string never could.
 *
 * A copy of a protected label under another public suffix stays phishing. The
 * earlier tier that treated that as clean for the informational domains was
 * rejected on review: registering our brand under a second suffix is the
 * classic phishing setup, and the allowlist is where a legitimate variant
 * belongs.
 */
describe("phishingDetector lookalike precision (L-7)", () => {
  beforeEach(() => {
    vi.resetModules();
    // The H1 suite vi.doMock()s the detector class with a constructor that
    // always throws. vi.resetModules() clears the module registry and leaves
    // that mock registered, so it has to be dropped explicitly.
    vi.doUnmock("eth-phishing-detect/src/detector");
    clearLocalStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const loadReadyDetector = async () => {
    const module = await import("./phishingDetector");
    await module.initializePhishingDetector();
    expect(module.getPhishingDetectorStatus()).toBe("ready");
    return module;
  };

  /**
   * Punycodes a Unicode hostname exactly as a browser does before the origin
   * ever reaches checkDomain(), so these cases start from the same xn-- string
   * the extension sees in production.
   */
  const asBrowserHostname = (unicodeHost: string) =>
    new URL(`https://${unicodeHost}`).hostname;

  it.each([
    // Third-party QRL explorer. Two edits from quantaswap once the public
    // suffix is stripped, so the old tolerance of 2 flagged it. Allowlisted
    // by exact name, and its label differs from every protected one.
    "https://quantascan.io",
    "https://quantascan.com",
    // The foundation's other domain: distance 0 from theqrl.org on the label,
    // so it is only clean because the allowlist names it.
    "https://theqrl.com",
    // One and two edits from quantastark, which has left the fuzzylist.
    "https://quantastack.com",
    "https://quantastar.com",
  ])("no longer accuses the real third-party domain %s", async (url) => {
    const { checkDomain } = await loadReadyDetector();

    expect(checkDomain(url).isDomainPhishing).toBe(false);
  });

  it.each([
    ["https://zondscan.io", "zondscan.com"],
    ["https://zondscan.net", "zondscan.com"],
    ["https://qrlwallet.io", "qrlwallet.com"],
    ["https://theqrl.net", "theqrl.org"],
    ["https://quantaswap.com", "quantaswap.io"],
    ["https://quantapool.net", "quantapool.com"],
    ["https://shorscan.io", "shorscan.com"],
  ])(
    "flags %s, a protected label under another public suffix",
    async (url, expectedMatch) => {
      const { checkDomain } = await loadReadyDetector();

      const result = checkDomain(url);

      expect(result.isDomainPhishing).toBe(true);
      expect(result.matchedDomain).toBe(expectedMatch);
    },
  );

  it.each([
    // Capital i standing in for a lowercase L, lowercased by URL parsing.
    ["https://qrlwaIlet.com", "qrlwallet.com"],
    ["https://qr1wallet.com", "qrlwallet.com"],
    ["https://qrlwallet.net", "qrlwallet.com"],
    // A lookalike of the public suffix itself.
    ["https://quantaswap.i0", "quantaswap.io"],
    ["https://zondscan.co", "zondscan.com"],
    ["https://theqr1.org", "theqrl.org"],
    ["https://zondscam.com", "zondscan.com"],
  ])("still flags the lookalike %s", async (url, expectedMatch) => {
    const { checkDomain } = await loadReadyDetector();

    const result = checkDomain(url);

    expect(result.isDomainPhishing).toBe(true);
    expect(result.matchedDomain).toBe(expectedMatch);
  });

  it.each([
    // Cyrillic a (U+0430) for the latin a of qrlwallet.com.
    ["qrlwаllet.com", "qrlwallet.com"],
    // Cyrillic o (U+043E) for the latin o of zondscan.com.
    ["zоndscan.com", "zondscan.com"],
    // Cyrillic o twice, inside quantapool.com.
    ["quantapооl.com", "quantapool.com"],
  ])(
    "flags the punycoded homograph of %s as a homograph",
    async (unicodeHost, expectedMatch) => {
      const { checkDomain } = await loadReadyDetector();
      const hostname = asBrowserHostname(unicodeHost);
      // The detector only ever sees the ASCII form, where a levenshtein
      // distance against the protected domain is meaningless.
      expect(hostname.startsWith("xn--")).toBe(true);

      const result = checkDomain(`https://${hostname}`);

      expect(result.isDomainPhishing).toBe(true);
      expect(result.matchType).toBe("homograph");
      expect(result.matchedDomain).toBe(expectedMatch);
    },
  );

  it.each([
    // Cyrillic o inside zondscan, registered under .io.
    ["zоndscan.io", "zondscan.com"],
    // Cyrillic a inside quantaswap, registered under .com.
    ["quаntaswap.com", "quantaswap.io"],
    // Cyrillic o inside shorscan, registered under .io.
    ["shоrscan.io", "shorscan.com"],
  ])(
    "flags %s, a homograph that swapped the public suffix too",
    async (unicodeHost, expectedMatch) => {
      const { checkDomain } = await loadReadyDetector();
      const hostname = asBrowserHostname(unicodeHost);
      // Both halves of the disguise defeat the fuzzylist on their own: it
      // measures its distance over this xn-- string, and over the public
      // suffix it measures nothing at all.
      expect(hostname.startsWith("xn--")).toBe(true);

      const result = checkDomain(`https://${hostname}`);

      expect(result.isDomainPhishing).toBe(true);
      expect(result.matchType).toBe("homograph");
      expect(result.matchedDomain).toBe(expectedMatch);
    },
  );

  it("flags a homograph on a subdomain of the lookalike", async () => {
    const { checkDomain } = await loadReadyDetector();
    // Cyrillic a inside qrlwallet, with a subdomain in front of it.
    const hostname = asBrowserHostname("login.qrlwаllet.com");

    const result = checkDomain(`https://${hostname}`);

    expect(result.isDomainPhishing).toBe(true);
    expect(result.matchType).toBe("homograph");
    expect(result.matchedDomain).toBe("qrlwallet.com");
  });

  it.each([
    // Two capital i's: two edits, past the tolerance of 1, and caught by the
    // confusable folding instead.
    ["qrlwaIIet.com", "qrlwallet.com"],
    // "rn" reads as "m" at any size, and costs two edits.
    ["rnyqrlwallet.com", "myqrlwallet.com"],
  ])("flags the ASCII lookalike %s as a homograph", async (host, expected) => {
    const { checkDomain } = await loadReadyDetector();

    const result = checkDomain(`https://${host}`);

    expect(result.isDomainPhishing).toBe(true);
    expect(result.matchType).toBe("homograph");
    expect(result.matchedDomain).toBe(expected);
  });

  // Every name on the allowlist, plus a subdomain of each kind of entry.
  // `matchPartsAgainstList()` in eth-phishing-detect matches a subdomain of an
  // allowlist entry, so dev.qrlwallet.com and dev.quantaswap.io are covered by
  // their registrable domain and carry no entry of their own.
  it.each([
    "https://theqrl.org",
    "https://theqrl.com",
    "https://qrl.foundation",
    "https://quantascan.io",
    "https://quantascan.com",
    "https://explorer.quantascan.io",
    "https://qrlwallet.com",
    "https://dev.qrlwallet.com",
    "https://myqrlwallet.com",
    "https://zondscan.com",
    "https://explorer.zondscan.com",
    "https://quantaswap.io",
    "https://dev.quantaswap.io",
    "https://quantapool.com",
    "https://quantapool.io",
    "https://quantastark.com",
    "https://docs.quantastark.com",
    "https://shorscan.com",
  ])("passes the allowlisted domain %s clean", async (url) => {
    const { checkDomain } = await loadReadyDetector();

    expect(checkDomain(url).isDomainPhishing).toBe(false);
  });

  it.each([
    "https://example.com",
    "https://github.com",
    "https://en.wikipedia.org",
    // An ordinary internationalised domain is decoded and folded like any
    // other, and matches nothing.
    "https://münchen.example",
  ])("leaves the unrelated domain %s alone", async (url) => {
    const { checkDomain } = await loadReadyDetector();

    expect(checkDomain(url).isDomainPhishing).toBe(false);
  });
});
