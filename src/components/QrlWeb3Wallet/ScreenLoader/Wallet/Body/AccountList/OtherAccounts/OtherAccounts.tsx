import { Button } from "@/components/UI/Button";
import { Card } from "@/components/UI/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  EllipsisVertical,
  EyeOff,
  Loader,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import AccountId from "../AccountId/AccountId";

type OtherAccountCardProps = {
  accountAddress: string;
  onSwitch: (address: string) => void;
  onCopy: (address: string) => void;
  onReceive: (address: string) => void;
  onHide: (address: string) => void;
  onRemove: (address: string) => Promise<void>;
};

const OtherAccountCard = observer(
  ({ accountAddress, onSwitch, onCopy, onReceive, onHide, onRemove }: OtherAccountCardProps) => {
    const { t } = useTranslation();
    const { accountLabelsStore } = useStore();
    const label = accountLabelsStore.getLabel(accountAddress);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [removeError, setRemoveError] = useState("");

    const confirmRemove = async () => {
      setIsRemoving(true);
      setRemoveError("");
      try {
        await onRemove(accountAddress);
        setRemoveDialogOpen(false);
      } catch (error) {
        // Keep the dialog open on failure: a partially applied removal must
        // not look like a completed one.
        setRemoveError(
          error instanceof Error &&
            error.message === "REMOVE_LAST_KEYSTORE_BLOCKED"
            ? t("home.removeLastKeystoreBlocked")
            : t("home.removeAccountFailed"),
        );
      } finally {
        setIsRemoving(false);
      }
    };

    const startEdit = () => {
      setEditValue(label);
      setIsEditing(true);
    };

    const cancelEdit = () => {
      setIsEditing(false);
    };

    const saveEdit = async () => {
      const trimmed = editValue.trim();
      if (trimmed) {
        await accountLabelsStore.setLabel(accountAddress, trimmed);
      }
      setIsEditing(false);
    };

    return (
      <Card className="flex flex-col gap-2 p-3 font-bold text-foreground">
        {isEditing && (
          <div className="flex items-center gap-1">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              className="h-6 w-32 text-xs"
              autoFocus
              maxLength={50}
              aria-label={t('home.editAccountLabel')}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={saveEdit}
              aria-label={t('home.saveLabel')}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={cancelEdit}
              aria-label={t('home.cancelEdit')}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex w-full items-center gap-3">
          <div className="min-w-0 flex-1">
            <AccountId account={accountAddress} hideLabel={isEditing} />
          </div>
          <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <EllipsisVertical
                size="16"
                className="cursor-pointer"
                data-testid="account-menu"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => onSwitch(accountAddress)}
                >
                  <div className="flex gap-2">
                    <ArrowRight size="16" />
                    <span>{t('home.switch')}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => onReceive(accountAddress)}
                >
                  <div className="flex gap-2">
                    <Download size="16" />
                    <span>{t('home.receive')}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => onCopy(accountAddress)}
                >
                  <div className="flex gap-2">
                    <Copy size="16" />
                    <span>{t('home.copyAddress')}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={startEdit}
                >
                  <div className="flex gap-2">
                    <Pencil size="16" />
                    <span>{t('home.rename')}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => onHide(accountAddress)}
                >
                  <div className="flex gap-2">
                    <EyeOff size="16" />
                    <span>{t('home.hide')}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer text-destructive data-[highlighted]:text-destructive"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <div className="flex gap-2">
                    <Trash2 size="16" />
                    <span>{t('home.remove')}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
        <Dialog
          open={removeDialogOpen}
          onOpenChange={(nextOpen) => {
            // Escape / overlay / X must not dismiss mid-removal: the
            // operation keeps running and a closed dialog reads as done.
            if (isRemoving) return;
            setRemoveError("");
            setRemoveDialogOpen(nextOpen);
          }}
        >
          <DialogContent className="w-80 rounded-md">
            <DialogHeader className="text-left">
              <DialogTitle>{t("home.removeAccountTitle")}</DialogTitle>
              <DialogDescription>
                {t("home.removeAccountConfirm")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0">
              <AccountId account={accountAddress} />
            </div>
            {!!removeError && (
              <p className="text-sm font-medium text-destructive">
                {removeError}
              </p>
            )}
            <DialogFooter className="flex flex-row gap-4">
              <DialogClose asChild>
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  disabled={isRemoving}
                >
                  <X className="mr-2 h-4 w-4" />
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button
                className="w-full min-w-0"
                type="button"
                variant="destructive"
                disabled={isRemoving}
                onClick={confirmRemove}
              >
                {isRemoving ? (
                  <Loader className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{t("home.remove")}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  },
);

const OtherAccounts = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    qrlStore,
    hiddenAccountsStore,
    ledgerStore,
    lockStore,
    accountLabelsStore,
  } = useStore();
  const { qrlAccounts, activeAccount, setActiveAccount } = qrlStore;
  const { accountAddress: activeAccountAddress } = activeAccount;
  const { accounts } = qrlAccounts;

  const otherAccountsLabel = activeAccountAddress
    ? t('home.otherAccountsLabel')
    : t('home.accountsLabel');
  const otherAccounts = accounts.filter(
    ({ accountAddress }) =>
      accountAddress !== activeAccountAddress &&
      !hiddenAccountsStore.isHidden(accountAddress),
  );

  const copyAccount = (accountAddress: string) => {
    navigator.clipboard.writeText(accountAddress);
  };

  const receiveAccount = (accountAddress: string) => {
    navigate(ROUTES.RECEIVE, { state: { accountAddress } });
  };

  const onAccountSwitch = async (accountAddress: string) => {
    await StorageUtil.clearTransactionValues();
    navigate(ROUTES.HOME);
    await setActiveAccount(accountAddress);
  };

  const onHide = async (accountAddress: string) => {
    await hiddenAccountsStore.hideAccount(accountAddress);
  };

  const onRemove = async (accountAddress: string) => {
    // Bail out before anything destructive if this removal is not allowed.
    await qrlStore.assertAccountRemovable(accountAddress);
    // Scrub the decrypted key first and let a failure abort the removal:
    // deleting the keystore while the service worker still holds (and
    // session-backs-up) the plaintext mnemonic is the one ordering that
    // leaves secret material behind.
    await lockStore.removeAccountKey(accountAddress);
    // Ledger accounts have no keystore; drop their device metadata instead.
    if (ledgerStore.isLedgerAccount(accountAddress)) {
      await ledgerStore.removeAccount(accountAddress);
    }
    await qrlStore.removeAccount(accountAddress);
    await accountLabelsStore.removeLabel(accountAddress);
    await hiddenAccountsStore.unhideAccount(accountAddress);
  };

  return (
    !!otherAccounts.length && (
      <div className="flex flex-col gap-2">
        <Label className="text-lg">{otherAccountsLabel}</Label>
        {otherAccounts.map(({ accountAddress }) => (
          <OtherAccountCard
            key={accountAddress}
            accountAddress={accountAddress}
            onSwitch={onAccountSwitch}
            onCopy={copyAccount}
            onReceive={receiveAccount}
            onHide={onHide}
            onRemove={onRemove}
          />
        ))}
      </div>
    )
  );
});

export default OtherAccounts;
