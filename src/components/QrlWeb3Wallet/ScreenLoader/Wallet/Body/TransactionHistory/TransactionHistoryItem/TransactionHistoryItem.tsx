import { formatFiatCompact } from "@/functions/formatFiat";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import type {
  PendingStatus,
  TransactionHistoryEntry,
} from "@/types/transactionHistory";
import { ArrowDownLeft, ArrowUpRight, Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

type TransactionHistoryItemProps = {
  transaction: TransactionHistoryEntry;
};

function getDisplayStatus(
  pendingStatus?: PendingStatus,
  status?: boolean,
): PendingStatus {
  if (pendingStatus) return pendingStatus;
  return status ? "confirmed" : "failed";
}

function getStatusColor(displayStatus: PendingStatus): string {
  switch (displayStatus) {
    case "pending":
      return "text-amber-500";
    case "confirmed":
      return "text-success";
    case "failed":
      return "text-destructive";
    case "replaced":
    case "cancelled":
    case "dropped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "txDetail.statusPending",
  confirmed: "txDetail.statusConfirmed",
  failed: "txDetail.statusFailed",
  replaced: "txDetail.statusReplaced",
  cancelled: "txDetail.statusCancelled",
  dropped: "txDetail.statusDropped",
};

const TransactionHistoryItem = observer(({
  transaction,
}: TransactionHistoryItemProps) => {
  const { t } = useTranslation();
  const { priceStore, qrlStore, settingsStore } = useStore();
  const { amount, tokenSymbol, status, pendingStatus } = transaction;
  const navigate = useNavigate();
  const displayStatus = getDisplayStatus(pendingStatus, status);
  const isPending = displayStatus === "pending";

  // Explorer-sourced entries include transfers TO this account; local
  // entries are always sends. Self-sends render as sends.
  const accountAddress =
    qrlStore.activeAccount.accountAddress?.toLowerCase() ?? "";
  const isIncoming =
    !!accountAddress &&
    transaction.to?.toLowerCase() === accountAddress &&
    transaction.from?.toLowerCase() !== accountAddress;

  const { showBalanceAndPrice, currency } = settingsStore;
  const qrlPrice = priceStore.getPrice(currency);
  const fiatDisplay =
    showBalanceAndPrice && qrlPrice > 0 && !transaction.isZrc20Token
      ? formatFiatCompact(amount, qrlPrice, currency)
      : "";

  const handleAction = (
    e: React.MouseEvent,
    action: "speed-up" | "cancel",
  ) => {
    e.preventDefault();
    navigate(ROUTES.TRANSACTION_DETAIL, {
      state: { transaction, action },
    });
  };

  return (
    <Link to={ROUTES.TRANSACTION_DETAIL} state={{ transaction }}>
      <div className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent">
        {isIncoming ? (
          <ArrowDownLeft className="h-8 w-8 shrink-0 text-success" />
        ) : (
          <ArrowUpRight className="h-8 w-8 shrink-0 text-secondary" />
        )}
        <div className="flex flex-1 items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {t(
                transaction.isInternal
                  ? 'txHistory.typeContractTransfer'
                  : isIncoming
                    ? 'txHistory.typeReceive'
                    : 'txHistory.typeSend',
              )}
            </span>
            <span className={`text-xs ${getStatusColor(displayStatus)}`}>
              {isPending && (
                <Loader className="mr-1 inline h-3 w-3 animate-spin" />
              )}
              {t(STATUS_LABEL_KEYS[displayStatus] ?? 'txDetail.statusUnknown')}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span
              className={`text-sm font-medium ${isIncoming ? "text-success" : ""}`}
            >
              {isIncoming ? "+" : ""}
              {amount} {tokenSymbol}
            </span>
            {fiatDisplay && (
              <span className="text-[10px] text-muted-foreground">
                {fiatDisplay}
              </span>
            )}
            {isPending && transaction.nonce !== undefined && (
              <div className="mt-1 flex gap-1">
                <button
                  onClick={(e) => handleAction(e, "speed-up")}
                  className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/20"
                >
                  {t('txHistory.speedUp')}
                </button>
                <button
                  onClick={(e) => handleAction(e, "cancel")}
                  className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
                >
                  {t('txHistory.cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
});

export default TransactionHistoryItem;
