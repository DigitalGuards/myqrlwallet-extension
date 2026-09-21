import { Card } from "@/components/UI/Card";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { useStore } from "@/stores/store";
import { useTranslation } from "react-i18next";
import CurrencyImagePreload from "../../AddQrlChainContent/AddQrlChainInfo/AddQrlChainDetails/CurrencyImagePreload/CurrencyImagePreload";

const WatchAssetInfo = () => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;

  const paramsObject = dAppRequestData?.params[0];
  const asset = paramsObject?.options;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div>{t("dapp.watchAsset.tokenAddress")}</div>
          <FullAddress
            address={asset?.address ?? ""}
            className="w-full font-bold text-secondary"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1 transition-all duration-1000">
              <div>{t("dapp.watchAsset.symbol")}</div>
              <div className="font-bold text-secondary">{asset?.symbol}</div>
            </div>
            <CurrencyImagePreload iconUrls={[asset?.image ?? ""]} />
          </div>
          <div className="flex flex-col gap-1">
            <div>{t("dapp.watchAsset.decimals")}</div>
            <div className="font-bold text-secondary">{asset?.decimals}</div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default WatchAssetInfo;
