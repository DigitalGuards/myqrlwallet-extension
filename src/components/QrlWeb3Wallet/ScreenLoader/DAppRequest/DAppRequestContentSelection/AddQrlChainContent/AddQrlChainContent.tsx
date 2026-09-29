import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { Check, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import AddQrlChainInfo from "./AddQrlChainInfo/AddQrlChainInfo";
import { BlockchainBaseDataType } from "@/configuration/qrlBlockchainConfig";
import StorageUtil from "@/utilities/storageUtil";
import {
  includeChainForUrlOrigin,
  pickDefaultRpcUrl,
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const AddQrlChainContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { addChain, selectBlockchain } = qrlStore;
  const {
    dAppRequestData,
    onPermission,
    approvalProcessingStatus,
    setOnPermissionCallBack,
  } = dAppRequestStore;
  const { isProcessing } = approvalProcessingStatus;

  const addBlockchain = async () => {
    const onPermissionCallBack = async (
      hasApproved: boolean,
      record: ResponseRecorder,
    ) => {
      if (hasApproved) {
        const blockchain = dAppRequestData
          ?.params?.[0] as BlockchainBaseDataType;
        const { chainFound, updatedChainList } = await addChain({
          chainName: blockchain?.chainName,
          chainId: blockchain?.chainId,
          nativeCurrency: blockchain?.nativeCurrency,
          rpcUrls: blockchain?.rpcUrls,
          blockExplorerUrls: blockchain?.blockExplorerUrls,
          iconUrls: blockchain?.iconUrls,
          // EIP-3085 orders rpcUrls by preference, and the middleware has
          // already rejected the request unless every entry is acceptable.
          // Picking the first acceptable entry keeps the two in step even
          // if the validation rules move.
          defaultRpcUrl: pickDefaultRpcUrl(blockchain?.rpcUrls),
          defaultBlockExplorerUrl: blockchain?.blockExplorerUrls?.[0] ?? "",
          defaultIconUrl: blockchain?.iconUrls?.[0] ?? "",
          isTestnet: false,
          defaultWsRpcUrl: "",
          isCustomChain: true,
        });
        if (!chainFound) {
          await StorageUtil.setAllBlockChains(updatedChainList);
          await includeChainForUrlOrigin({
            urlOrigin: dAppRequestData?.requestData?.senderData?.url ?? "",
            chainId: blockchain?.chainId,
          });
          // Approving adds the chain and makes it the wallet's active one,
          // which is what the prompt asks for in so many words.
          await selectBlockchain(blockchain?.chainId);
        }
        record({ result: true });
      }
    };
    // The pending-request slot is cleared by onPermission once the response
    // has been posted. Clearing it here used to wipe the request before its
    // requestId could be read back, so the dApp was answered 4001 by the
    // approval timeout even though the chain had been added.
    setOnPermissionCallBack(onPermissionCallBack);
    await onPermission(true);
  };

  return (
    <Card className="surface-ember w-full animate-appear-in">
      <div className="p-6">
        <div className="mb-1 text-xs font-bold">{t("dapp.addChain.title")}</div>
        <div>{t("dapp.addChain.description")}</div>
      </div>
      <CardContent className="space-y-6">
        <AddQrlChainInfo />
        <div className="font-bold">{t("dapp.addChain.question")}</div>
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
          {t("dapp.no")}
        </Button>
        <Button
          className="w-full"
          type="button"
          disabled={isProcessing}
          aria-label="Yes"
          onClick={() => addBlockchain()}
        >
          <Check className="mr-2 h-4 w-4" />
          {t("dapp.yes")}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default AddQrlChainContent;
