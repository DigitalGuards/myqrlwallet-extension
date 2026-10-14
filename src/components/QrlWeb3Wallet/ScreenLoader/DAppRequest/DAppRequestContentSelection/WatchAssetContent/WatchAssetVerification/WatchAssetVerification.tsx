import { Card } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import { Loader, ShieldAlert } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readWatchAssetOptions } from "@/utilities/approvalGuards";

const WatchAssetVerification = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;
  const asset = readWatchAssetOptions(dAppRequestData?.params);
  const contractAddress = asset?.address ?? "";
  const contractSymbol = asset?.symbol ?? "";
  const contractDecimals = BigInt(asset?.decimals ?? 0);

  const [hasVerified, setHasVerified] = useState(false);
  const [verificationResult, setVerificationResult] = useState("");

  useEffect(() => {
    (async () => {
      if (!asset) {
        setVerificationResult(
          t("dapp.watchAsset.fetchFailed", { address: contractAddress }),
        );
        setHasVerified(true);
        return;
      }
      const tokenDetails = await qrlStore.getZrc20TokenDetails(contractAddress);
      if (tokenDetails.error || !tokenDetails.token) {
        setVerificationResult(
          t("dapp.watchAsset.fetchFailed", { address: contractAddress }),
        );
      } else {
        if (tokenDetails.token.symbol !== contractSymbol) {
          setVerificationResult(
            t("dapp.watchAsset.symbolMismatch", {
              expected: tokenDetails.token.symbol,
              received: contractSymbol,
            }),
          );
        } else if (tokenDetails.token.decimals !== contractDecimals) {
          setVerificationResult(
            t("dapp.watchAsset.decimalsMismatch", {
              expected: String(tokenDetails.token.decimals),
              received: String(contractDecimals),
            }),
          );
        }
      }
      setHasVerified(true);
    })().catch((error: unknown) => {
      console.warn("QrlWeb3Wallet: Failed to verify token details", error);
      setVerificationResult(
        t("dapp.watchAsset.fetchFailed", { address: contractAddress }),
      );
      setHasVerified(true);
    });
  }, []);

  if (!hasVerified) {
    return (
      <Card className="flex gap-4 p-4">
        <Loader className="h-4 w-4 shrink-0 animate-spin" />
        <div>{t("dapp.watchAsset.verifying")}</div>
      </Card>
    );
  }

  return verificationResult ? (
    <Card className="flex min-w-0 gap-2 p-4 text-destructive">
      <ShieldAlert className="h-5 w-5 shrink-0 pt-1" />
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        {verificationResult}
      </div>
    </Card>
  ) : (
    <Card className="flex gap-2 p-4">
      <ShieldAlert className="h-5 w-5 shrink-0 pt-1" />
      <div>{t("dapp.watchAsset.understand")}</div>
    </Card>
  );
});

export default WatchAssetVerification;
