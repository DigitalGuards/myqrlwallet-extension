import { Button } from "@/components/UI/Button";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StringUtil from "@/utilities/stringUtil";
import { cva } from "class-variance-authority";
import { Wallet } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

// Blue identifies: the account marker wears the QRL battery blue.
const badgeButtonClasses = cva(
  "font-data flex items-center gap-1 rounded-full border-blue-accent/30 text-xs text-blue-accent hover:text-blue-accent",
  {
    variants: {
      isActive: {
        true: ["bg-blue-accent/10"],
      },
    },
    defaultVariants: {
      isActive: false,
    },
  },
);

const AccountBadge = observer(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const pathName = location.pathname;
  const { qrlStore, accountLabelsStore } = useStore();
  const { activeAccount } = qrlStore;
  const { accountAddress } = activeAccount;

  useEffect(() => {
    if (accountAddress) {
      accountLabelsStore.loadLabels();
    }
  }, [accountAddress]);

  const label = accountLabelsStore.getLabel(accountAddress);
  const { prefix, addressSplit } = StringUtil.getSplitAddress(accountAddress);
  const abbreviatedAddress = `${prefix}${addressSplit[0]}...${addressSplit[addressSplit.length - 1]}`;
  const account = label || abbreviatedAddress;

  return (
    !!accountAddress && (
      <Link to={ROUTES.ACCOUNT_LIST}>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={badgeButtonClasses({
                isActive: pathName === ROUTES.ACCOUNT_LIST,
              })}
            >
              <Wallet className="h-3 w-3" />
              {account}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Label>{t('nav.accounts')}</Label>
          </TooltipContent>
        </Tooltip>
      </Link>
    )
  );
});

export default AccountBadge;
