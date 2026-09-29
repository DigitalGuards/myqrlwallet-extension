import { Label } from "@/components/UI/Label";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import OtherChainItem from "./OtherChainItem/OtherChainItem";

const OtherChains = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { blockchain } = qrlConnection;
  const { chainId } = blockchain;

  const [reRender, setReRender] = useState(0);
  const [otherChains, setOtherChains] = useState<BlockchainDataType[]>([]);

  useEffect(() => {
    (async () => {
      const blockchains = await StorageUtil.getAllBlockChains();
      setOtherChains(blockchains.filter((chain) => chain.chainId !== chainId));
    })();
    // chainId belongs here: the list is "every chain except the active one",
    // so switching chains has to re-filter it. Without it the newly active
    // chain stayed listed under Other chains and the one just left vanished.
  }, [reRender, chainId]);

  const triggerReRender = () => {
    setReRender(reRender + 1);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-lg">{t("chain.otherChains")}</Label>
      {otherChains.map((blockchain) => {
        return (
          <OtherChainItem
            key={blockchain.chainId}
            blockchain={blockchain}
            triggerReRender={triggerReRender}
          />
        );
      })}
    </div>
  );
});

export default OtherChains;
