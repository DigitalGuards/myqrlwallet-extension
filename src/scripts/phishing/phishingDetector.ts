import PhishingDetector from "eth-phishing-detect/src/detector";
import browser from "webextension-polyfill";
// Snapshot of MetaMask's eth-phishing-detect config taken at build time.
// Acts as a cold-start fallback when the network fetch and the persistent
// cache are both unavailable, so the wallet always has a baseline blocklist
// to consult before the dApp approval popup renders.
import bundledPhishingConfig from "./defaultPhishingConfig.json";
// Locally maintained QRL-ecosystem config, applied alongside whichever
// MetaMask config is in use.
import { QRL_PHISHING_CONFIG } from "./qrlPhishingConfig";

const PHISHING_CONFIG_URL =
  "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json";
const PHISHING_CACHE_KEY = "PHISHING_BLOCKLIST_CACHE";
const PHISHING_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
export const PHISHING_ALARM_NAME = "QRL_PHISHING_REFRESH";

export type PhishingDetectorStatus = "ready" | "initializing" | "unavailable";

export type PhishingCheckResult = {
  isDomainPhishing: boolean;
  matchType?: string;
  matchedDomain?: string;
  detectorStatus?: PhishingDetectorStatus;
};

type PhishingConfig = {
  whitelist?: string[];
  blacklist?: string[];
  fuzzylist?: string[];
  tolerance?: number;
};

type CachedConfig = {
  config: PhishingConfig;
  timestamp: number;
};

let detectorInstance: InstanceType<typeof PhishingDetector> | null = null;
let detectorStatus: PhishingDetectorStatus = "initializing";
let retryTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

export function getPhishingDetectorStatus(): PhishingDetectorStatus {
  return detectorStatus;
}

async function fetchRemoteConfig(): Promise<PhishingConfig | null> {
  try {
    const response = await fetch(PHISHING_CONFIG_URL);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn("QrlWeb3Wallet: Failed to fetch phishing blocklist", error);
    return null;
  }
}

// Shape-checks a value before it is trusted as a phishing blocklist: a
// corrupted or hand-edited storage.local entry must be discarded before it
// ever reaches createDetector, whose own failure mode (H1) used to leave
// initializePhishingDetector() throwing and skipped the bundled fallback.
function isValidPhishingConfig(value: unknown): value is PhishingConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  const isStringArrayOrUndefined = (field: unknown) =>
    field === undefined ||
    (Array.isArray(field) && field.every((item) => typeof item === "string"));
  return (
    isStringArrayOrUndefined(config.whitelist) &&
    isStringArrayOrUndefined(config.blacklist) &&
    isStringArrayOrUndefined(config.fuzzylist) &&
    (config.tolerance === undefined || typeof config.tolerance === "number")
  );
}

async function getCachedConfig(): Promise<CachedConfig | null> {
  try {
    const data = await browser.storage.local.get(PHISHING_CACHE_KEY);
    const cached = data?.[PHISHING_CACHE_KEY] as CachedConfig | undefined;
    if (
      !cached ||
      typeof cached.timestamp !== "number" ||
      !isValidPhishingConfig(cached.config)
    ) {
      return null;
    }
    return cached;
  } catch (error) {
    console.warn(
      "QrlWeb3Wallet: Failed to read the cached phishing blocklist",
      error,
    );
    return null;
  }
}

async function setCachedConfig(config: PhishingConfig): Promise<void> {
  try {
    const cached: CachedConfig = { config, timestamp: Date.now() };
    await browser.storage.local.set({ [PHISHING_CACHE_KEY]: cached });
  } catch (error) {
    // Non-fatal: the freshly fetched config is still used in-memory for
    // this session even if persisting it for next time failed.
    console.warn(
      "QrlWeb3Wallet: Failed to persist the phishing blocklist cache",
      error,
    );
  }
}

// Builds the detector from two configs: whichever MetaMask blocklist the
// caller managed to obtain (remote, cache, or the bundled snapshot) and our
// locally maintained QRL one. MetaMask's fuzzylist covers ethereum-ecosystem
// brands only, so without the second config a QRL-targeted lookalike domain
// is never flagged. PhishingDetector consults every config's allowlist before
// any blocklist or fuzzylist, so the order of the two entries changes nothing
// for allowlisted domains.
function createDetector(config: PhishingConfig) {
  return new PhishingDetector([
    {
      allowlist: config.whitelist ?? [],
      blocklist: config.blacklist ?? [],
      fuzzylist: config.fuzzylist ?? [],
      tolerance: config.tolerance ?? 3,
      name: "MetaMask",
      version: 1,
    },
    QRL_PHISHING_CONFIG,
  ]);
}

