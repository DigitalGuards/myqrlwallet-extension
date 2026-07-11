import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import StringUtil from "@/utilities/stringUtil";
import type { NFTMetadata, NFTStandard } from "@/types/nft";
import { Image, Send } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import { useState } from "react";

const NFTDetail = () => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const navigate = useNavigate();

  const contractAddress: string = state?.contractAddress ?? "";
  const tokenId: string = state?.tokenId ?? "";
  const collectionName: string = state?.collectionName ?? "";
  const metadata: NFTMetadata | null = state?.metadata ?? null;
  const imageUrl: string = state?.imageUrl ?? "";
  const standard: NFTStandard = state?.standard ?? "ZRC721";
  const balance: string | undefined = state?.balance;

  const [imageError, setImageError] = useState(false);

  const { prefix, addressSplit } =
    StringUtil.getSplitAddress(contractAddress);

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>
              {metadata?.name || `${collectionName} #${tokenId}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="w-full overflow-hidden rounded-md bg-muted">
              {imageUrl && !imageError ? (
                <img
                  src={imageUrl}
                  alt={metadata?.name || `#${tokenId}`}
                  className="w-full object-contain"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center">
                  <Image className="h-16 w-16 text-muted-foreground" />
                </div>
              )}
            </div>

            {metadata?.description && (
              <div className="flex flex-col gap-1">
                <div className="text-sm font-bold">
                  {t("nft.description")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {metadata.description}
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
                  <div className="text-sm font-bold text-secondary">
                    {balance}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-sm">{t("nft.contractAddress")}</div>
              <div className="flex flex-wrap gap-1 text-sm font-bold text-secondary">
                {`${prefix} ${addressSplit.join(" ")}`}
              </div>
            </div>

            {metadata?.attributes && metadata.attributes.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-bold">
                  {t("nft.attributes")}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {metadata.attributes.map((attr) => (
                    <Card
                      key={attr.trait_type}
                      className="flex flex-col gap-1 p-3"
                    >
                      <div className="truncate text-xs text-muted-foreground">
                        {attr.trait_type}
                      </div>
                      <div className="truncate text-xs font-bold">
                        {String(attr.value)}
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
              onClick={() =>
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
                })
              }
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
