import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import AddressDisclosure from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressDisclosure";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { QRCodeSVG } from "qrcode.react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const Receive = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { activeAccount } = qrlStore;
  const { state } = useLocation();
  const accountAddress = state?.accountAddress ?? activeAccount.accountAddress;

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("receive.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={accountAddress} size={150} />
            </div>
            <AddressDisclosure
              address={accountAddress}
              className="w-full"
              fingerprintClassName="text-center text-sm text-identity-accent"
              fullAddressClassName="text-center text-identity-accent"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default Receive;
