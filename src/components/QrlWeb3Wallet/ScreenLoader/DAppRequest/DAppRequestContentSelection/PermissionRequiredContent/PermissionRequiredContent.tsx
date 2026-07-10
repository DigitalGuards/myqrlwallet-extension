import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/UI/AlertDialog";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import ChainBadge from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge";
import { useStore } from "@/stores/store";
import { Check, Loader, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import DAppRequestWebsite from "./DAppRequestWebsite/DAppRequestWebsite";

const PermissionRequiredContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { onPermission, canProceed, approvalProcessingStatus } =
    dAppRequestStore;
  const { isProcessing, hasApproved } = approvalProcessingStatus;
  const isRejectionProcessing = isProcessing && !hasApproved;
  const isApprovalProcessing = isProcessing && hasApproved;

  return (
    <>
      <Card className="surface-ember w-full animate-appear-in">
        <div className="flex justify-center pt-6">
          <ChainBadge isDisabled={true} />
        </div>
        <div className="p-6">
          <div className="mb-1 text-xs font-bold">{t('dapp.permissionTitle')}</div>
          <div>
            {t('dapp.permissionDescription')}
          </div>
        </div>
        <CardContent className="space-y-6">
          <DAppRequestWebsite />
          <div className="font-bold">{t('dapp.permissionQuestion')}</div>
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
            {isRejectionProcessing ? (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-2 h-4 w-4" />
            )}
            {t('dapp.no')}
          </Button>
          <Button
            className="w-full"
            type="button"
            disabled={!canProceed || isProcessing}
            aria-label="Yes"
            onClick={() => onPermission(true)}
          >
            {isApprovalProcessing ? (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            {t('dapp.yes')}
          </Button>
        </CardFooter>
      </Card>
      <AlertDialog open={isProcessing}>
        <AlertDialogContent className="w-80 rounded-md">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>
              <div className="flex items-center gap-2">
                <Loader className="animate-spin text-foreground" size="18" />
                {t('dapp.transactionRunning')}
              </div>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('dapp.pleaseWait')}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default PermissionRequiredContent;
