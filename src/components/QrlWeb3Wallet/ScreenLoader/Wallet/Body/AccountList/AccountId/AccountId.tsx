import { splitFormattedBalance } from "@/functions/formatBalance";
import { formatFiatCompact } from "@/functions/formatFiat";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { useStore } from "@/stores/store";
import AddressFingerprint from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressFingerprint";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { Usb } from "lucide-react";
import { observer } from "mobx-react-lite";
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
    const { getAccountBalance } = qrlStore;
    const isLedgerAccount = ledgerStore.isLedgerAccount(account);
    const label = accountLabelsStore.getLabel(account);

    // Read in render. The old effect mirrored the balance into state and
    // left `account` out of its dependencies, so switching accounts in a
    // reused element kept showing the previous account's balance until the
    // next balance refresh happened to land.
    const accountBalance = getAccountBalance(account);

    const { amount: balanceAmount, unit: balanceUnit } =
      splitFormattedBalance(accountBalance);
    const displayBalance = balanceUnit
      ? `${balanceAmount} ${balanceUnit}`
      : balanceAmount;
    const numericBalance = parseBalanceValue(accountBalance).toNumber();
    const { price, currency: quoteCurrency } = priceStore.quoteFor(
      settingsStore.currency,
    );
    const fiatDisplay =
      settingsStore.showBalanceAndPrice && price > 0
        ? formatFiatCompact(numericBalance, price, quoteCurrency)
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
          <div className="font-numeric text-xs text-foreground/90">
            {displayBalance}
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
