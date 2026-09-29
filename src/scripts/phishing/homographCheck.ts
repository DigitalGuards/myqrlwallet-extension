/**
 * Homograph (IDN lookalike) detection for the QRL domains we protect.
 *
 * WHY THE FUZZYLIST CANNOT DO THIS
 * checkDomain() feeds the detector `new URL(url).hostname`, which the URL
 * parser has already converted to ASCII, so a Unicode lookalike such as
 * qrlwallet.com written with a Cyrillic "а" arrives as xn--qrlwllet-x5d.com.
 * The detector's levenshtein distance is then measured against that punycode
 * form, where it is meaningless: the string no longer resembles the domain a
 * human sees in the address bar at all.
 *
 * WHAT THIS DOES INSTEAD
 * Decode every punycode label back to Unicode, fold the well-known confusable
 * characters onto one ASCII skeleton, and require the skeleton of the
 * registrable domain to be *exactly* the skeleton of a protected domain.
 * Exact skeleton equality keeps false positives near zero, and unlike an edit
 * distance it does not care how many characters were substituted:
 * qrlwaIIet.com (two capital i's, two edits away) is caught just as reliably
 * as one substitution.
 *
 * THE CONFUSABLE TABLE IS A CURATED APPROXIMATION.
 * It is not the Unicode confusables data file. It covers the Cyrillic, Greek
 * and digit lookalikes that appear in real homograph attacks on Latin brands,
 * which is what our labels are made of. A script outside the table gets no
 * folding and the domain falls through to the other checks. Keep the table
 * short, sorted by code point, and comment every entry: a wrong entry silently
 * merges two unrelated domains.
 */

import registrableDomain from "../../utilities/registrableDomain";

/**
 * Sequences that look like a single character when rendered. Applied before
 * the single-character table, so "corn" folds to "com".
 */
const CONFUSABLE_SEQUENCES: ReadonlyArray<readonly [string, string]> = [
  ["rn", "m"], // an "r" hard against an "n" reads as an "m" at any size
];

/**
 * Single characters folded onto one ASCII skeleton character. Sorted by the
 * code point of the key. Note that "i" folds onto "l": the two are
 * interchangeable in most sans-serif faces, which is exactly what qrlwaIlet.com
 * relies on.
 */
const CONFUSABLE_CHARACTERS: Readonly<Record<string, string>> = {
  "0": "o", // U+0030 digit zero
  "1": "l", // U+0031 digit one
  i: "l", // U+0069 latin i, indistinguishable from l in most sans-serif faces
  "|": "l", // U+007C vertical line
  α: "a", // greek alpha
  ν: "v", // greek nu
  ο: "o", // greek omicron
  ρ: "p", // greek rho
  а: "a", // cyrillic a
  е: "e", // cyrillic ie
  о: "o", // cyrillic o
  р: "p", // cyrillic er
  с: "c", // cyrillic es
  у: "y", // cyrillic u
  х: "x", // cyrillic ha
  ѕ: "s", // cyrillic dze
  і: "l", // cyrillic byelorussian-ukrainian i, folded like latin i
  ј: "j", // cyrillic je
};

/** Punycode (RFC 3492) parameters, for the ACE labels the URL parser emits. */
const PUNYCODE_PREFIX = "xn--";
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = "-";
const MAX_CODE_POINT = 0x10ffff;

/** Value of one base-36 digit, or BASE when the character is not a digit. */
function basicToDigit(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26;
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41;
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61;
  return BASE;
}

/** RFC 3492 bias adaptation. */
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let scaled = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > ((BASE - TMIN) * TMAX) / 2) {
    scaled = Math.floor(scaled / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * scaled) / (scaled + SKEW));
}

/**
 * Decodes one punycode label back to Unicode. Anything malformed is returned
 * unchanged: a hostname the URL parser accepted but this decoder cannot read
 * must not become an exception on the dApp approval path.
 */
export function decodePunycodeLabel(label: string): string {
  const lower = label.toLowerCase();
  if (!lower.startsWith(PUNYCODE_PREFIX)) return label;

  const input = lower.slice(PUNYCODE_PREFIX.length);
  const output: number[] = [];
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;

  const lastDelimiter = input.lastIndexOf(DELIMITER);
  if (lastDelimiter > 0) {
    for (let index = 0; index < lastDelimiter; index += 1) {
      output.push(input.charCodeAt(index));
    }
  }

  let index = lastDelimiter > 0 ? lastDelimiter + 1 : 0;
  while (index < input.length) {
    const previousI = i;
    let weight = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return label;
      const digit = basicToDigit(input.charCodeAt(index));
      index += 1;
      if (digit >= BASE) return label;
      i += digit * weight;
      if (!Number.isSafeInteger(i)) return label;
      const threshold = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < threshold) break;
      weight *= BASE - threshold;
      if (!Number.isSafeInteger(weight)) return label;
    }
    const outputLength = output.length + 1;
    bias = adapt(i - previousI, outputLength, previousI === 0);
    n += Math.floor(i / outputLength);
    i %= outputLength;
    if (n > MAX_CODE_POINT) return label;
    output.splice(i, 0, n);
    i += 1;
  }

  // "xn--" on its own decodes to nothing. An empty label would change the
  // shape of the hostname, so hand the original back.
  if (output.length === 0) return label;

  try {
    return String.fromCodePoint(...output);
  } catch {
    return label;
  }
}

/** Decodes every punycode label of a hostname. */
export function decodeHostname(hostname: string): string {
  return hostname.split(".").map(decodePunycodeLabel).join(".");
}

/**
 * Folds a string onto its ASCII skeleton using the curated table above.
 * Exported so the tests can assert the table entry by entry.
 */
export function foldConfusables(value: string): string {
  let folded = value.toLowerCase();
  for (const [sequence, replacement] of CONFUSABLE_SEQUENCES) {
    folded = folded.split(sequence).join(replacement);
  }
  let skeleton = "";
  for (const character of folded) {
    skeleton += CONFUSABLE_CHARACTERS[character] ?? character;
  }
  return skeleton;
}

export type HomographMatch = {
  /** The protected domain this hostname is a lookalike of. */
  matchedDomain: string;
  /** The registrable domain in its decoded, human-visible form. */
  decodedDomain: string;
};

/**
 * Returns the protected domain a hostname impersonates through confusable
 * characters, or null. The comparison runs on the registrable domain, so
 * subdomains of a lookalike are caught too, and a hostname that decodes to a
 * protected domain exactly is never reported: that is the real site.
 */
export function findHomographMatch(
  hostname: string,
  protectedDomains: readonly string[],
): HomographMatch | null {
  const decoded = decodeHostname(hostname.toLowerCase());
  const candidate = registrableDomain(decoded);
  if (protectedDomains.includes(candidate)) return null;

  const skeleton = foldConfusables(candidate);
  for (const domain of protectedDomains) {
    if (skeleton === foldConfusables(domain)) {
      return { matchedDomain: domain, decodedDomain: candidate };
    }
  }
  return null;
}

export default findHomographMatch;
