import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import type { NFTStandard } from "@/types/nft";
import {
  isMetadataText,
  metadataTextChildren,
  metadataValueToString,
} from "@/utilities/nftMetadata";
import { isRecord, isString } from "@/utilities/storageGuards";
import { Image, Send } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import CopyableAddress from "../../../Shared/CopyableAddress/CopyableAddress";
import { useState } from "react";

const readNFTMetadata = (value: unknown) => {
  if (!isRecord(value)) return null;
  const attributes: unknown[] = Array.isArray(value.attributes)
    ? value.attributes
    : [];

  // Each field contributes independently to this display view. Route metadata
  // stays intact, including entries the view cannot render.
  return {
    name: isMetadataText(value.name) ? value.name : undefined,
    description: isMetadataText(value.description)
      ? value.description
      : undefined,
    attributes: attributes.flatMap((attribute) => {
      if (attribute === null || attribute === undefined) return [];
      // Primitive and array entries expose absent fields in the original view.
      const fields = isRecord(attribute) ? attribute : {};
      try {
        return [
          {
            trait_type: isMetadataText(fields.trait_type)
              ? fields.trait_type
              : undefined,
            // Preserve the original renderer's conversion of opaque values.
            value: metadataValueToString(fields.value),
          },
        ];
      } catch {
        // A JSON object can shadow toString and make conversion fail.
        return [];
      }
    }),
  };
};

const NFTDetail = () => {
  const { t } = useTranslation();
  const state: unknown = useLocation().state;
  const navigate = useNavigate();

  const details = isRecord(state) ? state : {};
  const contractAddress = isString(details.contractAddress)
    ? details.contractAddress
    : "";
  const tokenId = isString(details.tokenId) ? details.tokenId : "";
  const collectionName = isString(details.collectionName)
    ? details.collectionName
    : "";
  const metadata = readNFTMetadata(details.metadata);
  const imageUrl = isString(details.imageUrl) ? details.imageUrl : "";
  const standard: NFTStandard =
    details.standard === "ZRC1155" ? "ZRC1155" : "ZRC721";
  const balance = isString(details.balance) ? details.balance : undefined;

  const [imageError, setImageError] = useState(false);

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>
              {metadataTextChildren(
                metadata?.name || `${collectionName} #${tokenId}`,
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="w-full overflow-hidden rounded-md bg-muted">
              {imageUrl && !imageError ? (
                <img
                  src={imageUrl}
                  alt={
                    metadata?.name === true
                      ? undefined
                      : metadataValueToString(metadata?.name || `#${tokenId}`)
                  }
                  className="w-full object-contain"
                  onError={() => {
                    setImageError(true);
                  }}
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center">
                  <Image className="h-16 w-16 text-muted-foreground" />
                </div>
              )}
            </div>

            {metadata?.description && (
              <div className="flex flex-col gap-1">
                <div className="text-sm font-bold">{t("nft.description")}</div>
                <div className="text-sm text-muted-foreground">
                  {metadataTextChildren(metadata.description)}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm">{t("nft.collectionName")}</div>
                <div className="text-sm font-bold text-secondary">
                  {collectionName}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-sm">{t("nft.tokenId")}</div>
                <div className="text-sm font-bold text-secondary">
                  #{tokenId}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-sm">{t("nft.standard")}</div>
                <div className="text-sm font-bold text-secondary">
                  {standard === "ZRC1155" ? "ZRC-1155" : "ZRC-721"}
                </div>
              </div>
              {balance && (
                <div className="flex flex-col gap-1">
                  <div className="text-sm">{t("nft.ownedCount")}</div>
                  <div className="font-numeric text-sm font-bold text-secondary">
                    {balance}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-sm">{t("nft.contractAddress")}</div>
              <CopyableAddress
                address={contractAddress}
                className="text-sm font-bold text-secondary"
              />
            </div>

            {metadata?.attributes && metadata.attributes.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-bold">{t("nft.attributes")}</div>
                <div className="grid grid-cols-2 gap-2">
                  {metadata.attributes.map((attr, index) => (
                    <Card
                      key={`${index}:${metadataValueToString(attr.trait_type ?? "")}`}
                      className="flex flex-col gap-1 p-3"
                    >
                      <div className="truncate text-xs text-muted-foreground">
                        {metadataTextChildren(attr.trait_type)}
                      </div>
                      <div className="truncate text-xs font-bold">
                        {attr.value}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              type="button"
              onClick={() => {
                Promise.resolve(
                  navigate(ROUTES.NFT_TRANSFER, {
                    state: {
                      contractAddress,
                      tokenId,
                      collectionName,
                      imageUrl,
                      nftName: metadata?.name ?? "",
                      standard,
                      balance,
                    },
                  }),
                ).catch((error: unknown) => {
                  console.error(
                    "[NFTDetail] Failed to open NFT transfer:",
                    error,
                  );
                });
              }}
            >
              <Send className="mr-2 h-4 w-4" />
              {t("nft.sendNftButton")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
};

export default NFTDetail;
