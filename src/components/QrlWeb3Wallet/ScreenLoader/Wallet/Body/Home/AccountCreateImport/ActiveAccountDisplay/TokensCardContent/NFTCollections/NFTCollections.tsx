import { NFT_ITEMS_DISPLAY_LIMIT } from "@/constants/nftToken";
import type { NFTCollectionType } from "@/types/nft";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import TokenListItemLoading from "../TokenListItemLoading/TokenListItemLoading";
import NFTCollectionItem from "./NFTCollectionItem/NFTCollectionItem";

type NFTCollectionsProps = {
  shouldDisplayAllCollections?: boolean;
  // Reports the stored collection count after every (re)fetch, including
  // removals and chain switches, so the parent's view-all link can never
  // go stale against the rendered list.
  onCountChange?: (count: number) => void;
};

const NFTCollections = observer(
  ({
    shouldDisplayAllCollections = false,
    onCountChange,
  }: NFTCollectionsProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { activeAccount, qrlConnection } = qrlStore;
    const { accountAddress } = activeAccount;
    const { blockchain } = qrlConnection;

    const [reRender, setReRender] = useState(0);
    // null until the async storage read resolves, so the empty state is
    // only shown for a confirmed-empty list, not while loading.
    const [collections, setCollections] = useState<NFTCollectionType[] | null>(
      null,
    );

    useEffect(() => {
      (async () => {
        const stored =
          await StorageUtil.getNFTCollectionsList(accountAddress);
        setCollections(stored);
        onCountChange?.(stored.length);
      })();
    }, [blockchain, accountAddress, reRender]);

    const triggerReRender = () => {
      setReRender(reRender + 1);
    };

    if (!collections) {
      return shouldDisplayAllCollections ? <TokenListItemLoading /> : null;
    }

    if (shouldDisplayAllCollections && !collections.length) {
      return <div>{t("nft.noCollections")}</div>;
    }

    const displayLimit = shouldDisplayAllCollections
      ? collections.length
      : NFT_ITEMS_DISPLAY_LIMIT;

    return (
      <>
        {collections
          .slice(0, displayLimit)
          .map(({ address, standard }) => (
            <NFTCollectionItem
              key={address}
              contractAddress={address}
              storedStandard={standard}
              triggerReRender={triggerReRender}
            />
          ))}
      </>
    );
  },
);

export default NFTCollections;
