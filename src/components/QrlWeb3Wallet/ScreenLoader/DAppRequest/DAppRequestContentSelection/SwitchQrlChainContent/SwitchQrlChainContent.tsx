import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { Check, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import SwitchQrlChainInfo from "./SwitchQrlChainInfo/SwitchQrlChainInfo";
import { includeChainForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import {
  isSwitchQrlChainParameters,
  readApprovalParams,
} from "@/utilities/approvalGuards";
import { rpcErrors } from "@theqrl/qrl-wallet-provider";

const SwitchQrlChainContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { dAppRequestData, approvalProcessingStatus } = dAppRequestStore;
  const { isProcessing } = approvalProcessingStatus;

  const switchChain = async () => {
    const onPermissionCallBack = async (
      hasApproved: boolean,
      record: ResponseRecorder,
    ) => {
      if (hasApproved) {
        const paramObject = readApprovalParams(dAppRequestData?.params)?.[0];
        if (!isSwitchQrlChainParameters(paramObject)) {
          record({ error: rpcErrors.invalidParams() });
          return;
        }
        const { chainId } = paramObject;
        await includeChainForUrlOrigin({
          urlOrigin: dAppRequestData?.requestData?.senderData?.url ?? "",
          chainId,
        });
        await qrlStore.selectBlockchain(chainId);
        record({ result: true });
      }
    };
    dAppRequestStore.setOnPermissionCallBack(onPermissionCallBack);
    await dAppRequestStore.onPermission(true);
  };

  return (
    <Card className="surface-ember w-full animate-appear-in">
      <div className="p-6">
        <div className="mb-1 text-xs font-bold">
          {t("dapp.switchChain.title")}
        </div>
        <div>{t("dapp.switchChain.description")}</div>
      </div>
      <CardContent className="space-y-6">
        <SwitchQrlChainInfo />
        <div className="font-bold">{t("dapp.switchChain.question")}</div>
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
            switchChain().catch((error: unknown) => {
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

export default SwitchQrlChainContent;
