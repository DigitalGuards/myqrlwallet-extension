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
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import {
  Check,
  CircleMinus,
  Copy,
  EllipsisVertical,
  Send,
  X,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import TokenListItemIcon from "./TokenListItemIcon/TokenListItemIcon";

type TokenListItemProps = {
  isZrc20Token?: boolean;
  contractAddress?: string;
  decimals?: number;
  image: string;
  balance: string;
  name: string;
  symbol: string;
  triggerReRender?: () => void;
};

const TokenListItem = observer(
  ({
    isZrc20Token = false,
    contractAddress,
    decimals,
    image,
    balance,
    name,
    symbol,
    triggerReRender,
  }: TokenListItemProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { qrlStore } = useStore();
    const { activeAccount } = qrlStore;
    const { accountAddress } = activeAccount;

    const [hideDialogOpen, setHideDialogOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const copiedResetRef = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(copiedResetRef.current), []);

    const onSend = () => {
      navigate(ROUTES.TOKEN_TRANSFER, {
        state: {
          tokenDetails: {
            isZrc20Token,
            tokenContractAddress: contractAddress,
            tokenDecimals: decimals,
            tokenImage: image,
            tokenBalance: balance,
            tokenName: name,
            tokenSymbol: symbol,
          },
        },
      });
    };

    const onCopyContractAddress = async () => {
      if (!contractAddress) return;
      try {
        await navigator.clipboard.writeText(contractAddress);
        setCopied(true);
        clearTimeout(copiedResetRef.current);
        copiedResetRef.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        setCopied(false);
      }
    };

    const onHide = async () => {
      setHideDialogOpen(false);
      await StorageUtil.clearFromTokenContractsList(
        accountAddress,
        contractAddress ?? "",
      );
      triggerReRender?.();
    };

    return (
      <>
        <Card
          role="button"
          tabIndex={0}
          className="flex h-16 w-full animate-appear-in cursor-pointer items-center justify-between gap-4 p-4 text-foreground hover:ring-1 hover:ring-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-secondary"
          onClick={onSend}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSend();
            }
          }}
        >
          <div className="flex min-w-0 items-center gap-4">
            <TokenListItemIcon icon={image ?? ""} symbol={symbol} />
            <div className="flex w-full min-w-0 flex-col gap-1">
              <div className="truncate text-xs font-bold">{balance}</div>
              <div className="truncate text-xs">{name}</div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                className="size-7 hover:bg-accent hover:text-secondary"
                variant="outline"
                size="icon"
                aria-label={t("common.more")}
              >
                <EllipsisVertical size="16" />
              </Button>
            </DropdownMenuTrigger>
            {/* The menu renders in a DOM portal, but React synthetic
                events still bubble through the component tree to the
                Card's navigate-onClick; without this every menu action
                would also open the send page. */}
            <DropdownMenuContent
              align="start"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={onSend}
                >
                  <div className="flex gap-2">
                    <Send size="16" />
                    <button aria-label={t("tokens.sendToken", { symbol })}>
                      {t("tokens.sendToken", { symbol })}
                    </button>
                  </div>
                </DropdownMenuItem>
                {isZrc20Token && contractAddress && (
                  <DropdownMenuItem
                    className="cursor-pointer data-[highlighted]:text-secondary"
                    onSelect={(e) => {
                      // Keep the menu open so the "Copied" feedback is seen.
                      e.preventDefault();
                      void onCopyContractAddress();
                    }}
                  >
                    <div className="flex gap-2">
                      {copied ? <Check size="16" /> : <Copy size="16" />}
                      <button aria-label={t("tokens.copyContractAddress")}>
                        {copied
                          ? t("tokens.contractAddressCopied")
                          : t("tokens.copyContractAddress")}
                      </button>
                    </div>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={!isZrc20Token}
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => setHideDialogOpen(true)}
                >
                  <div className="flex gap-2">
                    <CircleMinus size="16" />
                    <button
                      disabled={!isZrc20Token}
                      aria-label={t("tokens.hideToken")}
                    >
                      {t("tokens.hideToken")}
                    </button>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>
        {/* Outside the Card: the dialog portals its DOM out, but its React
            events would still bubble into the Card's onClick and send the
            user to the transfer page on "Yes". */}
        <Dialog open={hideDialogOpen} onOpenChange={setHideDialogOpen}>
          <DialogContent className="w-80 rounded-md">
            <DialogHeader className="text-left">
              <DialogTitle>{t("tokens.hide")}</DialogTitle>
              <DialogDescription>
                {t("tokens.hideConfirm", { symbol })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-row gap-4">
              <DialogClose asChild>
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  aria-label={t("tokens.cancelHide")}
                >
                  <X className="mr-2 h-4 w-4" />
                  {t("common.no")}
                </Button>
              </DialogClose>
              <Button
                className="w-full"
                type="button"
                aria-label={t("tokens.confirmHide")}
                onClick={onHide}
              >
                <Check className="mr-2 h-4 w-4" />
                {t("common.yes")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);

export default TokenListItem;
