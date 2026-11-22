// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isSupportedTransactionType,
  unsupportedTransactionTypeMessage,
} from "./dappTransactionType";

describe("isSupportedTransactionType", () => {
  it.each([undefined, null, "0x2", "0x02", "0X2", 2])("accepts %j", (type) => {
    expect(isSupportedTransactionType(type)).toBe(true);
  });

  it.each(["0x0", "0x1", "0x3", "0x20", "0x", "", "2", 0, 1, 3, true, {}])(
    "refuses %j",
    (type) => {
      expect(isSupportedTransactionType(type)).toBe(false);
    },
  );

  // A bigint cannot come out of storage, and it is refused all the same.
  it.each([0n, 2n])("refuses the bigint %s", (type) => {
    expect(isSupportedTransactionType(type)).toBe(false);
  });
});

describe("unsupportedTransactionTypeMessage", () => {
  it("names the type that was asked for", () => {
    expect(unsupportedTransactionTypeMessage("0x0")).toBe(
      'QRL transactions are of type 0x2. Received type: "0x0"',
    );
  });

  it.each([
    [0, "0"],
    [2n, "2n"],
    [true, "true"],
    [{ a: 1 }, '{"a":1}'],
    [Symbol.for("legacy"), "Symbol(legacy)"],
  ])("names %s without throwing", (type, text) => {
    expect(unsupportedTransactionTypeMessage(type)).toBe(
      `QRL transactions are of type 0x2. Received type: ${text}`,
    );
  });

  it("names a type that JSON cannot write", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(unsupportedTransactionTypeMessage(circular)).toBe(
      "QRL transactions are of type 0x2. Received type: [object Object]",
    );
  });
});
