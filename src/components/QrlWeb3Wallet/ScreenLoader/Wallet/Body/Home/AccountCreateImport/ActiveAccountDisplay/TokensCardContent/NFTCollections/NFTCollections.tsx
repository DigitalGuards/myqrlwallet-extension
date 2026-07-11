import { NFT_ITEMS_DISPLAY_LIMIT } from "@/constants/nftToken";
import type { NFTCollectionType } from "@/types/nft";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import NFTCollectionItem from "./NFTCollectionItem/NFTCollectionItem";

const NFTCollections = observer(() => {
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const [reRender, setReRender] = useState(0);
  const [collections, setCollections] = useState<NFTCollectionType[]>([]);

  useEffect(() => {
    (async () => {
      const stored =
        await StorageUtil.getNFTCollectionsList(accountAddress);
      setCollections(stored);
    })();
  }, [blockchain, accountAddress, reRender]);

  const triggerReRender = () => {
    setReRender(reRender + 1);
  };

  return (
    <>
      {collections
        .slice(0, NFT_ITEMS_DISPLAY_LIMIT)
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
});

export default NFTCollections;
