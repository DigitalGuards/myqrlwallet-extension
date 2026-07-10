import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import QrlRequestAccountAccountSelection from "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection";
import BackButton from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BackButton/BackButton";
import CircuitBackground from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/CircuitBackground/CircuitBackground";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { Pencil, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import ActiveBrowserTabIcon from "../../../../ActiveBrowserTab/ActiveBrowserTabIcon/ActiveBrowserTabIcon";
import { updateAccountsAndBlockchainsForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const EditDAppConnectedAccounts = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { dAppRequestStore } = useStore();
  const { currentTabData } = dAppRequestStore;
  const hasState = !!state?.hasState;

  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(
    currentTabData?.connectedAccounts ?? [],
  );

  useEffect(() => {
    if (!hasState) {
      navigate(ROUTES.DAPP_CONNECTIVITY);
    }
  }, [hasState]);

  const onAccountSelection = (selectedAccount: string, checked: boolean) => {
    let updatedAccounts = selectedAccounts;
    if (checked) {
      updatedAccounts = Array.from(
        new Set([...updatedAccounts, selectedAccount]),
      );
    } else {
      updatedAccounts = updatedAccounts.filter(
        (account) => account !== selectedAccount,
      );
    }
    setSelectedAccounts(updatedAccounts);
  };

  const onEdit = async () => {
    await updateAccountsAndBlockchainsForUrlOrigin({
      urlOrigin: currentTabData?.urlOrigin ?? "",
      accounts: selectedAccounts,
      blockchains: currentTabData?.connectedBlockchains ?? [],
    });
    navigate(ROUTES.DAPP_CONNECTIVITY);
  };

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader className="flex-row justify-between">
            <CardTitle>{t('dapp.editConnectedAccounts')}</CardTitle>
            <ActiveBrowserTabIcon
              favIconUrl={currentTabData?.favIconUrl}
              altText={currentTabData?.title}
            />
          </CardHeader>
          <CardContent className="space-y-8">
            <QrlRequestAccountAccountSelection
              selectedAccounts={selectedAccounts}
              onAccountSelection={onAccountSelection}
            />
          </CardContent>
          <CardFooter className="gap-4">
            <Button
              className="w-full"
              type="button"
              variant="outline"
              aria-label={t('common.cancel')}
              onClick={() => {
                navigate(ROUTES.DAPP_CONNECTIVITY);
              }}
            >
              <X className="mr-2 h-4 w-4" />
              {t('common.cancel')}
            </Button>
            <Button
              className="w-full"
              disabled={!selectedAccounts.length}
              type="submit"
              aria-label={t('dapp.editAccounts')}
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

export default EditDAppConnectedAccounts;
