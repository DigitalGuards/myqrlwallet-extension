/**
 * registrableDomain: best-effort "eTLD+1" for display on the dApp approval
 * screen.
 *
 * WHY THIS EXISTS
 * The approval popup is 368px wide and its content lives inside the wallet's
 * one scroll region, which is `overflow-x-hidden`. A long hostname is clipped
 * with no scrollbar and no ellipsis, so an origin such as
 * `https://qrlwallet.com.attacker.example` shows only its leading,
 * trustworthy-looking part while the label that actually owns the page sits
 * off-screen. Pulling the registrable domain onto its own prominent line
 * makes that last, load-bearing label the first thing the user reads.
 *
 * THIS IS A HEURISTIC AND A DISPLAY AID ONLY.
 * The extension bundles no public-suffix list (there is no `psl` dependency,
 * and eth-phishing-detect ships none either), so this approximates the
 * boundary with a short hardcoded table of common multi-part suffixes. It
 * will be wrong for suffixes outside that table. NO TRUST, SECURITY OR
 * PERMISSION DECISION MAY BE BASED ON ITS RESULT. Every caller must keep the
 * full origin visible next to it so the user can always read the real thing.
 *
 * MAINTAINING THE TABLE
 * Keep it short and sorted. Entries are full suffix strings of two or more
 * labels; the longest matching entry wins and one more label is taken from
 * the host. Adding an entry only changes what is emphasised on screen.
 */

/**
 * A maintained approximation of the multi-part public suffixes our users are
 * most likely to meet: country-code second-level domains plus the handful of
 * hosting platforms that hand out a subdomain per project, where the project
 * label carries the identity that matters. Sorted.
 */
const MULTI_PART_PUBLIC_SUFFIXES = [
  "ac.uk",
  "co.in",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sg",
  "com.tr",
  "firebaseapp.com",
  "github.io",
  "gov.uk",
  "herokuapp.com",
  "ipfs.dweb.link",
  "net.au",
  "netlify.app",
  "on.fleek.co",
  "org.au",
  "org.uk",
  "pages.dev",
  "vercel.app",
  "web.app",
  "workers.dev",
];

const SUFFIX_SET = new Set(MULTI_PART_PUBLIC_SUFFIXES);
const LONGEST_SUFFIX_LABELS = MULTI_PART_PUBLIC_SUFFIXES.reduce(
  (longest, suffix) => Math.max(longest, suffix.split(".").length),
  2,
);

/** Dotted-quad IPv4 literal, for example 203.0.113.7. */
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Characters that can never appear inside a bare hostname. */
const NOT_A_HOSTNAME = /[\s/\\?#@]/;

const extractHostname = (input: string): string | null => {
  if (input.includes("://")) {
    try {
      return new URL(input).hostname;
    } catch {
      return null;
    }
  }
  return input;
};

/**
 * Returns the registrable domain (eTLD+1 under the heuristic described at the
 * top of this file) of a hostname or absolute URL.
 *
 * IP literals, bracketed IPv6 literals and single-label hosts such as
 * `localhost` are returned as they are. Anything that cannot be read as a
 * hostname is returned unchanged, so the caller always has something to show.
 */
export function registrableDomain(hostnameOrUrl: string): string {
  const trimmed = hostnameOrUrl.trim();
  if (trimmed === "") return hostnameOrUrl;

  const extracted = extractHostname(trimmed);
  if (extracted === null) return hostnameOrUrl;

  // A trailing dot is a valid fully-qualified form and carries no meaning
  // for display.
  const host = extracted.replace(/\.+$/, "").toLowerCase();
  if (host === "" || NOT_A_HOSTNAME.test(host)) return hostnameOrUrl;

  // Bracketed IPv6 literal, for example [2001:db8::1].
  if (host.startsWith("[") && host.endsWith("]")) return host;
  if (IPV4_LITERAL.test(host)) return host;

  const labels = host.split(".");
  // Single-label hosts (localhost, an intranet name) and empty labels
  // ("a..b") have no registrable boundary to find.
  if (labels.length < 2 || labels.some((label) => label === "")) return host;

  // Longest matching multi-part suffix wins, so on.fleek.co beats a
  // hypothetical fleek.co entry.
  const maxLabels = Math.min(LONGEST_SUFFIX_LABELS, labels.length - 1);
  for (let size = maxLabels; size >= 2; size -= 1) {
    const candidate = labels.slice(labels.length - size).join(".");
    if (SUFFIX_SET.has(candidate)) {
      return labels.slice(labels.length - size - 1).join(".");
    }
  }

  return labels.slice(labels.length - 2).join(".");
}

export default registrableDomain;
