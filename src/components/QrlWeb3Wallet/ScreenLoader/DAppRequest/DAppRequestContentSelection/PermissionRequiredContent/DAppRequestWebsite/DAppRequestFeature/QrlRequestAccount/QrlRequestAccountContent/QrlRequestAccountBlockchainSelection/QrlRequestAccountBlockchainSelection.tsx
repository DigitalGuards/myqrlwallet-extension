import { Checkbox } from "@/components/UI/Checkbox";
import ChainIcon from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/ChainIcon/ChainIcon";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

type QrlRequestAccountBlockchainSelectionProps = {
  isLoading: boolean;
  allBlockchains: BlockchainDataType[];
  selectedBlockchains: BlockchainDataType[];
  onBlockchainSelection: (
    selectedAccount: BlockchainDataType,
    checked: boolean,
  ) => void;
};

const QrlRequestAccountBlockchainSelection = observer(
  ({
    isLoading,
    allBlockchains,
    selectedBlockchains,
    onBlockchainSelection,
  }: QrlRequestAccountBlockchainSelectionProps) => {
    const { t } = useTranslation();
    const hasBlockchains = !!allBlockchains?.length;
    const selectedBlockchainIds = selectedBlockchains.map(
      (blockchain) => blockchain?.chainId,
    );

    return (
      <div className="flex flex-col gap-4">
        <div>{t('dapp.selectBlockchains')}</div>
        {isLoading ? (
          <div className="flex h-12 w-full animate-pulse items-center justify-between">
            <div className="h-full w-full rounded-md bg-accent" />
          </div>
        ) : hasBlockchains ? (
          <div className="flex flex-col gap-3">
            {allBlockchains.map((blockchain) => (
              <div key={blockchain.chainId} className="flex items-start space-x-3">
                <Checkbox
                  id={blockchain.chainId}
                  name={`dappBlockchain-${blockchain.chainId}`}
                  checked={selectedBlockchainIds.includes(blockchain.chainId)}
                  aria-label="blockchainCheckbox"
                  onCheckedChange={(checked) =>
                    onBlockchainSelection(blockchain, !!checked)
                  }
                />
                <label
                  htmlFor={blockchain.chainId}
                  className="cursor-pointer text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  <div className="flex gap-3">
                    <ChainIcon
                      src={blockchain.defaultIconUrl}
                      alt={blockchain.chainName}
                    />
                    <div className="flex flex-col gap-1 break-all">
                      <span className="font-bold">{blockchain.chainName}</span>
                      <span className="text-xm opacity-80">
                        {t('dapp.chainId', { id: parseInt(blockchain.chainId, 16) })}
                      </span>
                      <span className="text-xm opacity-80">
                        {blockchain.defaultRpcUrl}
                      </span>
                    </div>
                  </div>
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div>{t('dapp.noBlockchainsAvailable')}</div>
        )}
      </div>
    );
  },
);

export default QrlRequestAccountBlockchainSelection;
