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
 * before any blocklist or fuzzylist is consulted, and an allowlist entry also
 * covers every subdomain of it (dev.qrlwallet.com). The fuzzylist match is a
 * levenshtein distance computed on the domain *with its public suffix
 * stripped*, so qrlwallet.com and qrlwallet.xyz are distance 0 apart and every
 * domain we protect has to appear in the allowlist as well, or it would match
 * its own fuzzylist entry and be reported as phishing.
 *
 * THE THREE LISTS BELOW
 * - PROTECTED_QRL_DOMAINS: everything we operate. All of it is allowlisted and
 *   all of it is compared against by the homograph check in homographCheck.ts.
 * - SIGNING_ORIGIN_DOMAINS + INFORMATIONAL_DOMAINS: the subset of the above
 *   that is worth a fuzzylist entry, split by how a near miss is treated.
 *   A lookalike of a signing origin is always phishing. A lookalike of an
 *   informational site is phishing only when it is a lookalike of the label
 *   too, because these brands legitimately appear under several public
 *   suffixes (see checkDomain() in phishingDetector.ts).
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
 * homograph check, which folds confusables and requires an exact match.
 */

/**
 * Origins that can ask this wallet to connect, sign or send. Impersonating one
 * of these costs the user funds, so any near miss is treated as an attack,
 * including the same label under a different public suffix. Sorted.
 */
const SIGNING_ORIGIN_DOMAINS = [
  "myqrlwallet.com",
  "qrlwallet.com",
  "quantapool.com",
  "quantapool.io",
  "quantaswap.io",
];

/**
 * Sites that only inform: they hold no key, ask for no signature and raise no
 * approval prompt. They are still worth a fuzzylist entry against character
 * substitution (theqr1.org, zondscan.co), and a copy of the same label under
 * another public suffix is treated as clean, because these brands really do
 * appear under several of them and flagging theqrl.com or a third-party
 * explorer on zondscan's label is a reputational risk with no user benefit.
 *
 * Residual, recorded deliberately: zondscan.com also hosts the dApp
 * example, so a copy of its label under another suffix could host a hostile
 * dApp and this tier lets that one shape through. Character substitutions
 * on the label and every homograph form stay flagged, and the approval
 * screen shows the registrable domain of whatever is asking. Move it to
 * SIGNING_ORIGIN_DOMAINS to trade that back for flagging third-party
 * explorers on the same label.
 * Sorted.
 */
const INFORMATIONAL_DOMAINS = ["theqrl.org", "zondscan.com"];

/**
 * Ours, allowlisted and homograph-protected, with no fuzzylist entry.
 * quantastark.com documents a verifier library and never asks the wallet for
 * anything, while its label sits one edit from ordinary product names
 * (quantastack, quantastar), so a fuzzylist entry for it only produced
 * accusations against unrelated businesses.
 */
const NON_FUZZY_QRL_DOMAINS = ["quantastark.com"];

/**
 * Real sites run by other people in the QRL ecosystem. Allowlisted so that no
 * fuzzylist entry of ours can ever flag them. Sorted.
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
  // Serves the same site as theqrl.org, the foundation's main domain.
  "theqrl.com",
];

/**
 * Every registrable domain we operate. Feeds the allowlist and the homograph
 * comparison. Sorted.
 */
export const PROTECTED_QRL_DOMAINS = [
  ...SIGNING_ORIGIN_DOMAINS,
  ...INFORMATIONAL_DOMAINS,
  ...NON_FUZZY_QRL_DOMAINS,
].sort();

/**
 * The fuzzylist: the domains a levenshtein near miss is measured against.
 */
export const QRL_FUZZY_DOMAINS = [
  ...SIGNING_ORIGIN_DOMAINS,
  ...INFORMATIONAL_DOMAINS,
].sort();

/**
 * The fuzzylist entries where a same-label-different-suffix hit is not
 * phishing. checkDomain() consults this after the detector answers.
 */
export const LENIENT_SUFFIX_DOMAINS = [...INFORMATIONAL_DOMAINS];

export const QRL_PHISHING_CONFIG = {
  name: "QRL",
  version: 2,
  tolerance: 1,
  // Nothing is blocked outright here. Known-bad QRL domains would go in this
  // list; the fuzzylist is what catches lookalikes that nobody has reported
  // yet.
  blocklist: [] as string[],
  allowlist: [...PROTECTED_QRL_DOMAINS, ...THIRD_PARTY_QRL_DOMAINS],
  fuzzylist: [...QRL_FUZZY_DOMAINS],
};

export default QRL_PHISHING_CONFIG;
