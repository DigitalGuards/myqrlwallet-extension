import { Button } from "@/components/UI/Button";
import { Card } from "@/components/UI/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import { ROUTES } from "@/router/router";
import { discoverOwnedNftTokens } from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import type { NFTStandard } from "@/types/nft";
import StorageUtil from "@/utilities/storageUtil";
import { getRandomTailwindTextColor } from "@/utilities/stylingUtil";
import {
  Check,
  CircleMinus,
  EllipsisVertical,
  Image,
  X,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import TokenListItemLoading from "../../TokenListItemLoading/TokenListItemLoading";

type NFTCollectionItemProps = {
  contractAddress: string;
  // Standard recorded at import time; refined by live detection below.
  storedStandard?: NFTStandard;
  triggerReRender?: () => void;
};

const NFTCollectionItem = observer(
  ({
    contractAddress,
    storedStandard,
    triggerReRender,
  }: NFTCollectionItemProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { qrlStore } = useStore();
    const { qrlConnection, activeAccount, getNftCollectionDetails } =
      qrlStore;
    const { blockchain } = qrlConnection;
    const { accountAddress } = activeAccount;

    const [collection, setCollection] =
      useState<
        Awaited<ReturnType<typeof getNftCollectionDetails>>["collection"]
      >();
    const [ownedCount, setOwnedCount] = useState<number | undefined>();
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        const details = await getNftCollectionDetails(contractAddress);
        if (cancelled || details.error || !details.collection) return;
        setCollection(details.collection);
        if (details.collection.balance !== undefined) {
          setOwnedCount(details.collection.balance);
          return;
        }
        // ZRC-1155 has no on-chain owner enumeration; count owned ids via
        // the explorer (0 when the chain has no configured explorer).
        const discovered = await discoverOwnedNftTokens(
          accountAddress,
          blockchain.chainId,
          contractAddress,
        );
        if (!cancelled) setOwnedCount(discovered.length);
      })();
      return () => {
        cancelled = true;
      };
    }, [blockchain, accountAddress]);

    const onRemove = async () => {
      setRemoveDialogOpen(false);
      await StorageUtil.clearFromNFTCollectionsList(
        accountAddress,
        contractAddress,
      );
      triggerReRender?.();
    };

    if (!collection) {
      return <TokenListItemLoading />;
    }

    // ZRC-1155 contracts routinely omit name()/symbol(); fall back to a
    // shortened contract address so the row is never blank.
    const displayName =
      collection.name ||
      collection.symbol ||
      `${contractAddress.slice(0, 10)}...`;

    return (
      <>
        <Card
          className="flex h-16 w-full animate-appear-in cursor-pointer items-center justify-between gap-4 p-4 text-foreground hover:ring-1 hover:ring-secondary"
          onClick={() =>
            navigate(ROUTES.NFT_GALLERY, {
              state: {
                contractAddress,
                collectionName: collection.name,
                standard: collection.standard ?? storedStandard ?? "ZRC721",
              },
            })
          }
        >
          <div className="flex items-center gap-4">
            <Image
              className={`shrink-0 ${getRandomTailwindTextColor(collection.symbol)}`}
              size={32}
            />
            <div className="flex w-full flex-col gap-1">
              <div className="text-xs font-bold">
                {ownedCount !== undefined
                  ? t("nft.ownedNfts", { count: ownedCount })
                  : displayName}
              </div>
              <div className="text-xs">
                {ownedCount !== undefined && displayName}
                {collection.standard === "ZRC1155" && (
                  <span className="ml-1 text-muted-foreground">ZRC-1155</span>
                )}
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                className="size-7 hover:bg-accent hover:text-secondary"
                variant="outline"
                size="icon"
                aria-label={t("common.more")}
              >
                <EllipsisVertical size="16" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <div className="flex gap-2">
                    <CircleMinus size="16" />
                    <button aria-label={t("nft.removeCollection")}>
                      {t("nft.removeCollection")}
                    </button>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>
        <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <DialogContent className="w-80 rounded-md">
            <DialogHeader className="text-left">
              <DialogTitle>{t("nft.removeCollection")}</DialogTitle>
              <DialogDescription>
                {t("nft.removeConfirm", { name: displayName })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-row gap-4">
              <DialogClose asChild>
                <Button className="w-full" type="button" variant="outline">
                  <X className="mr-2 h-4 w-4" />
                  {t("common.no")}
                </Button>
              </DialogClose>
              <Button className="w-full" type="button" onClick={onRemove}>
                <Check className="mr-2 h-4 w-4" />
                {t("common.yes")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);

export default NFTCollectionItem;
