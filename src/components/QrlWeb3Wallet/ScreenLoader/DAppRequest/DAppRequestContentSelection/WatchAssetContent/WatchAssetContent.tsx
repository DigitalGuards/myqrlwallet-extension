import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import { Check, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import ChainBadge from "../../../Wallet/Header/ChainBadge/ChainBadge";
import WatchAssetInfo from "./WatchAssetInfo/WatchAssetInfo";
import StorageUtil from "@/utilities/storageUtil";
import WatchAssetVerification from "./WatchAssetVerification/WatchAssetVerification";

const WatchAssetContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { activeAccount } = qrlStore;
  const { accountAddress } = activeAccount;
  const {
    onPermission,
    approvalProcessingStatus,
    setOnPermissionCallBack,
    dAppRequestData,
    addToResponseData,
  } = dAppRequestStore;
  const { isProcessing } = approvalProcessingStatus;

  const paramsObject = dAppRequestData?.params[0];
  const tokenContract = paramsObject?.options;

  const addBlockchain = async () => {
    const onPermissionCallBack = async (hasApproved: boolean) => {
      if (hasApproved) {
        await StorageUtil.setTokenContractsList(accountAddress, {
          address: tokenContract?.address ?? "",
          symbol: tokenContract?.symbol ?? "",
          decimals: parseInt(tokenContract?.decimals ?? 0),
          image: tokenContract?.image ?? "",
        });
        addToResponseData({ result: true });
      }
    };
    setOnPermissionCallBack(onPermissionCallBack);
    await onPermission(true);
  };

  return (
    <Card className="surface-ember w-full animate-appear-in">
      <div className="flex justify-center pt-6">
        <ChainBadge isDisabled={true} />
      </div>
      <div className="p-6">
        <div>{t('dapp.watchAsset.description')}</div>
      </div>
      <CardContent className="space-y-6">
        <WatchAssetInfo />
        <WatchAssetVerification />
        <div className="font-bold">{t('dapp.watchAsset.question')}</div>
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-4">
        <Button
          className="w-full"
          variant="outline"
          type="button"
          disabled={isProcessing}
          aria-label="No"
          onClick={() => onPermission(false)}
        >
          <X className="mr-2 h-4 w-4" />
          {t('dapp.no')}
        </Button>
        <Button
          className="w-full"
          type="button"
          disabled={isProcessing}
          aria-label="Yes"
          onClick={() => addBlockchain()}
        >
          <Check className="mr-2 h-4 w-4" />
          {t('dapp.yes')}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default WatchAssetContent;
