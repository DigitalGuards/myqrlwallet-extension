import type { NFTStandard } from "@/types/nft";

/**
 * Stored names from before the token standards were renamed from ZRC to QRC.
 *
 * Versions up to 1.4.3 read the token flag as `isZrc20Token` and the NFT
 * standard as "ZRC721" or "ZRC1155", and a profile can be opened by such a
 * version again (a rolled-back release, a test build swapped back). The flag
 * decides whether Speed Up rebuilds a token transfer or a native one, so a
 * record must read the same in both directions:
 *
 * - readers take the current name first and the earlier one after it;
 * - writers store the flag under both names, and the NFT standard under its
 *   earlier value, which is the one value every version reads.
 *
 * One release after the rename, writers can drop the earlier names. Readers
 * keep them.
 */

type TokenFlagRecord = Record<string, unknown>;

/** The token flag of a stored record, whichever name it was stored under. */
export const readStoredTokenFlag = (stored: TokenFlagRecord): boolean => {
  const flag =
    typeof stored.isQrc20Token === "boolean"
      ? stored.isQrc20Token
      : stored.isZrc20Token;
  return flag === true;
};

/** True when a stored record carries a readable token flag under either name. */
export const hasStoredTokenFlag = (stored: TokenFlagRecord): boolean =>
  typeof stored.isQrc20Token === "boolean" ||
  typeof stored.isZrc20Token === "boolean";

/** A stored record's fields, with the token flag under its current name only. */
export const withCurrentTokenFlag = <T extends TokenFlagRecord>(
  stored: T,
): Omit<T, "isZrc20Token"> & { isQrc20Token: boolean } => {
  // The current name keeps its position when the record has it.
  const { isZrc20Token: _earlier, ...rest } = {
    ...stored,
    isQrc20Token: readStoredTokenFlag(stored),
  };
  return rest;
};

/** A record to store, with its token flag also under the earlier name. */
export const withEarlierTokenFlag = <T extends { isQrc20Token?: unknown }>(
  value: T,
): T =>
  typeof value.isQrc20Token === "boolean"
    ? { ...value, isZrc20Token: value.isQrc20Token }
    : value;

/** The NFT standard of a stored collection, whichever value it was stored as. */
export const readStoredNftStandard = (
  stored: unknown,
): NFTStandard | undefined => {
  if (stored === "QRC721" || stored === "ZRC721") return "QRC721";
  if (stored === "QRC1155" || stored === "ZRC1155") return "QRC1155";
  return undefined;
};

/**
 * The value a collection's standard is stored as: the one every version
 * reads. Anything that is not a current standard name is stored as given.
 */
export const toStoredNftStandard = (standard: unknown): unknown => {
  if (standard === "QRC721") return "ZRC721";
  if (standard === "QRC1155") return "ZRC1155";
  return standard;
};
