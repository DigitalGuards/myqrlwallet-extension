import { describe, expect, it } from "vitest";
import {
  areAddressesEquivalent,
  formatQrlAddressFingerprint,
  isCanonicalQrlAddress,
  isLegacyQrlAddress,
  isQrlAddress,
  QRL_ADDRESS_LENGTH,
  toCanonicalQrlAddress,
} from "./addressUtil";

const LOWER_ADDRESS = `Q${"abcdef0123456789".repeat(8)}`;
const CHECKSUM_ADDRESS = toCanonicalQrlAddress(LOWER_ADDRESS);

describe("areAddressesEquivalent", () => {
  it("accepts the same address with different checksum casing", () => {
    const upperPrefixLowerBody = `Q${CHECKSUM_ADDRESS.slice(1).toLowerCase()}`;
    expect(areAddressesEquivalent(CHECKSUM_ADDRESS, upperPrefixLowerBody)).toBe(
      true,
    );
  });

  it("rejects an address with one different nibble", () => {
    const differentAddress = `${CHECKSUM_ADDRESS.slice(0, -1)}8`;

    expect(
      areAddressesEquivalent(CHECKSUM_ADDRESS, differentAddress.toLowerCase()),
    ).toBe(false);
  });

  it("requires two nonempty strings", () => {
    expect(areAddressesEquivalent("", "")).toBe(false);
    expect(areAddressesEquivalent(CHECKSUM_ADDRESS, undefined)).toBe(false);
  });

  it("rejects pre-QIP-55 addresses", () => {
    const legacyAddress = `Q${"a".repeat(40)}`;
    expect(areAddressesEquivalent(legacyAddress, legacyAddress)).toBe(false);
  });
});

describe("QIP-55 address validation", () => {
  it("accepts full-width case-uniform and checksummed addresses", () => {
    expect(LOWER_ADDRESS).toHaveLength(QRL_ADDRESS_LENGTH);
    expect(isQrlAddress(LOWER_ADDRESS)).toBe(true);
    expect(isQrlAddress(CHECKSUM_ADDRESS)).toBe(true);
  });

  it("distinguishes canonical checksum form from compatibility inputs", () => {
    expect(isCanonicalQrlAddress(CHECKSUM_ADDRESS)).toBe(true);
    expect(isCanonicalQrlAddress(LOWER_ADDRESS)).toBe(false);
    expect(isCanonicalQrlAddress(`q${CHECKSUM_ADDRESS.slice(1)}`)).toBe(false);
    expect(isCanonicalQrlAddress(`0x${CHECKSUM_ADDRESS.slice(1)}`)).toBe(false);
  });

  it("canonicalizes q and 0x prefixes", () => {
    expect(toCanonicalQrlAddress(`q${LOWER_ADDRESS.slice(1)}`)).toBe(
      CHECKSUM_ADDRESS,
    );
    expect(toCanonicalQrlAddress(`0x${LOWER_ADDRESS.slice(1)}`)).toBe(
      CHECKSUM_ADDRESS,
    );
  });

  it("rejects wrong widths, lowercase prefixes, and bad mixed-case checksums", () => {
    expect(isQrlAddress(`Q${"a".repeat(40)}`)).toBe(false);
    expect(isQrlAddress(`Q${"a".repeat(127)}`)).toBe(false);
    expect(isQrlAddress(`Q${"a".repeat(129)}`)).toBe(false);
    expect(isQrlAddress(`q${LOWER_ADDRESS.slice(1)}`)).toBe(false);

    const last = CHECKSUM_ADDRESS.at(-1);
    const badChecksum = `${CHECKSUM_ADDRESS.slice(0, -1)}${last === "a" ? "A" : "a"}`;
    expect(isQrlAddress(badChecksum)).toBe(false);
  });

  it("classifies legacy addresses only for migration handling", () => {
    expect(isLegacyQrlAddress(`Q${"a".repeat(40)}`)).toBe(true);
    expect(isLegacyQrlAddress(LOWER_ADDRESS)).toBe(false);
  });
});

describe("formatQrlAddressFingerprint", () => {
  it("samples the first, middle, and final eight body characters", () => {
    const address = `Q${"0123456789abcdef".repeat(8)}`;

    expect(formatQrlAddressFingerprint(address)).toBe(
      "Q01234567...cdef0123...89abcdef",
    );
  });

  it("preserves checksum casing in every displayed segment", () => {
    const expected = `Q${CHECKSUM_ADDRESS.slice(1, 9)}...${CHECKSUM_ADDRESS.slice(
      61,
      69,
    )}...${CHECKSUM_ADDRESS.slice(-8)}`;

    expect(formatQrlAddressFingerprint(CHECKSUM_ADDRESS)).toBe(expected);
  });

  it("supports the preserved legacy address width", () => {
    const address = `Q${"1".repeat(8)}${"a".repeat(8)}${"2".repeat(
      8,
    )}${"b".repeat(8)}${"3".repeat(8)}`;

    expect(formatQrlAddressFingerprint(address)).toBe(
      "Q11111111...22222222...33333333",
    );
  });

  it("leaves adjacent unsupported all-hex widths complete", () => {
    const oneShort = `Q${"a".repeat(127)}`;
    const oneLong = `Q${"b".repeat(129)}`;

    expect(formatQrlAddressFingerprint(oneShort)).toBe(oneShort);
    expect(formatQrlAddressFingerprint(oneLong)).toBe(oneLong);
  });

  it("leaves malformed current-width values complete", () => {
    const nonHex = `Q${"a".repeat(127)}g`;
    const lowercasePrefix = `q${"a".repeat(128)}`;

    expect(formatQrlAddressFingerprint(nonHex)).toBe(nonHex);
    expect(formatQrlAddressFingerprint(lowercasePrefix)).toBe(lowercasePrefix);
  });

  it("leaves short values intact", () => {
    expect(formatQrlAddressFingerprint("Q1234")).toBe("Q1234");
  });
});
