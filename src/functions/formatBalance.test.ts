import { describe, expect, it } from "vitest";
import { formatBalance, splitFormattedBalance } from "./formatBalance";

// These expectations are the shared contract with the web wallet
// (myqrlwallet-frontend src/utils/formatting/__tests__). A change here is a
// change to both surfaces.
describe("formatBalance", () => {
  it("pads a whole balance to two decimals", () => {
    expect(formatBalance("40500")).toBe("40,500.00");
  });

  it("groups thousands", () => {
    expect(formatBalance("1234567.891")).toBe("1,234,567.89");
  });

  it("truncates toward zero", () => {
    expect(formatBalance("1.999")).toBe("1.99");
  });

  it("keeps up to six decimals below one unit", () => {
    expect(formatBalance("0.249")).toBe("0.249");
    expect(formatBalance("0.24")).toBe("0.24");
    expect(formatBalance("0.123456789")).toBe("0.123456");
  });

  it("falls back to significant digits for dust", () => {
    expect(formatBalance("0.00000001234")).toBe("0.00000001234");
  });

  it("renders zero as 0.00", () => {
    expect(formatBalance("0")).toBe("0.00");
  });

  it("returns 0 for unparseable input", () => {
    expect(formatBalance("not-a-number")).toBe("0");
  });

  it("can drop the thousands separator", () => {
    expect(formatBalance("40500", 2, false)).toBe("40500.00");
  });
});

describe("splitFormattedBalance", () => {
  it("splits amount from unit and applies the display rule", () => {
    expect(splitFormattedBalance("40500.0 Quanta")).toEqual({
      amount: "40,500.00",
      unit: "Quanta",
    });
  });

  it("re-groups an already grouped amount", () => {
    expect(splitFormattedBalance("1,234.5 Quanta")).toEqual({
      amount: "1,234.50",
      unit: "Quanta",
    });
  });

  it("handles a missing unit", () => {
    expect(splitFormattedBalance("12")).toEqual({ amount: "12.00", unit: "" });
  });

  it("leaves an unparseable amount alone", () => {
    expect(splitFormattedBalance("Unavailable Quanta")).toEqual({
      amount: "Unavailable",
      unit: "Quanta",
    });
  });
});
