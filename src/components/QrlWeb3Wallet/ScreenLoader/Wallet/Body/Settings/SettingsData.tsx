import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import { Separator } from "@/components/UI/Separator";
import StorageUtil from "@/utilities/storageUtil";
import { Download, MoveLeft, Trash2 } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import ResetWalletDialog from "../../../Shared/ResetWalletDialog/ResetWalletDialog";

const WALLET_VERSION = "0.1.1";

const SettingsData = observer(() => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const exportBackup = async () => {
    setExporting(true);
    try {
      const keystores = await StorageUtil.getKeystores();
      const accounts = await StorageUtil.getAllAccounts();
      const activeChain = await StorageUtil.getActiveBlockChain();

      const backup = {
        version: WALLET_VERSION,
        exportedAt: new Date().toISOString(),
        keystores,
        accounts,
        activeChain: {
          chainId: activeChain.chainId,
          chainName: activeChain.chainName,
        },
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qrl-wallet-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

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
              {t("settings.data.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("settings.data.exportDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={exportBackup}
              disabled={exporting}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {exporting ? t("settings.data.exportingButton") : t("settings.data.exportButton")}
            </Button>
            <Separator className="my-5" />
            <p className="mb-3 text-xs text-muted-foreground">
              {t("settings.data.resetDescription")}
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setResetDialogOpen(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("settings.data.resetButton")}
            </Button>
          </CardContent>
        </Card>
        <ResetWalletDialog
          open={resetDialogOpen}
          onOpenChange={setResetDialogOpen}
        />
      </div>
    </div>
  );
});

export default SettingsData;
