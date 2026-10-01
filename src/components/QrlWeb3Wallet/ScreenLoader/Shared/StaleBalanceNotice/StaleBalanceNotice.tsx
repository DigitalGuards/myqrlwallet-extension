import { useStore } from "@/stores/store";
import { WifiOff } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import RetryConnection from "../RetryConnection/RetryConnection";

/**
 * Warns on a send form that the balance it is guarding against is no
 * longer known to be current.
 *
 * The connection probe and the balance refresh are separate calls, so a
 * node can answer net_listening while qrl_getBalance keeps failing. The
 * status dot then goes back to connected while the amounts on screen are
 * hours old, and the send form's balance guard is checking against them.
 *
 * Deliberately non-blocking: the node validates the transaction, and a
 * send that is genuinely affordable must still go through. The point is
 * that the user sees the guard is working from old numbers.
 */
const StaleBalanceNotice = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { areBalancesStale } = qrlStore.qrlConnection;

  if (!areBalancesStale) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
      <p
        role="status"
        className="flex items-start gap-2 text-xs text-destructive"
      >
        <WifiOff className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{t("transfer.balancesStaleWarning")}</span>
      </p>
      {/* The automatic probe still runs; this only skips the rest of the
          current wait for someone who is looking at the form. */}
      <RetryConnection />
    </div>
  );
});

export default StaleBalanceNotice;
