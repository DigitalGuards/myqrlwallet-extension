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
import { Pencil } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import AccountId from "../../../../AccountList/AccountId/AccountId";

const DAppConnectedAccounts = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { currentTabData } = dAppRequestStore;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <div className="text-sm">
          {t('dapp.connectedAccountsDescription')}
        </div>
        <div className="shrink-0">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                to={ROUTES.EDIT_DAPP_CONNECTED_ACCOUNTS}
                state={{ hasState: true }}
                aria-label={t('dapp.editConnectedAccounts')}
              >
                <Button
                  className="size-7 hover:bg-accent hover:text-secondary"
                  variant="outline"
                  size="icon"
                  aria-label={t('common.edit')}
                >
                  <Pencil size="16" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left">
              <Label>{t('dapp.editConnectedAccounts')}</Label>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {currentTabData?.connectedAccounts.map((accountAddress) => (
          <Card
            key={accountAddress}
            id={accountAddress}
            className="p-3 font-bold text-foreground"
          >
            <AccountId account={accountAddress} />
          </Card>
        ))}
      </div>
    </Card>
  );
});

export default DAppConnectedAccounts;
