/**
 * A locally maintained phishing config for the QRL ecosystem.
 *
 * MetaMask's eth-phishing-detect config protects ethereum-ecosystem brands,
 * so a lookalike of a QRL domain (qrlwaIlet.com with a capital i, qr1wallet.com,
 * zondscan.co) passes its fuzzylist untouched. This config is handed to the
 * detector alongside the MetaMask one so those lookalikes are caught too.
 *
 * WHY EVERY DOMAIN APPEARS TWICE
 * PhishingDetector walks every config's `allowlist` first, across all configs,
 * before any blocklist or fuzzylist is consulted. The fuzzylist match is a
 * levenshtein distance, so a protected domain matches its own fuzzylist entry
 * at distance 0 and would be flagged as phishing. Listing it in `allowlist`
 * too makes the real domain (and any subdomain of it, for example
 * dev.qrlwallet.com) return early as an allowlist pass. Both lists are
 * therefore kept identical.
 *
 * TO ADD A DOMAIN
 * Add its registrable domain (no scheme, no www, no subdomain) to the
 * PROTECTED_QRL_DOMAINS array below, which feeds both lists, and add a test
 * to phishingDetector.test.ts covering the real domain and one plausible
 * lookalike of it.
 *
 * TOLERANCE
 * 2 is deliberately tighter than the detector's default of 3: these names are
 * short, and a distance of 3 starts matching unrelated domains.
 */

/**
 * Registrable domains of the QRL ecosystem and the wider project family that
 * a phishing page is likely to impersonate. Sorted.
 */
const PROTECTED_QRL_DOMAINS = [
  "myqrlwallet.com",
  "qrlwallet.com",
  "quantapool.com",
  "quantapool.io",
  "quantaswap.io",
  "quantastark.com",
  "theqrl.org",
  "zondscan.com",
];

export const QRL_PHISHING_CONFIG = {
  name: "QRL",
  version: 1,
  tolerance: 2,
  // Nothing is blocked outright here. Known-bad QRL domains would go in this
  // list; the fuzzylist is what catches lookalikes that nobody has reported
  // yet.
  blocklist: [] as string[],
  // Identical lists on purpose. See the note at the top of this file.
  allowlist: [...PROTECTED_QRL_DOMAINS],
  fuzzylist: [...PROTECTED_QRL_DOMAINS],
};

export default QRL_PHISHING_CONFIG;
