import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { OwnedNftToken } from "@/types/nft";
import { isNFTGalleryState } from "@/utilities/nftGuards";
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
  const state: unknown = useLocation().state;
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const routeState = isNFTGalleryState(state) ? state : undefined;
  const validRoute = routeState !== undefined;
  const contractAddress = routeState?.contractAddress ?? "";
  const collectionName = routeState?.collectionName ?? "";
  const standard = routeState?.standard ?? "QRC721";

  const [tokens, setTokens] = useState<OwnedNftToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The failure is the explorer's: this collection can only be listed
  // through it. Its own line names the explorer as the cause.
  const [explorerNeeded, setExplorerNeeded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadTokens = async () => {
      setIsLoading(true);
      if (!validRoute) {
        setLoadFailed(true);
        setIsLoading(false);
        return;
      }
      const owned = await qrlStore.getOwnedNftTokens(contractAddress, standard);
      if (cancelled) return;
      // An unreadable chain is not an empty collection. Reporting the
      // failure keeps "you own nothing here" from standing in for "the
      // node did not answer".
      setLoadFailed(owned.failed);
      setExplorerNeeded(owned.failed && owned.explorerUnavailable === true);
      setTokens(owned.tokens);
      setIsLoading(false);
    };
    loadTokens().catch((error: unknown) => {
      console.error("Failed to load NFT gallery:", error);
      if (cancelled) return;
      setLoadFailed(true);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    contractAddress,
    standard,
    accountAddress,
    blockchain,
    reloadKey,
    validRoute,
    qrlStore,
  ]);

  // The explorer could not refresh the list, but ids remembered from an
  // earlier listing still verify on chain: show them with a calm notice.
  const showRemembered = loadFailed && explorerNeeded && tokens.length > 0;

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
            ) : loadFailed && !showRemembered ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center text-muted-foreground">
                <Image className="h-12 w-12" />
                <p className="text-sm">
                  {t(
                    explorerNeeded
                      ? "nft.galleryExplorerNeeded"
                      : "nft.galleryLoadFailed",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReloadKey((key) => key + 1);
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center text-muted-foreground">
                <Image className="h-12 w-12" />
                <p className="text-sm">{t("nft.emptyGallery")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {showRemembered && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    <p>{t("nft.galleryRefreshFailed")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReloadKey((key) => key + 1);
                      }}
                    >
                      {t("common.retry")}
                    </Button>
                  </div>
                )}
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
});

export default NFTGallery;
