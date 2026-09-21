import AddressDisclosure from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressDisclosure";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

const AccountAddressDisplay = observer(() => {
  const { qrlStore } = useStore();
  const { t } = useTranslation();
  const { activeAccount } = qrlStore;
  const { accountAddress } = activeAccount;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("onboarding.account.addressLabel")}
      </div>
      <AddressDisclosure
        address={accountAddress}
        fingerprintClassName="font-bold text-identity-accent"
        fullAddressClassName="font-bold text-identity-accent"
      />
    </div>
  );
});

export default AccountAddressDisplay;
