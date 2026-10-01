import { Button } from "@/components/UI/Button";
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
  const { isProbing, nextManualProbeAt } = qrlStore.qrlConnection;
  const [outcome, setOutcome] = useState<"" | "connected" | "unreachable">("");
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The cooldown deadline lives on the store, so navigating away and back
  // cannot present a button that looks ready and then answers without
  // probing. This only re-renders when the deadline passes.
  const coolingDown = now < nextManualProbeAt;
  useEffect(() => {
    if (now >= nextManualProbeAt) return;
    const timer = setTimeout(() => {
      if (mounted.current) setNow(Date.now());
    }, nextManualProbeAt - now);
    return () => {
      clearTimeout(timer);
    };
  }, [now, nextManualProbeAt]);

  const retry = async () => {
    // Two guards, stopping different things: the in-flight check stops a
    // double click starting a second probe, and the cooldown stops a tight
    // loop of manual probes holding the automatic schedule at zero. The
    // button stays mounted and disabled through the cooldown so it does
    // not flicker out from under the pointer.
    if (isProbing || coolingDown) return;
    setOutcome("");
    setNow(Date.now());

    const result = await qrlStore.probeConnectionNow({ manual: true });
    if (!mounted.current) return;
    setNow(Date.now());
    // A skipped call checked nothing, so it has no verdict to report.
    if (!result.probed) return;
    setOutcome(result.isConnected ? "connected" : "unreachable");
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
      {/* Always mounted, so the announcement is a text change inside a
          live region. A region that only appears on settle is missed by
          some screen readers. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs",
          outcome === "unreachable" && !busy ? "text-destructive" : "sr-only",
        )}
      >
        {message}
      </span>
    </div>
  );
});

export default RetryConnection;
