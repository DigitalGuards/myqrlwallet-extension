// @vitest-environment node
// jsdom's TextEncoder produces a Uint8Array from a different realm, which
// @theqrl/web3-validator rejects; hashMessage (the oracle this suite checks
// against) goes through it, so this runs on the node environment.
import { describe, expect, it } from "vitest";
import { hashMessage } from "@theqrl/web3-qrl-accounts";
import { decodePersonalSignMessage } from "./decodePersonalSignMessage";

/**
 * The approval screen must show exactly the message the wallet goes on to
 * sign. hashMessage is the single source of truth for what "the message"
 * means, so every case is checked against it: hashing the displayed text
 * has to produce the same digest as hashing the raw request.
 */
describe("decodePersonalSignMessage", () => {
  it.each([
    ["plain text", "Sign in to example.com"],
    ["0x-prefixed hex", "0x48656c6c6f20776f726c64"],
    // The regression: this is hex, but without 0x hashMessage treats it as
    // ten literal characters. Decoding it for display showed "Hello" while
    // the wallet signed "48656c6c6f".
    ["unprefixed hex", "48656c6c6f"],
    ["uppercase unprefixed hex", "48656C6C6F"],
    ["odd-length text that looks hex", "abc"],
    ["empty", ""],
  ])("displays what gets signed for %s", (_label, rawMessage) => {
    const { text } = decodePersonalSignMessage(rawMessage);
    expect(hashMessage(text)).toBe(hashMessage(rawMessage));
  });

  it("decodes 0x-prefixed hex to its UTF-8 text", () => {
    expect(decodePersonalSignMessage("0x48656c6c6f20776f726c64")).toEqual({
      text: "Hello world",
      wasHexDecoded: true,
    });
  });

  it("leaves unprefixed hex exactly as the dApp sent it", () => {
    expect(decodePersonalSignMessage("48656c6c6f")).toEqual({
      text: "48656c6c6f",
      wasHexDecoded: false,
    });
  });
});
