import { formatFiatCompact } from "@/functions/formatFiat";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { useStore } from "@/stores/store";
import StringUtil from "@/utilities/stringUtil";
import { Usb } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type AccountIdType = {
  account: string;
  hideLabel?: boolean;
};

const AccountId = observer(({ account, hideLabel }: AccountIdType) => {
  const { t } = useTranslation();
  const { qrlStore, ledgerStore, accountLabelsStore, priceStore, settingsStore } = useStore();
  const { getAccountBalance, qrlAccounts } = qrlStore;
  const { accounts } = qrlAccounts;
  const { prefix, addressSplit } = StringUtil.getSplitAddress(account);

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
    <div className="flex flex-col gap-1">
      {!hideLabel && label && (
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium">{label}</span>
          {isLedgerAccount && (
            <span title={t('account.ledger')}>
              <Usb className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <div className="font-data flex flex-wrap gap-1 text-blue-accent">
            <div className="text-xs">
              {prefix}
              {addressSplit[0]}
            </div>
            {addressSplit.slice(1).map((part) => (
              <div className="text-xs" key={part}>
                {part}
              </div>
            ))}
          </div>
          {(hideLabel || !label) && isLedgerAccount && (
            <span title={t('account.ledger')}>
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
});

export default AccountId;
