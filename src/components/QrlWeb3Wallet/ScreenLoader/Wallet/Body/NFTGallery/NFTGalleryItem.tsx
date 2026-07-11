import { Card } from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { resolveIpfsUrl, fetchMetadata } from "@/utilities/ipfsUtil";
import type { NFTMetadata, NFTStandard } from "@/types/nft";
import { Image } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type NFTGalleryItemProps = {
  contractAddress: string;
  tokenId: string;
  collectionName: string;
  standard?: NFTStandard;
  // ERC-1155 per-id holding (decimal string); undefined for ZRC721.
  balance?: string;
};

const NFTGalleryItem = observer(
  ({
    contractAddress,
    tokenId,
    collectionName,
    standard = "ZRC721",
    balance,
  }: NFTGalleryItemProps) => {
    const navigate = useNavigate();
    const { qrlStore } = useStore();
    const { getNftTokenUri } = qrlStore;

    const [metadata, setMetadata] = useState<NFTMetadata | null>(null);
    const [imageUrl, setImageUrl] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        setIsLoading(true);
        try {
          const uri = await getNftTokenUri(contractAddress, tokenId, standard);
          if (cancelled) return;

          if (uri) {
            const meta = await fetchMetadata(uri);
            if (cancelled) return;

            if (meta) {
              const nftMeta: NFTMetadata = {
                name: meta.name as string,
                description: meta.description as string,
                image: meta.image as string,
                attributes: meta.attributes as NFTMetadata["attributes"],
              };
              setMetadata(nftMeta);
              if (nftMeta.image) {
                setImageUrl(resolveIpfsUrl(nftMeta.image));
              }
            }
          }
        } catch {
          // Silently fail
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [contractAddress, tokenId, standard]);

    const handleClick = () => {
      navigate(ROUTES.NFT_DETAIL, {
        state: {
          contractAddress,
          tokenId,
          collectionName,
          metadata,
          imageUrl,
          standard,
          balance,
        },
      });
    };

    if (isLoading) {
      return (
        <Card className="flex aspect-square w-full animate-pulse flex-col overflow-hidden">
          <div className="h-full w-full bg-accent" />
        </Card>
      );
    }

    return (
      <Card
        className="flex w-full cursor-pointer flex-col overflow-hidden transition-all hover:ring-2 hover:ring-secondary"
        onClick={handleClick}
      >
        <div className="relative aspect-square w-full bg-muted">
          {imageUrl && !imageError ? (
            <img
              src={imageUrl}
              alt={metadata?.name || `#${tokenId}`}
              className="h-full w-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Image className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          {balance && balance !== "1" && (
            <span className="absolute right-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-xs font-bold">
              ×{balance}
            </span>
          )}
        </div>
        <div className="p-2">
          <div className="truncate text-xs font-bold">
            {metadata?.name || `#${tokenId}`}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            Token #{tokenId}
          </div>
        </div>
      </Card>
    );
  },
);

export default NFTGalleryItem;
