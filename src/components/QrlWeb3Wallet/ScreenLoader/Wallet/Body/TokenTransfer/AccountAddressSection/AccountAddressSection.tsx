import AddressFingerprint from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressFingerprint";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

type AccountAddressSectionProps = {
  tokenBalance?: string;
};

const AccountAddressSection = observer(
  ({ tokenBalance }: AccountAddressSectionProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { activeAccount, getAccountBalance } = qrlStore;
    const { accountAddress } = activeAccount;

    const tokenAccountBalance = tokenBalance
      ? tokenBalance
      : getAccountBalance(accountAddress);

    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div>{t("transfer.accountAddress")}</div>
          <AddressFingerprint
            address={accountAddress}
            className="font-bold text-identity-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <div>{t("transfer.balance")}</div>
          <div className="font-bold text-secondary">{tokenAccountBalance}</div>
        </div>
      </div>
    );
  },
);

export default AccountAddressSection;
