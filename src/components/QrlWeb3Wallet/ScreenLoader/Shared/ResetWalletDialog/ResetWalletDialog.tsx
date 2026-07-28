import { Button } from "@/components/UI/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { Input } from "@/components/UI/Input";
import { useStore } from "@/stores/store";
import { Loader, Trash2, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type ResetWalletDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Typed-confirmation factory reset. Shared between Settings > Data and the
 * lock screen's forgot-password escape hatch, so it must not assume the
 * wallet is unlocked. On confirm it wipes all local storage; the lock-state
 * listener then routes the UI to onboarding.
 */
const ResetWalletDialog = observer(
  ({ open, onOpenChange }: ResetWalletDialogProps) => {
    const { t } = useTranslation();
    const { lockStore } = useStore();
    const [confirmText, setConfirmText] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetError, setResetError] = useState("");

    const confirmWord = t("resetWallet.confirmWord");
    const isConfirmed = confirmText.trim() === confirmWord;

    const handleOpenChange = (nextOpen: boolean) => {
      if (isResetting) return;
      setConfirmText("");
      setResetError("");
      onOpenChange(nextOpen);
    };

    const onReset = async () => {
      if (!isConfirmed || isResetting) return;
      setIsResetting(true);
      setResetError("");
      try {
        await lockStore.resetWallet();
        // No local cleanup needed: the reset flips hasPasswordSet, which
        // unmounts this dialog together with the screen that opened it.
      } catch {
        // A partial wipe must not read as a completed one: keep the dialog
        // open and say so.
        setResetError(t("resetWallet.failed"));
      } finally {
        setIsResetting(false);
        setConfirmText("");
      }
    };

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-80 rounded-md">
          <DialogHeader className="text-left">
            <DialogTitle>{t("resetWallet.title")}</DialogTitle>
            <DialogDescription>
              {t("resetWallet.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t("resetWallet.confirmInstruction", { word: confirmWord })}
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
              disabled={isResetting}
              aria-label={t("resetWallet.confirmInstruction", {
                word: confirmWord,
              })}
            />
            {!!resetError && (
              <p className="text-sm font-medium text-destructive">
                {resetError}
              </p>
            )}
          </div>
          <DialogFooter className="flex flex-row gap-4">
            <DialogClose asChild>
              <Button
                className="w-full"
                type="button"
                variant="outline"
                disabled={isResetting}
              >
                <X className="mr-2 h-4 w-4" />
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              className="w-full"
              type="button"
              variant="destructive"
              disabled={!isConfirmed || isResetting}
              onClick={onReset}
            >
              {isResetting ? (
                <Loader className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4 shrink-0" />
              )}
              <span className="truncate">
                {isResetting
                  ? t("resetWallet.resetting")
                  : t("resetWallet.confirmButton")}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

export default ResetWalletDialog;
