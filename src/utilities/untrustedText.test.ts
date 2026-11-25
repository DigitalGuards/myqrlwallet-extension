import { describe, expect, it } from "vitest";
import { cleanUntrustedText } from "./untrustedText";

describe("cleanUntrustedText", () => {
  it("leaves ordinary text alone", () => {
    expect(cleanUntrustedText("Alpha Coin", 50)).toBe("Alpha Coin");
    expect(cleanUntrustedText("Z\u00fcrich \u5e01", 50)).toBe(
      "Z\u00fcrich \u5e01",
    );
  });

  it.each([
    ["a bidirectional override", "Free\u202eKnS", "Free KnS"],
    ["a null byte", "S\u0000YM", "S YM"],
    ["an escape character", "A\u001bB", "A B"],
    ["a zero-width space", "A\u200bB", "A B"],
    ["a line break", "A\r\nB", "A B"],
    ["a tag character", "A\u{e0041}B", "A B"],
    ["a Mongolian vowel separator", "A\u180eB", "A B"],
    ["Hangul fillers", "A\u115f\u1160\u3164B", "A B"],
    ["a variation selector", "A\ufe0eB", "A B"],
    ["a supplementary variation selector", "A\u{e0100}B", "A B"],
    ["runs of whitespace", "  A   B  ", "A B"],
  ])("replaces %s", (_label, input, expected) => {
    expect(cleanUntrustedText(input, 50)).toBe(expected);
  });

  it("cuts to the limit in code points and marks the cut", () => {
    const cut = cleanUntrustedText("a".repeat(500), 10);
    expect(Array.from(cut)).toHaveLength(10);
    expect(cut.endsWith("\u2026")).toBe(true);
    // A surrogate pair is never split.
    const emoji = cleanUntrustedText("\u{1F600}".repeat(30), 5);
    expect(Array.from(emoji)).toHaveLength(5);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
