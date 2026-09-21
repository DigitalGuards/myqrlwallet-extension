import { formatFiatCompact } from "@/functions/formatFiat";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { useStore } from "@/stores/store";
import AddressFingerprint from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressFingerprint";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { Usb } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type AccountIdType = {
  account: string;
  display?: "fingerprint" | "full";
  hideLabel?: boolean;
};

const AccountId = observer(
  ({ account, display = "fingerprint", hideLabel }: AccountIdType) => {
    const { t } = useTranslation();
    const {
      qrlStore,
      ledgerStore,
      accountLabelsStore,
      priceStore,
      settingsStore,
    } = useStore();
    const { getAccountBalance, qrlAccounts } = qrlStore;
    const { accounts } = qrlAccounts;
    const [accountBalance, setAccountBalance] = useState("");
    const isLedgerAccount = ledgerStore.isLedgerAccount(account);
    const label = accountLabelsStore.getLabel(account);

    useEffect(() => {
      setAccountBalance(getAccountBalance(account));
    }, [accounts]);

    const numericBalance = parseBalanceValue(accountBalance).toNumber();
    const price = priceStore.getPrice(settingsStore.currency);
    const fiatDisplay =
      settingsStore.showBalanceAndPrice && price > 0
        ? formatFiatCompact(numericBalance, price, settingsStore.currency)
        : "";

    return (
      <div className="flex min-w-0 flex-col gap-1">
        {!hideLabel && label && (
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium">{label}</span>
            {isLedgerAccount && (
              <span title={t("account.ledger")}>
                <Usb className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {display === "full" ? (
              <FullAddress
                address={account}
                className="text-xs text-identity-accent"
              />
            ) : (
              <AddressFingerprint
                address={account}
                className="text-xs text-identity-accent"
              />
            )}
            {(hideLabel || !label) && isLedgerAccount && (
              <span title={t("account.ledger")}>
                <Usb className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
          </div>
          <div className="font-data text-xs text-foreground/90">
            {accountBalance}
            {fiatDisplay && (
              <span className="ml-1 text-muted-foreground">{fiatDisplay}</span>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default AccountId;
