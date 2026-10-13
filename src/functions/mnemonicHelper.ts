/**
 * TODO: WORKAROUND: These functions (binToMnemonic, mnemonicToBin) are copied
 * from @theqrl/wallet.js because the npm package (v1.1.1) does not export them
 * from its top-level entry point.
 *
 * The problem:
 *   The npm package's "exports" field in package.json only exposes the root ".":
 *     "exports": { ".": { "import": "./dist/mjs/wallet.js", "require": "./dist/cjs/wallet.js" } }
 *
 *   These two functions exist inside the package at:
 *     @theqrl/wallet.js/src/wallet/misc/mnemonic.js
 *
 *   But Node.js (and bundlers) enforce the "exports" field: importing from a
 *   path not listed in "exports" throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 *   The functions ARE used internally by the MLDSA87 class (newWalletFromMnemonic,
 *   getMnemonic), but they are not re-exported at the top level.
 *
 * Ideal fix:
 *   The @theqrl/wallet.js package should add mnemonicToBin and binToMnemonic to
 *   its top-level exports in src/index.js. Once that is done and a new version is
 *   published, this file should be deleted and the imports should be changed to:
 *     import { mnemonicToBin, binToMnemonic } from "@theqrl/wallet.js";
 *
 * Source: @theqrl/wallet.js@1.1.1 src/wallet/misc/mnemonic.js
 */

import { WordList } from "./qrlWordlist";

const WORD_LOOKUP = new Map(WordList.map((word, index) => [word, index]));

/**
 * Encode bytes to a spaced hex mnemonic string.
 */
export function binToMnemonic(input: Uint8Array): string {
  if (input.length % 3 !== 0) {
    throw new Error("byte count needs to be a multiple of 3");
  }

  const words: string[] = [];
  for (let nibble = 0; nibble < input.length * 2; nibble += 3) {
    const p = nibble >> 1;
    const b1 = input[p];
    const b2 = p + 1 < input.length ? input[p + 1] : 0;
    const idx =
      nibble % 2 === 0 ? (b1 << 4) + (b2 >> 4) : ((b1 & 0x0f) << 8) + b2;

    words.push(WordList[idx]);
  }

  return words.join(" ");
}

/**
 * Decode spaced hex mnemonic to bytes.
 */
export function mnemonicToBin(mnemonic: string): Uint8Array {
  const mnemonicWords = mnemonic.trim().toLowerCase().split(/\s+/);
  if (mnemonicWords.length % 2 !== 0)
    throw new Error("word count must be even");

  const result = new Uint8Array((mnemonicWords.length * 15) / 10);
  let current = 0;
  let buffering = 0;
  let resultIndex = 0;

  for (let i = 0; i < mnemonicWords.length; i += 1) {
    const w = mnemonicWords[i];
    const value = WORD_LOOKUP.get(w);
    if (value === undefined) throw new Error("invalid word in mnemonic");

    buffering += 3;
    current = (current << 12) + value;
    for (; buffering > 2; ) {
      const shift = 4 * (buffering - 2);
      const mask = (1 << shift) - 1;
      const tmp = current >> shift;
      buffering -= 2;
      current &= mask;
      result[resultIndex++] = tmp;
    }
  }

  if (buffering > 0) {
    result[resultIndex] = current & 0xff;
  }

  return result;
}