// Never lets a bad blocklist (remote, cached, or even the bundled snapshot)
// throw out of initializePhishingDetector(): H1's failure mode was exactly
// that, which left the module-level serviceWorkerReady promise in
// serviceWorker.ts unresolved and every dApp connection waiting on it
// hanging forever.
function createDetectorSafely(
  config: PhishingConfig,
): InstanceType<typeof PhishingDetector> | null {
  try {
    return createDetector(config);
  } catch (error) {
    console.warn(
      "QrlWeb3Wallet: Failed to build the phishing detector from a blocklist",
      error,
    );
    return null;
  }
}

// Exponential-backoff retry schedule when initial fetch + cache fetch both fail
// (F-4). Avoids waiting the full 24h alarm interval before retrying.
const RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
];
let retryAttempt = 0;

function scheduleRetry(): void {
  if (retryTimeoutHandle !== undefined) {
    clearTimeout(retryTimeoutHandle);
  }
  const delay =
    RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryTimeoutHandle = setTimeout(() => {
    retryAttempt += 1;
    void initializePhishingDetector();
  }, delay);
}

/**
 * Builds (or rebuilds) the phishing detector. Never rejects (H1): every
 * source it can draw a blocklist from - a fresh remote fetch, the
 * persistent cache, and the bundled snapshot - is validated and guarded
 * independently, so a bad response or a corrupted cache entry simply falls
 * through to the next source, with the function itself never throwing.
 * serviceWorker.ts awaits this before resolving serviceWorkerReady, and a
 * rejection there would leave every dApp connection waiting on that
 * promise hanging forever.
 */
export async function initializePhishingDetector(): Promise<void> {
  if (detectorInstance === null) {
    detectorStatus = "initializing";
  }
  const cached = await getCachedConfig();
  const isCacheStale =
    !cached || Date.now() - cached.timestamp > PHISHING_CACHE_TTL;

  if (isCacheStale) {
    const remoteConfig = await fetchRemoteConfig();
    if (remoteConfig && isValidPhishingConfig(remoteConfig)) {
      const detector = createDetectorSafely(remoteConfig);
      if (detector) {
        await setCachedConfig(remoteConfig);
        detectorInstance = detector;
        detectorStatus = "ready";
        retryAttempt = 0;
        return;
      }
    }
  }

  if (cached?.config) {
    const detector = createDetectorSafely(cached.config);
    if (detector) {
      detectorInstance = detector;
      detectorStatus = "ready";
      retryAttempt = 0;
      return;
    }
  }

  // Remote fetch and persistent cache were both unavailable, invalid, or
  // failed to build a detector. Fall back to the bundled snapshot so a
  // baseline blocklist is available whenever possible, then schedule a
  // retry to refresh against the live upstream.
  const fallbackDetector = createDetectorSafely(
    bundledPhishingConfig as PhishingConfig,
  );
  if (fallbackDetector) {
    detectorInstance = fallbackDetector;
    detectorStatus = "ready";
  } else {
    // Every source failed to even build a detector. The bundled snapshot
    // getting here should be effectively impossible in practice; nothing
    // above may throw regardless of how it happens. checkDomain() already
    // fails open when detectorInstance is null and reports this status, so
    // dApp approval still gets a real answer, with the degraded state
    // visible for the UI to warn on: the result never implies a clean
    // check on its own.
    detectorInstance = null;
    detectorStatus = "unavailable";
  }
  scheduleRetry();
}

export function checkDomain(url: string): PhishingCheckResult {
  if (!detectorInstance) {
    // Surface degraded state to the UI so the dApp request popup can warn the
    // user that phishing detection is unavailable, rather than implying a
    // clean check (F-4).
    return { isDomainPhishing: false, detectorStatus };
  }

  try {
    const hostname = new URL(url).hostname;

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return { isDomainPhishing: false, detectorStatus };
    }

    const result = detectorInstance.check(hostname);
    return {
      isDomainPhishing: result.result,
      matchType: result.type,
      matchedDomain: result.match,
      detectorStatus,
    };
  } catch {
    return { isDomainPhishing: false, detectorStatus };
  }
}

export async function setupPhishingRefreshAlarm(): Promise<void> {
  await browser.alarms.create(PHISHING_ALARM_NAME, {
    periodInMinutes: 24 * 60,
  });
}

export async function handlePhishingRefreshAlarm(): Promise<void> {
  await initializePhishingDetector();
}
