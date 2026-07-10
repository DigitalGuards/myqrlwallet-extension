import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/UI/AlertDialog";
import { Button } from "@/components/UI/Button";
import { getOptimalGasFee } from "@/functions/getOptimalGasFee";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { utils } from "@theqrl/web3";
import { Loader } from "lucide-react";
import { useTranslation } from "react-i18next";

type ReplacementConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "speed-up" | "cancel";
  originalTransaction: TransactionHistoryEntry;
  estimatedNewGasFee: string;
  isProcessing: boolean;
  error: string;
  onConfirm: () => void;
};

const ReplacementConfirmationDialog = ({
  open,
  onOpenChange,
  action,
  originalTransaction,
  estimatedNewGasFee,
  isProcessing,
  error,
  onConfirm,
}: ReplacementConfirmationDialogProps) => {
  const { t } = useTranslation();
  const isSpeedUp = action === "speed-up";
  const title = isSpeedUp ? t('txDetail.speedUpTitle') : t('txDetail.cancelTitle');
  const description = isSpeedUp
    ? t('txDetail.speedUpDescription')
    : t('txDetail.cancelDescription');

  const originalGasCost =
    originalTransaction.gasUsed && originalTransaction.effectiveGasPrice
      ? utils.fromPlanck(
          Number(originalTransaction.gasUsed) *
            Number(originalTransaction.effectiveGasPrice),
          "quanta",
        )
      : "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-80 rounded-md">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 px-1">
          {originalGasCost && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('txDetail.originalGasFee')}</span>
              <span>{getOptimalGasFee(originalGasCost)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t('txDetail.newEstimatedGasFee')}
            </span>
            <span className="font-medium text-amber-500">
              {estimatedNewGasFee
                ? getOptimalGasFee(estimatedNewGasFee)
                : t('txDetail.estimating')}
            </span>
          </div>
        </div>

        {error && (
          <p className="px-1 text-xs text-destructive">{error}</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>
            {t('txDetail.goBack')}
          </AlertDialogCancel>
          <Button onClick={onConfirm} disabled={isProcessing}>
            {isProcessing && (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isSpeedUp ? t('txDetail.speedUp') : t('txDetail.cancelTransaction')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ReplacementConfirmationDialog;
