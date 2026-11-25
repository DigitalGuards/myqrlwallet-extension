import { describe, expect, it } from "vitest";
import { toCanonicalTokenId } from "./nftTokenId";

describe("toCanonicalTokenId", () => {
  it.each([
    ["7", "7"],
    ["07", "7"],
    ["0x7", "7"],
    ["0X7", null],
    ["0", "0"],
    ["9".repeat(78).slice(0, 77), "9".repeat(77)],
    [`0x${"f".repeat(64)}`, ((1n << 256n) - 1n).toString()],
  ])("reads %s as %s", (raw, expected) => {
    expect(toCanonicalTokenId(raw)).toBe(expected);
  });

  it.each([
    "",
    " ",
    " 7",
    "7 ",
    "-1",
    "+7",
    "1.5",
    "1e3",
    "0b11",
    "0o7",
    "0x",
    "0xzz",
    "9".repeat(79),
    "9".repeat(78),
    `0x${"f".repeat(65)}`,
    "7\n",
  ])("rejects %j", (raw) => {
    expect(toCanonicalTokenId(raw)).toBeNull();
  });

  it.each([7, null, undefined, {}, ["7"]])(
    "rejects the non-string %j",
    (raw) => {
      expect(toCanonicalTokenId(raw)).toBeNull();
    },
  );
});
