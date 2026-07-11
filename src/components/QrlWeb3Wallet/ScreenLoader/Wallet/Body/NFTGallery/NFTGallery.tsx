import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { OwnedNftToken } from "@/types/nft";
import { Image } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import NFTGalleryItem from "./NFTGalleryItem";

const NFTGallery = observer(() => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const { qrlStore } = useStore();
  const { getOwnedNftTokens, activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const contractAddress = state?.contractAddress ?? "";
  const collectionName = state?.collectionName ?? "";
  const standard = state?.standard ?? "ZRC721";

  const [tokens, setTokens] = useState<OwnedNftToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const owned = await getOwnedNftTokens(contractAddress, standard);
      if (!cancelled) {
        setTokens(owned);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractAddress, standard, accountAddress, blockchain]);

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>{collectionName || t("nft.gallery")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <Card
                    key={i}
                    className="flex aspect-square w-full animate-pulse flex-col overflow-hidden"
                  >
                    <div className="h-full w-full bg-accent" />
                  </Card>
                ))}
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center text-muted-foreground">
                <Image className="h-12 w-12" />
                <p className="text-sm">{t("nft.emptyGallery")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {tokens.map((token) => (
                  <NFTGalleryItem
                    key={token.tokenId}
                    contractAddress={contractAddress}
                    tokenId={token.tokenId}
                    collectionName={collectionName}
                    standard={standard}
                    balance={token.balance}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
});

export default NFTGallery;
