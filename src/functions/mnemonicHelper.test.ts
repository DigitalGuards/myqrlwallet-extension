import { describe, expect, it } from "vitest";
import { binToMnemonic, mnemonicToBin } from "./mnemonicHelper";
import { WordList } from "./qrlWordlist";

describe("mnemonicHelper", () => {
  it("round-trips every word index including zero", () => {
    const mnemonic = WordList.join(" ");
    expect(binToMnemonic(mnemonicToBin(mnemonic))).toBe(mnemonic);
  });

  it("preserves case and whitespace normalization", () => {
    const mnemonic = binToMnemonic(new Uint8Array([0, 0, 1]));
    expect(
      mnemonicToBin(`  ${mnemonic.toUpperCase().replace(" ", "\t\n")}  `),
    ).toEqual(new Uint8Array([0, 0, 1]));
  });

  it.each(["invalidword", "constructor", "__proto__", "tostring"])(
    "rejects the unknown word %s",
    (word) => {
      const [validWord] = WordList;
      expect(() => mnemonicToBin(`${validWord} ${word}`)).toThrow(
        "invalid word in mnemonic",
      );
    },
  );

  it("preserves word and byte count errors", () => {
    const [word] = WordList;
    expect(() => mnemonicToBin(word)).toThrow("word count must be even");
    expect(() => binToMnemonic(new Uint8Array([0]))).toThrow(
      "byte count needs to be a multiple of 3",
    );
  });
});
