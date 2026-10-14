import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { Check, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import ChainBadge from "../../../Wallet/Header/ChainBadge/ChainBadge";
import WatchAssetInfo from "./WatchAssetInfo/WatchAssetInfo";
import StorageUtil from "@/utilities/storageUtil";
import WatchAssetVerification from "./WatchAssetVerification/WatchAssetVerification";
import { readWatchAssetOptions } from "@/utilities/approvalGuards";
import { rpcErrors } from "@theqrl/qrl-wallet-provider";

const WatchAssetContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { activeAccount } = qrlStore;
  const { accountAddress } = activeAccount;
  const { approvalProcessingStatus, dAppRequestData } = dAppRequestStore;
  const { isProcessing } = approvalProcessingStatus;

  const tokenContract = readWatchAssetOptions(dAppRequestData?.params);

  const addBlockchain = async () => {
    const onPermissionCallBack = async (
      hasApproved: boolean,
      record: ResponseRecorder,
    ) => {
      if (hasApproved) {
        if (!tokenContract) {
          record({ error: rpcErrors.invalidParams() });
          return;
        }
        await StorageUtil.setTokenContractsList(accountAddress, {
          address: tokenContract.address,
          symbol: tokenContract.symbol,
          decimals: parseInt(String(tokenContract.decimals)),
          image: tokenContract.image ?? "",
        });
        record({ result: true });
      }
    };
    dAppRequestStore.setOnPermissionCallBack(onPermissionCallBack);
    await dAppRequestStore.onPermission(true);
  };

  return (
    <Card className="surface-ember w-full animate-appear-in">
      <div className="flex justify-center pt-6">
        <ChainBadge isDisabled={true} />
      </div>
      <div className="p-6">
        <div>{t("dapp.watchAsset.description")}</div>
      </div>
      <CardContent className="space-y-6">
        <WatchAssetInfo />
        <WatchAssetVerification />
        <div className="font-bold">{t("dapp.watchAsset.question")}</div>
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-4">
        <Button
          className="w-full"
          variant="outline"
          type="button"
          disabled={isProcessing}
          aria-label="No"
          onClick={() => {
            dAppRequestStore.onPermission(false).catch((error: unknown) => {
              console.warn(
                "QrlWeb3Wallet: Error while resolving the permission request\n",
                error,
              );
            });
          }}
        >
          <X className="mr-2 h-4 w-4" />
          {t("dapp.no")}
        </Button>
        <Button
          className="w-full"
          type="button"
          disabled={isProcessing}
          aria-label="Yes"
          onClick={() => {
            addBlockchain().catch((error: unknown) => {
              console.warn(
                "QrlWeb3Wallet: Error while resolving the permission request\n",
                error,
              );
            });
          }}
        >
          <Check className="mr-2 h-4 w-4" />
          {t("dapp.yes")}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default WatchAssetContent;
