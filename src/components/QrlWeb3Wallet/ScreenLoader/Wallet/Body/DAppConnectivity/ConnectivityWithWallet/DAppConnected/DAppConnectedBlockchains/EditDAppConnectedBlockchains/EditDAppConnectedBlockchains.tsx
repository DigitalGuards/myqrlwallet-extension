import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import QrlRequestAccountBlockchainSelection from "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection";
import BackButton from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BackButton/BackButton";
import CircuitBackground from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/CircuitBackground/CircuitBackground";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { Pencil, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import ActiveBrowserTabIcon from "../../../../ActiveBrowserTab/ActiveBrowserTabIcon/ActiveBrowserTabIcon";
import { updateAccountsAndBlockchainsForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const EditDAppConnectedBlockchains = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { initializeBlockchain } = qrlStore;
  const { currentTabData } = dAppRequestStore;
  const hasState = !!state?.hasState;

  const [isLoadingBlockchains, setIsLoadingBlockchains] = useState(true);
  const [allBlockchains, setAllBlockchains] = useState<BlockchainDataType[]>(
    [],
  );
  const [selectedBlockchains, setSelectedBlockchains] = useState<
    BlockchainDataType[]
  >(currentTabData?.connectedBlockchains ?? []);

  useEffect(() => {
    (async () => {
      const allBlockchains = await StorageUtil.getAllBlockChains();
      setAllBlockchains(allBlockchains);
      setIsLoadingBlockchains(false);
    })();
  }, []);

  useEffect(() => {
    if (!hasState) {
      navigate(ROUTES.DAPP_CONNECTIVITY);
    }
  }, [hasState]);

  const onBlockchainSelection = (
    selectedBlockchain: BlockchainDataType,
    checked: boolean,
  ) => {
    let updatedBlockchains = selectedBlockchains;
    if (checked) {
      updatedBlockchains = Array.from(
        new Set([...updatedBlockchains, selectedBlockchain]),
      );
    } else {
      updatedBlockchains = updatedBlockchains.filter(
        (blockchain) => blockchain.chainId !== selectedBlockchain.chainId,
      );
    }
    setSelectedBlockchains(updatedBlockchains);
  };

  const onEdit = async () => {
    await updateAccountsAndBlockchainsForUrlOrigin({
      urlOrigin: currentTabData?.urlOrigin ?? "",
      accounts: currentTabData?.connectedAccounts ?? [],
      blockchains: selectedBlockchains,
    });
    navigate(ROUTES.DAPP_CONNECTIVITY);
    initializeBlockchain();
  };

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader className="flex-row justify-between">
            <CardTitle>{t('dapp.editConnectedBlockchains')}</CardTitle>
            <ActiveBrowserTabIcon
              favIconUrl={currentTabData?.favIconUrl}
              altText={currentTabData?.title}
            />
          </CardHeader>
          <CardContent className="space-y-8">
            <QrlRequestAccountBlockchainSelection
              isLoading={isLoadingBlockchains}
              allBlockchains={allBlockchains}
              selectedBlockchains={selectedBlockchains}
              onBlockchainSelection={onBlockchainSelection}
            />
          </CardContent>
          <CardFooter className="gap-4">
            <Button
              className="w-full"
              type="button"
              variant="outline"
              onClick={() => {
                navigate(ROUTES.DAPP_CONNECTIVITY);
              }}
            >
              <X className="mr-2 h-4 w-4" />
              {t('common.cancel')}
            </Button>
            <Button
              className="w-full"
              disabled={!selectedBlockchains.length}
              type="submit"
              aria-label={t('dapp.editBlockchains')}
              onClick={onEdit}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t('common.edit')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
});

export default EditDAppConnectedBlockchains;
