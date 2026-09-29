import { Button } from "@/components/UI/Button";
import { Card } from "@/components/UI/Card";
import { getOptimalTokenBalance } from "@/functions/getOptimalTokenBalance";
import { useStore } from "@/stores/store";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import TokenListItem from "../../TokenListItem/TokenListItem";
import TokenListItemLoading from "../../TokenListItemLoading/TokenListItemLoading";

type ZRC20TokenProps = {
  contractAddress: string;
  tokenImage: string;
  /** Symbol recorded when the token was imported. Labels the row when the
   *  chain read fails, so a dead RPC leaves a named token with a retry.
   *  Without it the row stays a skeleton that never resolves. */
  storedSymbol?: string;
  triggerReRender?: () => void;
};

const ZRC20Token = observer(
  ({
    contractAddress,
    tokenImage,
    storedSymbol,
    triggerReRender,
  }: ZRC20TokenProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { qrlConnection, activeAccount, getZrc20TokenDetails } = qrlStore;
    const { blockchain } = qrlConnection;
    const { accountAddress } = activeAccount;

    const [token, setToken] =
      useState<Awaited<ReturnType<typeof getZrc20TokenDetails>>["token"]>();
    const [hasError, setHasError] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    // Bumped per lookup. A fast account switch A -> B -> A fires three
    // lookups against the same contract, and without this the first one to
    // resolve (holding A's balance) could land after the newest one and
    // present the wrong account's holding as current.
    const requestIdRef = useRef(0);

    useEffect(() => {
      const requestId = ++requestIdRef.current;
      setHasError(false);
      (async () => {
        const tokenDetails = await getZrc20TokenDetails(contractAddress);
        if (requestId !== requestIdRef.current) return;
        setIsRetrying(false);
        if (tokenDetails.error || !tokenDetails.token) {
          // Nothing was set on the error path before, so the row stayed a
          // loading skeleton for the rest of the session.
          setHasError(true);
          return;
        }
        setToken(tokenDetails.token);
        setHasError(false);
      })();
      return () => {
        // Discard whatever this run resolves to: it belongs to the account
        // or chain that was active when it started.
        requestIdRef.current++;
      };
    }, [blockchain, accountAddress, contractAddress, retryCount]);

    const retry = () => {
      setIsRetrying(true);
      setRetryCount((count) => count + 1);
    };

    if (hasError && !token) {
      const displayName =
        storedSymbol || formatQrlAddressFingerprint(contractAddress);
      return (
        <Card className="flex h-16 w-full animate-appear-in items-center justify-between gap-4 p-4 text-foreground">
          <div className="flex min-w-0 items-center gap-4">
            <TriangleAlert className="h-6 w-6 shrink-0 text-destructive" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="truncate text-xs font-bold">{displayName}</div>
              <div className="text-xs text-muted-foreground">
                {t("tokens.detailsUnavailable")}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 shrink-0"
            onClick={retry}
            disabled={isRetrying}
            aria-label={t("common.retry")}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
            />
          </Button>
        </Card>
      );
    }

    return !token ? (
      <TokenListItemLoading />
    ) : (
      <TokenListItem
        isZrc20Token={true}
        contractAddress={contractAddress}
        decimals={Number(token.decimals)}
        balance={getOptimalTokenBalance(token.balance.toString(), token.symbol)}
        balanceBaseUnits={token.balanceBaseUnits}
        name={token.name}
        symbol={token.symbol}
        image={tokenImage}
        triggerReRender={triggerReRender}
      />
    );
  },
);

export default ZRC20Token;
