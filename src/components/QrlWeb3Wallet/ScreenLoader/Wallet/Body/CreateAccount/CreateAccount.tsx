import { Alert, AlertDescription } from "@/components/UI/Alert";
import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import StartAccountCreation from "./StartAccountCreation/StartAccountCreation";
import AccountCreationSuccess from "./AccountCreationSuccess/AccountCreationSuccess";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const SeedBackup = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Shared/SeedBackup/SeedBackup"),
  ),
);

/**
 * In-wallet account creation: generate, back up (reveal + confirm), then
 * persist. Nothing reaches the keystore until the backup is confirmed, so
 * leaving the screen early discards the account. No account whose seed
 * was never shown can reach the keystore.
 */
const CreateAccount = observer(() => {
  const { t } = useTranslation();
  const { lockStore, qrlStore, accountLabelsStore } = useStore();
  const { encryptAccount, getWalletPassword } = lockStore;
  const { setActiveAccount } = qrlStore;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [isPersisted, setIsPersisted] = useState(false);
  const [startError, setStartError] = useState("");
  const [persistError, setPersistError] = useState("");

  const onAccountCreated = async (created?: Web3BaseWalletAccount) => {
    scrollShellToTop();
    if (!created) return;
    // Fail closed before showing anything: with no cached password (SW
    // restarted) the account could never be stored, so do not walk the
    // user through a backup that ends in an error.
    try {
      await getWalletPassword();
    } catch {
      setStartError(t("account.passwordUnavailable"));
      return;
    }
    setStartError("");
    setAccount(created);
  };

  const onBackupConfirmed = async () => {
    if (!account) return;
    try {
      const password = await getWalletPassword();
      await encryptAccount(account, password);
    } catch {
      setPersistError(t("account.passwordUnavailable"));
      return;
    }
    try {
      await setActiveAccount(account.address);
      // Name it now so the header reads "Account N" immediately. Otherwise it
      // shows the raw address until some other screen happens to run
      // syncLabels.
      await accountLabelsStore.ensureLabel(account.address);
    } catch {
      setPersistError(t("onboarding.account.persistError"));
      return;
    }
    scrollShellToTop();
    setPersistError("");
    setIsPersisted(true);
  };

  return (
    <>
      <CircuitBackground />
      <div className="relative z-10 w-full p-8">
        {account ? (
          isPersisted ? (
            <AccountCreationSuccess account={account} />
          ) : (
            <SeedBackup
              account={account}
              onConfirmed={onBackupConfirmed}
              onBack={() => setAccount(undefined)}
              error={persistError}
            />
          )
        ) : (
          <>
            {startError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            )}
            <StartAccountCreation onAccountCreated={onAccountCreated} />
          </>
        )}
      </div>
    </>
  );
});

export default CreateAccount;
