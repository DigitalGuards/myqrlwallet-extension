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
import DAppBadgeIcon from "./DAppBadgeIcon/DAppBadgeIcon";

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
    hasDAppConnected: {
      true: ["bg-constructive"],
      false: ["bg-destructive"],
    },
  },
  defaultVariants: {
    hasDAppConnected: false,
  },
});

const DAppBadge = observer(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const pathName = location.pathname;
  const { dAppRequestStore } = useStore();
  const { hasDAppConnected } = dAppRequestStore;

  return (
    <Link className="shrink-0" to={ROUTES.DAPP_CONNECTIVITY}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={badgeButtonClasses({
              isActive:
                pathName === ROUTES.DAPP_CONNECTIVITY ||
                pathName === ROUTES.EDIT_DAPP_CONNECTED_ACCOUNTS ||
                pathName === ROUTES.EDIT_DAPP_CONNECTED_BLOCKCHAINS,
            })}
          >
            <Card
              className={connectivityStatusClasses({
                hasDAppConnected,
              })}
            />
            <DAppBadgeIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Label>{t('nav.dappConnectivity')}</Label>
        </TooltipContent>
      </Tooltip>
    </Link>
  );
});

export default DAppBadge;
