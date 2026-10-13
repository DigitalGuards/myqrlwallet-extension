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
import { Check, Unlink, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "react-router-dom";
import ActiveBrowserTabIcon from "./ActiveBrowserTabIcon/ActiveBrowserTabIcon";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const connectivityStatusClasses = cva("h-3 w-3 rounded-full", {
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

const ActiveBrowserTab = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { dAppRequestStore } = useStore();
  const { hasDAppConnected, currentTabData } = dAppRequestStore;

  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const disconnect = async () => {
    setDisconnectDialogOpen(false);
    await dAppRequestStore.disconnectFromCurrentTab();
    await navigate(ROUTES.HOME);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-lg">{t('dapp.activeBrowserTab')}</Label>
      <Card className="flex justify-between gap-4 p-4">
        <div className="flex gap-4">
          <div className="flex h-min items-center gap-2 pt-1">
            <Card
              className={connectivityStatusClasses({
                hasDAppConnected,
              })}
            />
            <ActiveBrowserTabIcon
              favIconUrl={currentTabData?.favIconUrl}
              altText={currentTabData?.title}
            />
          </div>
          <div className="flex flex-col break-all">
            <span className="font-bold">{currentTabData?.urlOrigin}</span>
            <span className="text-xm opacity-80">{currentTabData?.title}</span>
          </div>
        </div>
        {hasDAppConnected && (
          <div>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  className="size-7"
                  variant="destructive"
                  size="icon"
                  aria-label={t("dapp.disconnect")}
                  onClick={() => {
                    setDisconnectDialogOpen(true);
                  }}
                >
                  <Unlink size="16" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <Label>{t('dapp.disconnect')}</Label>
              </TooltipContent>
            </Tooltip>
            <Dialog
              open={disconnectDialogOpen}
              onOpenChange={setDisconnectDialogOpen}
            >
              <DialogContent className="w-80 rounded-md">
                <DialogHeader className="text-left">
                  <DialogTitle>{t('dapp.disconnect')}</DialogTitle>
                  <DialogDescription>
                    {t('dapp.disconnectConfirm', { origin: currentTabData?.urlOrigin })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-row gap-4">
                  <DialogClose asChild>
                    <Button
                      className="w-full"
                      type="button"
                      variant="outline"
                      aria-label={t('dapp.cancelDisconnect')}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('common.no')}
                    </Button>
                  </DialogClose>
                  <Button
                    className="w-full"
                    type="button"
                    aria-label={t('dapp.confirmDisconnect')}
                    onClick={() => {
                      disconnect().catch((error: unknown) => {
                        console.error("Failed to disconnect dApp:", error);
                      });
                    }}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    {t('common.yes')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </Card>
    </div>
  );
});

export default ActiveBrowserTab;
