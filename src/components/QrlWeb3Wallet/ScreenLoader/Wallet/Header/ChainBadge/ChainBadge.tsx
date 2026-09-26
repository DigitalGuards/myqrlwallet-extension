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
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import ChainBadgeIcon from "./ChainBadgeIcon/ChainBadgeIcon";

const badgeButtonClasses = cva(
  "flex items-center gap-1 rounded-full text-xs text-foreground",
  {
    variants: {
      isActive: {
        true: ["bg-accent"],
      },
    },
    defaultVariants: {
      isActive: false,
    },
  },
);

const connectivityStatusClasses = cva("h-2 w-2 rounded-full", {
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

type ChainBadgeProps = {
  isDisabled?: boolean;
  displayChainName?: boolean;
};

const ChainBadge = observer(
  ({ isDisabled = false, displayChainName = true }: ChainBadgeProps) => {
    const { t } = useTranslation();
    const location = useLocation();
    const pathName = location.pathname;
    const { qrlStore } = useStore();
    const { qrlConnection } = qrlStore;
    const { isLoading, isConnected, blockchain } = qrlConnection;
    const { chainName } = blockchain;

    return (
      <Link className="shrink-0" to={ROUTES.CHAIN_CONNECTIVITY}>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isDisabled || isLoading}
              className={badgeButtonClasses({
                isActive:
                  pathName === ROUTES.CHAIN_CONNECTIVITY ||
                  pathName === ROUTES.ADD_EDIT_CHAIN,
              })}
            >
              <Card
                className={connectivityStatusClasses({
                  hasChainConnected: isConnected,
                  isLoading,
                })}
              />
              <ChainBadgeIcon />
              {displayChainName && chainName}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Label>{t('nav.blockchainSelection')}</Label>
          </TooltipContent>
        </Tooltip>
      </Link>
    );
  },
);

export default ChainBadge;
