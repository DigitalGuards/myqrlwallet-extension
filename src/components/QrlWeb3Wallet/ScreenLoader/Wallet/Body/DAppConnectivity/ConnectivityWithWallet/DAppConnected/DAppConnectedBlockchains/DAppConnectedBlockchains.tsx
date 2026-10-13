import { storedText } from "@/utilities/storageViews";
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
import ChainIcon from "../../../../ChainConnectivity/ChainIcon/ChainIcon";

const DAppConnectedBlockchains = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { currentTabData } = dAppRequestStore;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <div className="text-sm">
          {t('dapp.connectedBlockchainsDescription')}
        </div>
        <div className="shrink-0">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                to={ROUTES.EDIT_DAPP_CONNECTED_BLOCKCHAINS}
                state={{ hasState: true }}
                aria-label={t('dapp.editConnectedBlockchains')}
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
              <Label>{t('dapp.editConnectedBlockchains')}</Label>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {currentTabData?.connectedBlockchains?.map(
          ({ chainId, chainName, defaultIconUrl, defaultRpcUrl }) => (
            <Card key={chainId} className="flex justify-between gap-3 p-3">
              <div className="flex gap-3">
                <div className="pt-1">
                  <ChainIcon src={storedText(defaultIconUrl)} alt={storedText(chainName)} />
                </div>
                <div className="flex flex-col break-all">
                  <span className="font-bold">{storedText(chainName)}</span>
                  <span className="text-xm opacity-80">
                    {t('dapp.chainId', { id: parseInt(chainId, 16) })}
                  </span>
                  <span className="text-xm opacity-80">{storedText(defaultRpcUrl)}</span>
                </div>
              </div>
            </Card>
          ),
        )}
      </div>
    </Card>
  );
});

export default DAppConnectedBlockchains;
