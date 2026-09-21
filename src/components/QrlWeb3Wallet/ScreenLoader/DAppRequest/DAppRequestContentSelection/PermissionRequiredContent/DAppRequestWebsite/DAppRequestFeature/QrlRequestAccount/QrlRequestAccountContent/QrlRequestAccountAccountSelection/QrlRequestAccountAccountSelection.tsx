import { Checkbox } from "@/components/UI/Checkbox";
import AccountId from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountId/AccountId";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

type QrlRequestAccountAccountSelectionProps = {
  selectedAccounts: string[];
  onAccountSelection: (selectedAccount: string, checked: boolean) => void;
};

const QrlRequestAccountAccountSelection = observer(
  ({
    selectedAccounts,
    onAccountSelection,
  }: QrlRequestAccountAccountSelectionProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { qrlAccounts } = qrlStore;
    const { accounts, isLoading } = qrlAccounts;
    const availableAccounts = accounts.map((account) => account.accountAddress);

    const hasAccounts = !!availableAccounts?.length;

    return (
      <div className="flex flex-col gap-4">
        <div>{t("dapp.selectAccounts")}</div>
        {isLoading ? (
          <div className="flex h-12 w-full animate-pulse items-center justify-between">
            <div className="h-full w-full rounded-md bg-accent" />
          </div>
        ) : hasAccounts ? (
          <div className="flex flex-col gap-3">
            {availableAccounts.map((account) => (
              <div key={account} className="flex min-w-0 items-start space-x-3">
                <Checkbox
                  id={account}
                  checked={selectedAccounts.includes(account)}
                  aria-label="accountsCheckbox"
                  onCheckedChange={(checked) =>
                    onAccountSelection(account, !!checked)
                  }
                />
                <label
                  htmlFor={account}
                  className="min-w-0 flex-1 cursor-pointer text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  <AccountId account={account} />
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div>{t("dapp.noAccountsAvailable")}</div>
        )}
      </div>
    );
  },
);

export default QrlRequestAccountAccountSelection;
