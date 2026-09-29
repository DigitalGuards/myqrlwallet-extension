import { describe, expect, it } from "vitest";

import {
  decodeHostname,
  decodePunycodeLabel,
  findHomographMatch,
  foldConfusables,
} from "./homographCheck";

/**
 * Unit coverage for the pieces checkDomain() leans on. The end-to-end
 * assertions, through the real eth-phishing-detect instance, live in
 * phishingDetector.test.ts.
 */

const PROTECTED = [
  "myqrlwallet.com",
  "qrlwallet.com",
  "quantapool.com",
  "quantapool.io",
  "quantastark.com",
  "quantaswap.io",
  "shorscan.com",
  "theqrl.org",
  "zondscan.com",
];

/**
 * What the detector allowlists: the protected domains plus the real sites that
 * share a protected label or sit close to one. findHomographMatch() checks
 * this before it reports anything.
 */
const ALLOWLISTED = [
  ...PROTECTED,
  "qrl.foundation",
  "quantascan.com",
  "quantascan.io",
  "theqrl.com",
];

/** Punycodes a Unicode hostname the way a browser does. */
const asBrowserHostname = (unicodeHost: string) =>
  new URL(`https://${unicodeHost}`).hostname;

describe("decodePunycodeLabel", () => {
  it("decodes a label the URL parser produced", () => {
    // Cyrillic a (U+0430) inside qrlwallet.
    const hostname = asBrowserHostname("qrlwаllet.com");

    expect(decodePunycodeLabel(hostname.split(".")[0])).toBe("qrlwаllet");
  });

  it("leaves a plain ASCII label untouched", () => {
    expect(decodePunycodeLabel("qrlwallet")).toBe("qrlwallet");
  });

  it("returns a malformed xn-- label unchanged, with no exception", () => {
    // "!" is not a base-36 digit, so the decoder bails out.
    expect(decodePunycodeLabel("xn--!!!")).toBe("xn--!!!");
    expect(decodePunycodeLabel("xn--")).toBe("xn--");
  });

  it("decodes every label of a hostname", () => {
    const hostname = asBrowserHostname("lоgin.qrlwallet.com");

    expect(decodeHostname(hostname)).toBe("lоgin.qrlwallet.com");
  });
});

describe("foldConfusables", () => {
  it.each([
    ["qrlwаllet.com", "qrlwallet.com"], // cyrillic a
    ["zоndscan.com", "zondscan.com"], // cyrillic o
    ["theсrl.org", "thecrl.org"], // cyrillic es folds to c
    ["qrlwaIIet.com", "qrlwallet.com"], // capital i folds onto l
    ["qr1wa11et.c0m", "qrlwallet.com"], // digits one and zero
    ["rnyqrlwallet.com", "myqrlwallet.com"], // rn reads as m
  ])("folds %s onto %s", (input, expected) => {
    expect(foldConfusables(input)).toBe(expected);
  });

  it("leaves a script it does not cover alone", () => {
    expect(foldConfusables("münchen.example")).toBe("münchen.example");
  });
});

describe("findHomographMatch", () => {
  it("matches a punycoded Cyrillic lookalike to the domain it impersonates", () => {
    const hostname = asBrowserHostname("quаntaswap.io");

    expect(findHomographMatch(hostname, PROTECTED)).toEqual({
      matchedDomain: "quantaswap.io",
      decodedDomain: "quаntaswap.io",
    });
  });

  it("compares the registrable domain, so a subdomain does not hide it", () => {
    const hostname = asBrowserHostname("app.zоndscan.com");

    expect(findHomographMatch(hostname, PROTECTED)?.matchedDomain).toBe(
      "zondscan.com",
    );
  });

  it.each([
    // Cyrillic o inside zondscan, registered under .io. The suffix swap used
    // to hide the substitution, because the comparison ran over the whole
    // domain and .io is not .com.
    ["zоndscan.io", "zondscan.com"],
    // Cyrillic a inside quantaswap, registered under .com.
    ["quаntaswap.com", "quantaswap.io"],
  ])(
    "matches %s, where a confusable and a suffix swap are combined",
    (unicodeHost, expected) => {
      const hostname = asBrowserHostname(unicodeHost);

      expect(
        findHomographMatch(hostname, PROTECTED, ALLOWLISTED)?.matchedDomain,
      ).toBe(expected);
    },
  );

  it("matches a protected label under any public suffix", () => {
    expect(
      findHomographMatch("zondscan.io", PROTECTED, ALLOWLISTED)?.matchedDomain,
    ).toBe("zondscan.com");
  });

  it("never reports a protected domain as a lookalike of itself", () => {
    for (const domain of PROTECTED) {
      expect(findHomographMatch(domain, PROTECTED)).toBeNull();
      expect(findHomographMatch(`www.${domain}`, PROTECTED)).toBeNull();
    }
  });

  it.each(["theqrl.com", "quantascan.io", "quantapool.io"])(
    "never reports the allowlisted %s as a lookalike",
    (hostname) => {
      expect(findHomographMatch(hostname, PROTECTED, ALLOWLISTED)).toBeNull();
      expect(
        findHomographMatch(`www.${hostname}`, PROTECTED, ALLOWLISTED),
      ).toBeNull();
    },
  );

  it.each([
    "quantascan.net",
    "quantastack.com",
    "example.com",
    "en.wikipedia.org",
  ])("returns null for the unrelated domain %s", (hostname) => {
    expect(findHomographMatch(hostname, PROTECTED, ALLOWLISTED)).toBeNull();
  });
});
