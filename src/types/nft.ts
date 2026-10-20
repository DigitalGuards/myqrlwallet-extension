import type { MetadataText } from "@/utilities/nftMetadata";

export type NFTStandard = "ZRC721" | "ZRC1155";

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
// a decimal string; undefined for ZRC721 (ownership is binary).
export type OwnedNftToken = {
  tokenId: string;
  balance?: string;
};
