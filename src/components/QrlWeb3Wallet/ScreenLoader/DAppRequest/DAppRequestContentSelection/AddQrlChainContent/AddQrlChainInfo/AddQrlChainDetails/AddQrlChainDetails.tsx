import {
  isAddQrlChainParameters,
  readApprovalParams,
} from "@/utilities/approvalGuards";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import AddQrlChainUrlList from "./AddQrlChainUrlList/AddQrlChainUrlList";
import CurrencyImagePreload from "./CurrencyImagePreload/CurrencyImagePreload";

const AddQrlChainDetails = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;

  const candidate = readApprovalParams(dAppRequestData?.params)?.[0];
  const blockchain = isAddQrlChainParameters(candidate) ? candidate : undefined;
  const currencyName = blockchain?.nativeCurrency?.name;
  const currencySymbol = blockchain?.nativeCurrency?.symbol;
  const currencyDecimal = blockchain?.nativeCurrency?.decimals;
  const chainName = blockchain?.chainName;
  const chainId = blockchain?.chainId;
  const rpcUrls = blockchain?.rpcUrls ?? [];
  const blockExplorerUrls = blockchain?.blockExplorerUrls ?? [];
  const iconUrls = blockchain?.iconUrls ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-1">
          <div>{t('chain.chainName')}</div>
          <div className="font-bold text-secondary">{chainName}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div>{t('chain.chainIdLabel')}</div>
          <div className="font-bold text-secondary">
            {chainId === undefined ? "" : parseInt(chainId, 16)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-1">
          <div>{t('chain.symbol')}</div>
          <div className="font-bold text-secondary">{currencySymbol}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div>{t('chain.decimals')}</div>
          <div className="font-bold text-secondary">{currencyDecimal}</div>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="flex flex-col gap-1 transition-all duration-1000">
          <div>{t('chain.currencyName')}</div>
          <div className="font-bold text-secondary">{currencyName}</div>
        </div>
        <CurrencyImagePreload iconUrls={iconUrls} />
      </div>
      <AddQrlChainUrlList title={t('chain.rpcUrls')} urlList={rpcUrls} />
      <AddQrlChainUrlList
        title={t('chain.blockExplorerUrls')}
        urlList={blockExplorerUrls}
      />
      <AddQrlChainUrlList title={t('chain.iconUrls')} urlList={iconUrls} />
    </div>
  );
});

export default AddQrlChainDetails;
