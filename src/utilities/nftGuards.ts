import type { NFTMetadata, NFTStandard } from "@/types/nft";
import { isMetadataText, type MetadataText } from "@/utilities/nftMetadata";
import { isRecord, isString } from "@/utilities/storageGuards";

type NFTGalleryState = {
  contractAddress: string;
  collectionName?: string | null;
  standard?: NFTStandard | null;
};

type NFTTransferState = NFTGalleryState & {
  tokenId: string;
  imageUrl?: string | null;
  nftName?: MetadataText;
  balance?: string;
};

const isOptionalText = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || isString(value);

const isNFTTokenId = (value: unknown): value is string => {
  // BigInt accepts blank strings as zero. Require an explicit identifier and
  // preserve every supported integer spelling for the signer's conversion.
  if (!isString(value) || value.trim() === "") return false;
  try {
    const tokenId = BigInt(value);
    return tokenId >= 0n && tokenId < 1n << 256n;
  } catch {
    return false;
  }
};

export const isNFTGalleryState = (value: unknown): value is NFTGalleryState =>
  isRecord(value) &&
  isString(value.contractAddress) &&
  isOptionalText(value.collectionName) &&
  (value.standard === undefined ||
    value.standard === null ||
    value.standard === "ZRC721" ||
    value.standard === "ZRC1155");

export const isNFTTransferState = (value: unknown): value is NFTTransferState =>
  isRecord(value) &&
  isNFTTokenId(value.tokenId) &&
  isOptionalText(value.imageUrl) &&
  isMetadataText(value.nftName) &&
  (value.balance === undefined || isString(value.balance)) &&
  isNFTGalleryState(value) &&
  value.contractAddress.trim() !== "";

export const isNFTMetadata = (value: unknown): value is NFTMetadata =>
  isRecord(value) &&
  isMetadataText(value.name) &&
  isMetadataText(value.description) &&
  isOptionalText(value.image) &&
  (value.attributes === undefined ||
    value.attributes === null ||
    Array.isArray(value.attributes));
