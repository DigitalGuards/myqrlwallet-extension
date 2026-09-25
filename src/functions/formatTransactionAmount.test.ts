import { describe, expect, it } from "vitest";
import { formatTransactionAmount } from "./formatTransactionAmount";

const compact = (amount: string | number | null | undefined) =>
  formatTransactionAmount(amount)?.compact;
const exact = (amount: string | number | null | undefined) =>
  formatTransactionAmount(amount)?.exact;

describe("formatTransactionAmount", () => {
  it("drops the padding zeros of a whole amount and groups thousands", () => {
    expect(compact("40500.000000000000000000")).toBe("40,500");
    expect(exact("40500.000000000000000000")).toBe("40500");
  });

  it("keeps whole amounts below a thousand ungrouped", () => {
    expect(compact("7.000000000000000000")).toBe("7");
    expect(compact("999")).toBe("999");
  });

  it("trims trailing zeros from a fractional amount", () => {
    expect(compact("1.500000000000000000")).toBe("1.5");
    expect(exact("1.500000000000000000")).toBe("1.5");
    expect(compact("0.250000")).toBe("0.25");
  });

  it("truncates the compact form to six fraction digits", () => {
    expect(compact("1.234567891234567891")).toBe("1.234567");
    expect(exact("1.234567891234567891")).toBe("1.234567891234567891");
  });

  it("keeps small fractional amounts that still have a visible digit", () => {
    expect(compact("0.000001")).toBe("0.000001");
    expect(compact("0.0000015")).toBe("0.000001");
    expect(compact("0.123")).toBe("0.123");
  });

  it("collapses amounts below the display threshold", () => {
    expect(compact("0.0000009")).toBe("<0.000001");
    expect(compact("0.000000000000000001")).toBe("<0.000001");
    expect(exact("0.000000000000000001")).toBe("0.000000000000000001");
  });

  it("renders zero as zero", () => {
    expect(compact("0")).toBe("0");
    expect(compact("0.000000000000000000")).toBe("0");
    expect(exact("0.0")).toBe("0");
  });

  it("groups large amounts and keeps every digit in the exact form", () => {
    expect(compact("1234567.891234567891234567")).toBe("1,234,567.891234");
    expect(exact("1234567.891234567891234567")).toBe(
      "1234567.891234567891234567",
    );
    expect(compact("123456789012345678901234567890")).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
  });

  it("accepts numbers, including scientific notation", () => {
    expect(compact(40500)).toBe("40,500");
    expect(compact(1e-7)).toBe("<0.000001");
    expect(exact(1e-7)).toBe("0.0000001");
    expect(compact("1.5e3")).toBe("1,500");
    expect(exact("2.5e-2")).toBe("0.025");
  });

  it("preserves the sign of a negative amount", () => {
    expect(compact("-1234.5")).toBe("-1,234.5");
    expect(compact("-0.0000001")).toBe("-<0.000001");
    expect(compact("-0")).toBe("0");
  });

  it("returns null for values it cannot parse", () => {
    expect(formatTransactionAmount(null)).toBeNull();
    expect(formatTransactionAmount(undefined)).toBeNull();
    expect(formatTransactionAmount("")).toBeNull();
    expect(formatTransactionAmount("abc")).toBeNull();
    expect(formatTransactionAmount("1.2.3")).toBeNull();
    expect(formatTransactionAmount(Number.NaN)).toBeNull();
    expect(formatTransactionAmount("1".repeat(129))).toBeNull();
    expect(formatTransactionAmount("1e999")).toBeNull();
  });
});
