/**
 * A locally maintained phishing config for the QRL ecosystem.
 *
 * MetaMask's eth-phishing-detect config protects ethereum-ecosystem brands,
 * so a lookalike of a QRL domain (qrlwaIlet.com with a capital i, qr1wallet.com,
 * zondscan.co) passes its fuzzylist untouched. This config is handed to the
 * detector alongside the MetaMask one so those lookalikes are caught too.
 *
 * HOW THE DETECTOR USES THESE LISTS
 * PhishingDetector walks every config's `allowlist` first, across all configs,
 * before any blocklist or fuzzylist is consulted. An allowlist entry matches
 * the domain itself *and every subdomain of it*: `matchPartsAgainstList()` in
 * eth-phishing-detect compares the entry's labels from the public suffix
 * inwards and ignores whatever extra labels the source carries. So listing
 * qrlwallet.com already covers dev.qrlwallet.com and quantaswap.io already
 * covers dev.quantaswap.io, and those staging hosts need no entry of their
 * own. Only registrable domains belong in these lists.
 *
 * The fuzzylist match is a levenshtein distance computed on the domain *with
 * its public suffix stripped*, so qrlwallet.com and qrlwallet.xyz are distance
 * 0 apart and every domain we protect has to appear in the allowlist as well,
 * or it would match its own fuzzylist entry and be reported as phishing.
 *
 * THE LISTS BELOW
 * - PROTECTED_BRAND_DOMAINS: the brands this config defends. Every one gets a
 *   fuzzylist entry, an allowlist entry, and a homograph comparison. A copy of
 *   one of these labels under another public suffix (zondscan.io, theqrl.net)
 *   is a prime phishing registration and is flagged, which is why the real
 *   sibling registrations of ours and of other people are named explicitly in
 *   the allowlist below.
 * - NON_FUZZY_QRL_DOMAINS: ours, allowlisted and homograph-protected, with no
 *   fuzzylist entry.
 * - THIRD_PARTY_QRL_DOMAINS: other people's real sites, allowlisted so we
 *   never accuse them. They are deliberately absent from the fuzzylist.
 *
 * TO ADD A DOMAIN
 * Add its registrable domain (no scheme, no www, no subdomain) to the list it
 * belongs in, and add a test to phishingDetector.test.ts covering the real
 * domain and one plausible lookalike of it.
 *
 * TOLERANCE
 * 1, down from the detector's default of 3 and from the 2 this config shipped
 * with first. Measured against the real detector, a tolerance of 2 over labels
 * this short matched unrelated businesses: quantascan (a third-party QRL
 * explorer) is 2 edits from quantaswap, and quantastar is 2 edits from it too.
 * The shortest label protected here is six characters, where two edits rewrite
 * a third of the name and stop meaning "lookalike". Visually deceptive
 * substitutions that need more than one edit (qrlwaIIet.com) are caught by the
 * homograph check, which folds confusables and requires an exact match on the
 * label.
 */

/**
 * The brands this config defends. Impersonating any of them costs the user
 * either funds or trust, so every near miss counts as an attack, including the
 * same label under a different public suffix.
 *
 * The detector strips the public suffix before measuring its distance, so two
 * registrations of one label (quantapool.com and quantapool.io) share a single
 * fuzzy form and the second entry widens no coverage. Both are listed because
 * both are real sites that the allowlist has to pass. Sorted.
 */
const PROTECTED_BRAND_DOMAINS = [
  "myqrlwallet.com",
  "qrlwallet.com",
  "quantapool.com",
  "quantapool.io",
  "quantaswap.io",
  // The planned mainnet block explorer, registered ahead of the cutover.
  "shorscan.com",
  "theqrl.org",
  "zondscan.com",
];

/**
 * Ours, allowlisted and homograph-protected, with no fuzzylist entry.
 * quantastark.com documents a verifier library and never asks the wallet for
 * anything, while its label sits one edit from ordinary product names
 * (quantastack, quantastar), so a fuzzylist entry for it only produced
 * accusations against unrelated businesses. The homograph check costs nothing
 * here because it demands an exact skeleton match on the label.
 */
const NON_FUZZY_QRL_DOMAINS = ["quantastark.com"];

/**
 * Real sites run by other people in the QRL ecosystem, and our own sibling
 * registrations of a protected label. Allowlisted by exact name so that no
 * fuzzylist entry of ours can ever flag them, which is what makes it safe to
 * treat every other public suffix on a protected label as phishing. Sorted.
 */
const THIRD_PARTY_QRL_DOMAINS = [
  // The QRL Foundation ("Die QRL Stiftung"), the non-profit that funds QRL
  // development. Named by the security review; verified as the foundation's
  // own site.
  "qrl.foundation",
  // Quantascan, a third-party QRL block explorer. Two edits from quantaswap
  // with the suffix stripped, so the fuzzylist used to report this real
  // competitor as a lookalike of ours.
  "quantascan.com",
  "quantascan.io",
  // Serves the same site as theqrl.org, the foundation's main domain. Distance
  // 0 from it once the suffix is stripped, so without this entry the fuzzylist
  // would accuse the foundation of impersonating itself.
  "theqrl.com",
];

/**
 * Every registrable domain of ours plus the brands we defend. Feeds the
 * allowlist and the homograph comparison. Sorted.
 */
export const PROTECTED_QRL_DOMAINS = [
  ...PROTECTED_BRAND_DOMAINS,
  ...NON_FUZZY_QRL_DOMAINS,
].sort();

/**
 * The fuzzylist: the domains a levenshtein near miss is measured against.
 */
export const QRL_FUZZY_DOMAINS = [...PROTECTED_BRAND_DOMAINS].sort();

/**
 * Everything allowlisted by this config. The homograph check consults it too,
 * so a real site can never be reported as a lookalike of itself or of a
 * sibling registration.
 */
export const QRL_ALLOWLIST_DOMAINS = [
  ...PROTECTED_QRL_DOMAINS,
  ...THIRD_PARTY_QRL_DOMAINS,
].sort();

export const QRL_PHISHING_CONFIG = {
  name: "QRL",
  version: 3,
  tolerance: 1,
  // Nothing is blocked outright here. Known-bad QRL domains would go in this
  // list; the fuzzylist is what catches lookalikes that nobody has reported
  // yet.
  blocklist: [] as string[],
  allowlist: [...QRL_ALLOWLIST_DOMAINS],
  fuzzylist: [...QRL_FUZZY_DOMAINS],
};

export default QRL_PHISHING_CONFIG;
