import type { NFTMetadata, NFTStandard } from "@/types/nft";
import { isArrayOf, isRecord, isString } from "@/utilities/storageGuards";

type NFTGalleryState = {
  contractAddress: string;
  collectionName?: string | null;
  standard?: NFTStandard | null;
};

type NFTTransferState = NFTGalleryState & {
  tokenId: string;
  imageUrl?: string | null;
  nftName?: string | null;
  balance?: string;
};

const isOptionalText = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || isString(value);

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
  isString(value.tokenId) &&
  isOptionalText(value.imageUrl) &&
  isOptionalText(value.nftName) &&
  (value.balance === undefined || isString(value.balance)) &&
  isNFTGalleryState(value);

const isNFTAttribute = (
  value: unknown,
): value is NonNullable<NFTMetadata["attributes"]>[number] =>
  isRecord(value) &&
  (value.trait_type === undefined || isString(value.trait_type)) &&
  (isString(value.value) || typeof value.value === "number");

export const isNFTMetadata = (value: unknown): value is NFTMetadata =>
  isRecord(value) &&
  (value.name === undefined || isString(value.name)) &&
  (value.description === undefined || isString(value.description)) &&
  (value.image === undefined || isString(value.image)) &&
  (value.attributes === undefined ||
    isArrayOf(value.attributes, isNFTAttribute));
