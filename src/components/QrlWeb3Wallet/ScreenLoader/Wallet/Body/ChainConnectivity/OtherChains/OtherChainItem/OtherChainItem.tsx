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
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { Check, EllipsisVertical, Pencil, Trash, Wifi, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import ChainIcon from "../../ChainIcon/ChainIcon";
import StorageUtil from "@/utilities/storageUtil";
import {
  excludeChainForUrlOrigin,
  includeChainForUrlOrigin,
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

type OtherChainItemProps = {
  blockchain: BlockchainDataType;
  triggerReRender: () => void;
};

const OtherChainItem = observer(
  ({ blockchain, triggerReRender }: OtherChainItemProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { dAppRequestStore, qrlStore } = useStore();
    const { defaultRpcUrl, chainName, chainId, defaultIconUrl, isCustomChain } =
      blockchain;
    const { currentTabData } = dAppRequestStore;

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const connectChain = async (chainId: string) => {
      Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
        console.error("Failed to navigate home:", error);
      });
      await includeChainForUrlOrigin({
        urlOrigin: currentTabData?.urlOrigin ?? "",
        chainId,
      });
      await qrlStore.selectBlockchain(chainId);
    };

    const deleteChain = async (chainId: string) => {
      setDeleteDialogOpen(false);
      const blockchains = await StorageUtil.getAllBlockChains();
      const updatedChains = blockchains.filter(
        (chain) => chain.chainId !== chainId,
      );
      await StorageUtil.setAllBlockChains(updatedChains);
      await excludeChainForUrlOrigin({
        urlOrigin: currentTabData?.urlOrigin ?? "",
        chainId,
      });
      triggerReRender();
    };

    return (
      <Card className="flex justify-between gap-4 p-4">
        <div className="flex gap-4">
          <div className="pt-1">
            <ChainIcon src={defaultIconUrl} alt={chainName} />
          </div>
          <div className="flex flex-col break-all">
            <span className="font-bold">{chainName}</span>
            <span className="text-xm opacity-80">
              {t('dapp.chainId', { id: parseInt(chainId, 16) })}
            </span>
            <span className="text-xm opacity-80">{defaultRpcUrl}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                className="size-7 hover:bg-accent hover:text-secondary"
                variant="outline"
                size="icon"
                aria-label={t('chain.connectChain')}
                onClick={() => {
                  connectChain(chainId).catch((error: unknown) => {
                    console.error("Failed to connect chain:", error);
                  });
                }}
              >
                <Wifi size="16" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <Label>{t('chain.connectChain')}</Label>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="size-7 hover:bg-accent hover:text-secondary"
                variant="outline"
                size="icon"
                aria-label={t('common.more')}
              >
                <EllipsisVertical size="16" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <Link
                  to={ROUTES.ADD_EDIT_CHAIN}
                  state={{ hasState: true, chainId }}
                  aria-label={t('chain.editChain')}
                >
                  <DropdownMenuItem className="cursor-pointer data-[highlighted]:text-secondary">
                    <div className="flex gap-2">
                      <Pencil size="16" />
                      <button aria-label={t('chain.editChain')}>{t('chain.editChain')}</button>
                    </div>
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuItem
                  disabled={!isCustomChain}
                  className="cursor-pointer data-[highlighted]:text-secondary"
                  onClick={() => {
                    setDeleteDialogOpen(true);
                  }}
                >
                  <div className="flex gap-2">
                    <Trash size="16" />
                    <button disabled={!isCustomChain} aria-label={t('chain.deleteChain')}>
                      {t('chain.deleteChain')}
                    </button>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent className="w-80 rounded-md">
              <DialogHeader className="text-left">
                <DialogTitle>{t('chain.deleteChain')}</DialogTitle>
                <DialogDescription>
                  {t('chain.deleteChainConfirm', { name: chainName })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-row gap-4">
                <DialogClose asChild>
                  <Button
                    className="w-full"
                    type="button"
                    variant="outline"
                    aria-label={t('chain.cancelDelete')}
                  >
                    <X className="mr-2 h-4 w-4" />
                    {t('common.no')}
                  </Button>
                </DialogClose>
                <Button
                  className="w-full"
                  type="button"
                  aria-label={t('chain.confirmDelete')}
                  onClick={() => {
                    deleteChain(chainId).catch((error: unknown) => {
                      console.error("Failed to delete chain:", error);
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
      </Card>
    );
  },
);

export default OtherChainItem;
