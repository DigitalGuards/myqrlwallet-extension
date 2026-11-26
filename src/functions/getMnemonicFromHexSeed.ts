import { binToMnemonic } from "./mnemonicHelper";
import { Buffer } from "buffer";

export const getMnemonicFromHexSeed = (hexSeed?: string) => {
  if (!hexSeed) return "";
  const trimmedHexSeed = hexSeed.trim();
  if (!trimmedHexSeed) return "";
  // Strip the 0x prefix only when it is there. Stripping two characters
  // unconditionally cut the first byte off an unprefixed seed.
  const unprefixedHexSeed = /^0x/i.test(trimmedHexSeed)
    ? trimmedHexSeed.slice(2)
    : trimmedHexSeed;
  const hexSeedBin = Buffer.from(unprefixedHexSeed, "hex");
  return binToMnemonic(hexSeedBin);
};
