import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import { Check, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import SwitchQrlChainInfo from "./SwitchQrlChainInfo/SwitchQrlChainInfo";
import { includeChainForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const SwitchQrlChainContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { selectBlockchain } = qrlStore;
  const {
    dAppRequestData,
    onPermission,
    approvalProcessingStatus,
    setOnPermissionCallBack,
    addToResponseData,
  } = dAppRequestStore;
  const { isProcessing } = approvalProcessingStatus;

  const paramObject = dAppRequestData?.params?.[0];
  const chainId = paramObject?.chainId;

  const switchChain = async () => {
    const onPermissionCallBack = async (hasApproved: boolean) => {
      if (hasApproved) {
        await includeChainForUrlOrigin({
          urlOrigin: dAppRequestData?.requestData?.senderData?.url ?? "",
          chainId,
        });
        await selectBlockchain(chainId);
        addToResponseData({ result: true });
      }
    };
    setOnPermissionCallBack(onPermissionCallBack);
    await onPermission(true);
  };

  return (
    <Card className="surface-ember w-full animate-appear-in">
      <div className="p-6">
        <div className="mb-1 text-xs font-bold">{t('dapp.switchChain.title')}</div>
        <div>{t('dapp.switchChain.description')}</div>
      </div>
      <CardContent className="space-y-6">
        <SwitchQrlChainInfo />
        <div className="font-bold">{t('dapp.switchChain.question')}</div>
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
          onClick={() => switchChain()}
        >
          <Check className="mr-2 h-4 w-4" />
          {t('dapp.yes')}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default SwitchQrlChainContent;
