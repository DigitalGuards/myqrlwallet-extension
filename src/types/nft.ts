import type { MetadataText } from "@/utilities/nftMetadata";

// The typed names of the standards. A collection is stored under their
// earlier values, "ZRC721" and "ZRC1155" (see utilities/storedNames.ts).
export type NFTStandard = "QRC721" | "QRC1155";

export type NFTCollectionType = {
  address: string;
  name: string;
  symbol: string;
  standard: NFTStandard | undefined;
  image: string;
};

export type NFTMetadata = {
  name?: MetadataText;
  description?: MetadataText;
  image?: string | null;
  // Preserve opaque entries; the detail reader narrows optional trait labels
  // and converts values to text independently.
  attributes?: unknown[] | null;
};

export type NFTTokenInfo = {
  tokenId: string;
  metadata?: NFTMetadata;
  imageUrl?: string;
};

// One token the active account owns inside a collection, as returned by
// qrlStore.getOwnedNftTokens. `balance` is the ERC-1155 per-id holding as
// a decimal string; undefined for QRC721 (ownership is binary).
export type OwnedNftToken = {
  tokenId: string;
  balance?: string;
};
