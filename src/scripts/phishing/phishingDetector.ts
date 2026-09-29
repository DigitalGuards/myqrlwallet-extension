import PhishingDetector from "eth-phishing-detect/src/detector";
import browser from "webextension-polyfill";
// Snapshot of MetaMask's eth-phishing-detect config taken at build time.
// Acts as a cold-start fallback when the network fetch and the persistent
// cache are both unavailable, so the wallet always has a baseline blocklist
// to consult before the dApp approval popup renders.
import bundledPhishingConfig from "./defaultPhishingConfig.json";
import { findHomographMatch } from "./homographCheck";
// Locally maintained QRL-ecosystem config, applied alongside whichever
// MetaMask config is in use.
import {
  LENIENT_SUFFIX_DOMAINS,
  PROTECTED_QRL_DOMAINS,
  QRL_FUZZY_DOMAINS,
  QRL_PHISHING_CONFIG,
} from "./qrlPhishingConfig";
import registrableDomain from "../../utilities/registrableDomain";

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

const QRL_FUZZY_DOMAIN_SET = new Set(QRL_FUZZY_DOMAINS);
const LENIENT_SUFFIX_DOMAIN_SET = new Set(LENIENT_SUFFIX_DOMAINS);

/**
 * How far a public suffix may sit from the protected one and still count as a
 * lookalike of it: quantaswap.i0 and zondscan.co are one edit from .io and
 * .com, while .org and .net are a different registration entirely.
 */
const SUFFIX_LOOKALIKE_DISTANCE = 1;

/** Levenshtein distance. Inputs here are single labels or public suffixes. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Splits a host into its registrable label and the public suffix under it. */
function splitRegistrableDomain(
  host: string,
): { label: string; suffix: string } | null {
  const registrable = registrableDomain(host);
  const boundary = registrable.indexOf(".");
  if (boundary <= 0 || boundary === registrable.length - 1) return null;
  return {
    label: registrable.slice(0, boundary),
    suffix: registrable.slice(boundary + 1),
  };
}

/**
 * True when a fuzzy verdict says nothing more than "same label, different
 * public suffix" for one of the informational domains.
 *
 * The detector strips the public suffix before measuring its distance, so
 * theqrl.com scores 0 against theqrl.org and zondscan.io scores 0 against
 * zondscan.com. For an origin that can ask the wallet to sign, that is still
 * an attack and stays flagged. For a site that only informs, it is usually the
 * brand's own other registration or an unrelated explorer, and accusing it is
 * a reputational risk with no user benefit. A suffix within one edit of the
 * protected one (.co for .com, .i0 for .io) is a lookalike of the suffix
 * itself, so it stays flagged.
 */
function isTolerablePublicSuffixSwap(
  hostname: string,
  matchedDomain: string,
): boolean {
  if (!LENIENT_SUFFIX_DOMAIN_SET.has(matchedDomain)) return false;
  const source = splitRegistrableDomain(hostname);
  const target = splitRegistrableDomain(matchedDomain);
  if (source === null || target === null) return false;
  // A different label is a real lookalike (theqr1.org), whatever the suffix.
  if (source.label !== target.label) return false;
  // Identical domain: the allowlist owns that case, so treat it as a lookalike
  // here and let the earlier allowlist pass speak for the real site.
  if (source.suffix === target.suffix) return false;
  return editDistance(source.suffix, target.suffix) > SUFFIX_LOOKALIKE_DISTANCE;
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

    // An allowlist pass is authoritative, in either config.
    if (result.type === "allowlist") {
      return {
        isDomainPhishing: false,
        matchType: result.type,
        matchedDomain: result.match,
        detectorStatus,
      };
    }

    // Only our own fuzzy verdicts are re-examined. MetaMask's list keeps its
    // own tolerance and its own judgement.
    const isOurFuzzyVerdict =
      result.type === "fuzzy" &&
      result.match !== undefined &&
      QRL_FUZZY_DOMAIN_SET.has(result.match);
    const isSuffixSwap =
      isOurFuzzyVerdict &&
      result.match !== undefined &&
      isTolerablePublicSuffixSwap(hostname, result.match);

    if (result.result && !isSuffixSwap) {
      return {
        isDomainPhishing: true,
        matchType: result.type,
        matchedDomain: result.match,
        detectorStatus,
      };
    }

    // Nothing the levenshtein path can decide. The hostname the URL parser
    // handed us is already punycoded, so a Unicode lookalike only becomes
    // visible after decoding and folding confusables.
    const homograph = findHomographMatch(hostname, PROTECTED_QRL_DOMAINS);
    if (homograph !== null) {
      return {
        isDomainPhishing: true,
        matchType: "homograph",
        matchedDomain: homograph.matchedDomain,
        detectorStatus,
      };
    }

    return { isDomainPhishing: false, detectorStatus };
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
