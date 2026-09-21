import { describe, expect, it } from "vitest";
import { toTokenBaseUnits } from "./tokenAmount";

describe("exact token amounts", () => {
  it.each([
    ["0.0000001", 18, 100000000000n],
    ["0.123456789012345678", 18, 123456789012345678n],
    ["9007199254740993", 0, 9007199254740993n],
    ["1.0000000000000000000000001", 25, 10000000000000000000000001n],
    ["0.000001", 6, 1n],
  ])(
    "converts %s at %s decimals without a number round trip",
    (value, decimals, expected) => {
      expect(toTokenBaseUnits(value, decimals)).toBe(expected);
    },
  );

  it.each(["1e-7", "", "-1", "NaN", "Infinity"])(
    "rejects invalid decimal text %s",
    (value) => {
      expect(() => toTokenBaseUnits(value, 18)).toThrow(/valid decimal/);
    },
  );

  it.each([
    ["1.1", 0],
    ["0.0000001", 6],
    ["0.0000000000000000001", 18],
  ])(
    "rejects excess precision in %s instead of rounding",
    (value, decimals) => {
      expect(() => toTokenBaseUnits(value, decimals)).toThrow(/decimal places/);
    },
  );
});
