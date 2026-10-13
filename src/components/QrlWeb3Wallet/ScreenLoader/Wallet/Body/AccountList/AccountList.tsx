import ActiveAccount from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/ActiveAccount/ActiveAccount";
import NewAccount from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/NewAccount/NewAccount";
import OtherAccounts from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/OtherAccounts/OtherAccounts";
import { Card } from "@/components/UI/Card";
import { Label } from "@/components/UI/Label";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { ChevronDown, Eye } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import AccountId from "./AccountId/AccountId";

const AccountList = observer(() => {
  const { t } = useTranslation();
  const { qrlStore, ledgerStore, accountLabelsStore, hiddenAccountsStore } =
    useStore();
  const { qrlAccounts } = qrlStore;
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    accountLabelsStore
      .syncLabels(
        qrlAccounts.accounts,
        ledgerStore.isLedgerAccount.bind(ledgerStore),
      )
      .catch((error: unknown) => {
        console.error("Failed to sync account labels:", error);
      });
    hiddenAccountsStore.loadHiddenAccounts().catch((error: unknown) => {
      console.error("Failed to load hidden accounts:", error);
    });
  }, [qrlAccounts.accounts]);

  const hiddenAccounts = qrlAccounts.accounts.filter(({ accountAddress }) =>
    hiddenAccountsStore.isHidden(accountAddress),
  );

  return (
    <div className="flex w-full flex-col gap-2 p-8">
      <BackButton navigationRoute={ROUTES.HOME} />
      <div className="flex flex-col gap-8">
        <NewAccount />
        <ActiveAccount />
        <OtherAccounts />
        {hiddenAccounts.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              className="flex items-center gap-2 text-left"
              onClick={() => {
                setShowHidden(!showHidden);
              }}
            >
              <Label className="cursor-pointer text-lg text-muted-foreground">
                {t("home.hiddenAccounts", { count: hiddenAccounts.length })}
              </Label>
              <ChevronDown
                size="16"
                className={`text-muted-foreground transition-transform ${showHidden ? "rotate-180" : ""}`}
              />
            </button>
            {showHidden &&
              hiddenAccounts.map(({ accountAddress }) => (
                <Card
                  key={accountAddress}
                  className="flex w-full items-center gap-3 p-3 font-bold text-muted-foreground"
                >
                  <div className="min-w-0 flex-1">
                    <AccountId account={accountAddress} />
                  </div>
                  <button
                    className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      hiddenAccountsStore
                        .unhideAccount(accountAddress)
                        .catch((error: unknown) => {
                          console.error("Failed to unhide the account:", error);
                        });
                    }}
                    aria-label={t("home.unhide")}
                  >
                    <Eye size="16" />
                  </button>
                </Card>
              ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default AccountList;
