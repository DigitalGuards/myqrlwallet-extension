import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { ExternalLink, MoveLeft } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const WALLET_VERSION =
  typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : "0.4.0";
const REPO_URL = "https://github.com/DigitalGuards/myqrlwallet-extension";

const SettingsAbout = observer(() => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlConnection, qrlAccounts } = qrlStore;
  const networkName = qrlConnection.blockchain.chainName;
  const chainId = parseInt(qrlConnection.blockchain.chainId, 16);
  const accountCount = qrlAccounts.accounts.length;

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MoveLeft
                className="cursor-pointer transition-all hover:text-secondary"
                onClick={() => navigate(ROUTES.SETTINGS)}
                data-testid="back-arrow"
              />
              {t("settings.about.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.about.version")}</span>
                <span>{WALLET_VERSION}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.about.network")}</span>
                <span>{networkName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.about.chainId")}</span>
                <span>{chainId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.about.accounts")}</span>
                <span>{accountCount}</span>
              </div>
              <Separator className="my-1" />
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-secondary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("settings.about.github")}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default SettingsAbout;
