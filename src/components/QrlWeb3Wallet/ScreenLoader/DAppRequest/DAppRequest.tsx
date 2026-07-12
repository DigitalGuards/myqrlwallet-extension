import { DAPP_REQUEST_PORT_NAME } from "@/scripts/constants/streamConstants";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import BrandedLoader from "../Shared/BrandedLoader/BrandedLoader";
import CircuitBackground from "../Shared/CircuitBackground/CircuitBackground";
import DAppRequestContentSelection from "./DAppRequestContentSelection/DAppRequestContentSelection";
import PhishingWarning from "./PhishingWarning/PhishingWarning";

const DAppRequest = observer(() => {
  const { t } = useTranslation();
  const { qrlStore, dAppRequestStore, settingsStore } = useStore();
  const { qrlConnection, initProgress } = qrlStore;
  const { isLoading } = qrlConnection;
  const { dAppRequestData, approvalProcessingStatus, onPermission } =
    dAppRequestStore;
  const { hasCompleted } = approvalProcessingStatus;
  const { phishingDetectionEnabled, isPopupWindow } = settingsStore;

  const [phishingAcknowledged, setPhishingAcknowledged] = useState(false);

  const phishingResult = dAppRequestData?.phishingResult;
  const isDomainPhishing =
    phishingDetectionEnabled && (phishingResult?.isDomainPhishing ?? false);
  const showPhishingWarning = isDomainPhishing && !phishingAcknowledged;
  const phishingDetectorUnavailable =
    phishingDetectionEnabled &&
    phishingResult !== undefined &&
    phishingResult.detectorStatus !== undefined &&
    phishingResult.detectorStatus !== "ready";

  useEffect(() => {
    // Only the transient action popup closes itself after resolving; in the
    // docked side panel (and the expanded tab) window.close() tears the whole
    // surface down. There the storage.onChanged listener in dAppRequestStore
    // already resets the request state when the middleware entry clears, and
    // ScreenLoader falls back to the wallet screen on its own.
    if (hasCompleted && isPopupWindow) {
      window.close();
    }
  }, [hasCompleted, isPopupWindow]);

  // Hold a port open while the dApp request is on screen. The middleware
  // listens for this port's disconnect to resolve as user-rejected when the
  // popup is closed without an explicit Approve/Reject click.
  useEffect(() => {
    let port: browser.Runtime.Port | undefined;
    try {
      port = browser.runtime.connect({ name: DAPP_REQUEST_PORT_NAME });
    } catch {
      // SW not reachable; the middleware's safety timeout will resolve.
    }
    return () => {
      try {
        port?.disconnect();
      } catch {
        // already disconnected
      }
    };
  }, []);

  // Same branded boot loader as the wallet home screen: the dApp request
  // popup is usually a cold start, so it hits this state on every spawn.
  if (isLoading) {
    const phaseLabels = {
      chain: t("loader.phaseChain"),
      network: t("loader.phaseNetwork"),
      accounts: t("loader.phaseAccounts"),
      session: t("loader.phaseSession"),
    } as const;
    return (
      <>
        <CircuitBackground />
        <div className="relative z-10 flex w-full justify-center pt-24">
          <BrandedLoader
            progress={initProgress?.active ? initProgress.fraction : undefined}
            label={
              initProgress?.active
                ? phaseLabels[initProgress.phase]
                : t("home.connecting")
            }
          />
        </div>
      </>
    );
  }

  const senderUrl = dAppRequestData?.requestData?.senderData?.url ?? "";
  let domain = "";
  try {
    domain = new URL(senderUrl).hostname;
  } catch {
    // invalid URL
  }

  return (
    <>
      <CircuitBackground />
      <div className="relative z-10 flex flex-col items-center space-y-4 p-4">
        {phishingDetectorUnavailable && (
          <div className="w-full max-w-md rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200">
            <strong>Phishing protection unavailable.</strong> The wallet
            could not load its phishing blocklist
            {phishingResult?.detectorStatus
              ? ` (${phishingResult.detectorStatus})`
              : ""}
            . The dApp below has not been checked against any blocklist;
            verify the origin manually before approving.
          </div>
        )}
        <DAppRequestContentSelection />
      </div>
      <PhishingWarning
        isOpen={showPhishingWarning}
        domain={domain}
        matchedDomain={phishingResult?.matchedDomain}
        onReject={() => onPermission(false)}
        onProceedAnyway={() => setPhishingAcknowledged(true)}
      />
    </>
  );
});

export default DAppRequest;
