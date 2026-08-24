import { describe, expect, it } from "vitest";
import { areAddressesEquivalent } from "./addressUtil";

const CHECKSUM_ADDRESS = "Q20B714091cF2a62DADda2847803e3f1B9D2D3779";

describe("areAddressesEquivalent", () => {
  it("accepts the same address with different checksum casing", () => {
    expect(
      areAddressesEquivalent(CHECKSUM_ADDRESS, CHECKSUM_ADDRESS.toLowerCase()),
    ).toBe(true);
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
});
