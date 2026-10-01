import { Button } from "@/components/UI/Button";
import { MANUAL_PROBE_COOLDOWN_MS } from "@/stores/qrlStore";
import { useStore } from "@/stores/store";
import { cn } from "@/utilities/stylingUtil";
import { Loader, RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type RetryConnectionProps = {
  className?: string;
};

/**
 * Manual backup for the automatic connection recovery.
 *
 * Recovery is automatic and stays that way: the online and visibility
 * handlers plus the capped backoff bring a healthy node back without
 * anyone pressing anything. This only lets someone who is watching skip
 * the rest of the current wait.
 *
 * Rendered by the surfaces that already show the unreachable state, so the
 * control sits next to the bad news. It runs the same probe entry point
 * the automatic handlers use, so there is one path to reason about.
 */
const RetryConnection = observer(({ className }: RetryConnectionProps) => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { isProbing } = qrlStore.qrlConnection;
  const [coolingDown, setCoolingDown] = useState(false);
  const [outcome, setOutcome] = useState<"" | "connected" | "unreachable">("");
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  const retry = async () => {
    // Two guards, stopping different things: the in-flight check stops a
    // double click starting a second probe, and the cooldown stops a tight
    // loop of manual probes holding the automatic schedule at zero. The
    // button stays mounted and disabled through the cooldown so it does
    // not flicker out from under the pointer.
    if (isProbing || coolingDown) return;
    setCoolingDown(true);
    setOutcome("");
    cooldownTimer.current = setTimeout(() => {
      if (mounted.current) setCoolingDown(false);
    }, MANUAL_PROBE_COOLDOWN_MS);

    const reachable = await qrlStore.probeConnectionNow({ manual: true });
    if (mounted.current) setOutcome(reachable ? "connected" : "unreachable");
  };

  const busy = isProbing;
  const message = busy
    ? t("chain.retryConnectionBusy")
    : outcome === "connected"
      ? t("chain.retryConnectionSucceeded")
      : outcome === "unreachable"
        ? t("chain.retryConnectionFailed")
        : "";

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => {
          void retry();
        }}
        disabled={busy || coolingDown}
        aria-busy={busy}
      >
        {busy ? (
          <Loader className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3 shrink-0" />
        )}
        {t("chain.retryConnection")}
      </Button>
      {/* Always mounted so the announcement is a text change inside a live
          region rather than a region appearing, which some screen readers
          miss. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xm",
          outcome === "unreachable" && !busy
            ? "text-destructive"
            : "sr-only",
        )}
      >
        {message}
      </span>
    </div>
  );
});

export default RetryConnection;
