import { Button } from "@/components/UI/Button";
import { Card } from "@/components/UI/Card";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { cva } from "class-variance-authority";
import { Pencil } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import RetryConnection from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/RetryConnection/RetryConnection";
import ChainIcon from "../ChainIcon/ChainIcon";

const connectivityStatusClasses = cva("h-3 w-3 rounded-full", {
  variants: {
    hasChainConnected: {
      true: ["bg-constructive"],
      false: ["bg-destructive"],
    },
    isLoading: {
      true: ["bg-secondary animate-ping"],
    },
  },
  defaultVariants: {
    hasChainConnected: false,
    isLoading: true,
  },
});

const ActiveChain = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isLoading, isConnected, areBalancesStale, blockchain } =
    qrlConnection;
  const { chainId, chainName, defaultRpcUrl, defaultIconUrl } = blockchain;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-lg">{t("chain.activeChain")}</Label>
      <Card className="flex justify-between gap-4 p-4">
        <div className="flex gap-4">
          <div className="flex h-min items-center gap-2 pt-1">
            <Card
              className={connectivityStatusClasses({
                hasChainConnected: isConnected,
                isLoading,
              })}
            />
            <ChainIcon src={defaultIconUrl} alt={chainName} />
          </div>
          <div className="flex flex-col break-all">
            <span className="font-bold">{chainName}</span>
            <span className="text-xm opacity-80">
              {t("chain.chainId", { chainId: parseInt(chainId, 16) })}
            </span>
            <span className="text-xm opacity-80">{defaultRpcUrl}</span>
            {!isLoading && !isConnected && (
              <span className="text-xm text-destructive">
                {t("chain.nodeUnreachable")}
              </span>
            )}
            {areBalancesStale && (
              <span className="text-xm text-destructive">
                {t("chain.balancesStale")}
              </span>
            )}
            {/* Stale balances count as unreachable here. A balance read
                that times out while net_listening still answers leaves a
                green dot over "Balances may be out of date", which is
                exactly the state someone would want to retry out of. */}
            {!isLoading && (!isConnected || areBalancesStale) && (
              <RetryConnection className="mt-2" />
            )}
          </div>
        </div>
        <div>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                to={ROUTES.ADD_EDIT_CHAIN}
                state={{ hasState: true, chainId }}
                aria-label={t("chain.editChain")}
              >
                <Button
                  className="size-7 hover:bg-accent hover:text-secondary"
                  variant="outline"
                  size="icon"
                  aria-label={t("chain.editChain")}
                >
                  <Pencil size="16" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left">
              <Label>{t("chain.editChain")}</Label>
            </TooltipContent>
          </Tooltip>
        </div>
      </Card>
    </div>
  );
});

export default ActiveChain;
