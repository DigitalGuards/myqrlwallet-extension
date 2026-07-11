export type NFTStandard = "ZRC721" | "ZRC1155";

export type NFTCollectionType = {
  address: string;
  name: string;
  symbol: string;
  standard: NFTStandard;
  image: string;
};

export type NFTMetadata = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
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
