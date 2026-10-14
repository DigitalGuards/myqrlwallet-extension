export type NFTStandard = "ZRC721" | "ZRC1155";

export type NFTCollectionType = {
  address: string;
  name: string;
  symbol: string;
  standard: NFTStandard | undefined;
  image: string;
};

export type NFTMetadata = {
  name?: string | null;
  description?: string | null;
  image?: string | null;
  attributes?: Array<{
    trait_type?: string | null;
    // Attribute values are opaque metadata, converted to text by the reader.
    value?: unknown;
  }> | null;
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
