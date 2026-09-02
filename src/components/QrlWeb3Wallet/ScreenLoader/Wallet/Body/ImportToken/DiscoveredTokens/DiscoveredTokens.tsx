import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { DiscoveredToken, discoverTokens } from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { ChevronRight, Loader, Sparkles } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DiscoveredTokensProps = {
  // Opens the same review screen the manual import path uses, so a
  // discovered token is never added on the explorer's word alone: the
  // user sees the chain-read name, symbol, supply and balance first.
  onReview: (token: DiscoveredToken) => Promise<void>;
};

/**
 * Explorer-discovered tokens the active account owns but has not imported
 * yet, listed above the manual import form. Each row opens the import
 * review screen. Renders nothing when the explorer sees no unimported
 * tokens.
 */
const DiscoveredTokens = observer(({ onReview }: DiscoveredTokensProps) => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const [pendingTokens, setPendingTokens] = useState<DiscoveredToken[]>([]);
  const [reviewingAddress, setReviewingAddress] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!accountAddress) return;
      const [discovered, stored] = await Promise.all([
        discoverTokens(accountAddress, blockchain.chainId),
        StorageUtil.getTokenContractsList(accountAddress),
      ]);
      if (cancelled) return;
      const existing = new Set(
        stored.map((token) => token.address.toLowerCase()),
      );
      setPendingTokens(
        discovered.filter(
          (token) => !existing.has(token.address.toLowerCase()),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountAddress, blockchain]);

  const review = async (token: DiscoveredToken) => {
    if (reviewingAddress) return;
    setReviewingAddress(token.address);
    try {
      await onReview(token);
    } finally {
      setReviewingAddress(undefined);
    }
  };

  if (pendingTokens.length === 0) return null;

  return (
    <Card className="mb-8 w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-secondary" />
          {t("discovery.discoveredTokens", { count: pendingTokens.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("discovery.tokenPickerHint")}
        </p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {pendingTokens.map((token) => {
            const key = token.address.toLowerCase();
            const isReviewing = reviewingAddress === token.address;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border bg-background p-2 text-left hover:ring-1 hover:ring-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={t("discovery.reviewToken", {
                    name: token.name || token.symbol,
                  })}
                  disabled={reviewingAddress !== undefined}
                  onClick={() => void review(token)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {token.name}{" "}
                      <span className="text-muted-foreground">
                        ({token.symbol})
                      </span>
                    </span>
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {token.address}
                    </span>
                  </span>
                  {isReviewing ? (
                    <Loader className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
});

export default DiscoveredTokens;
