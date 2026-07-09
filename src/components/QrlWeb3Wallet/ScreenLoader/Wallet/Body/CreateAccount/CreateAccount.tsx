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

const MnemonicDisplay = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay"
      ),
  ),
);

const CreateAccount = observer(() => {
  const { t } = useTranslation();
  const { lockStore, qrlStore } = useStore();
  const { encryptAccount, getWalletPassword } = lockStore;
  const { setActiveAccount } = qrlStore;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountCreated, setHasAccountCreated] = useState(false);
  const [hasMnemonicNoted, setHasMnemonicNoted] = useState(false);
  const [finalizeError, setFinalizeError] = useState("");

  const onAccountCreated = async (account?: Web3BaseWalletAccount) => {
    scrollShellToTop();
    if (account) {
      setAccount(account);
      await setActiveAccount(account?.address);
      try {
        // Fail closed if the password is unavailable (SW restarted, no cached
        // password): never persist the keystore under an empty password.
        const password = await getWalletPassword();
        await encryptAccount(account, password);
      } catch {
        setFinalizeError(t("account.passwordUnavailable"));
        return;
      }
      setFinalizeError("");
      setHasAccountCreated(true);
    }
  };

  const onMnemonicNoted = () => {
    scrollShellToTop();
    setHasMnemonicNoted(true);
  };

  return (
    <>
      <CircuitBackground />
      <div className="relative z-10 w-full p-8">
        {hasAccountCreated ? (
          hasMnemonicNoted ? (
            <AccountCreationSuccess account={account} />
          ) : (
            <MnemonicDisplay
              account={account}
              onMnemonicNoted={onMnemonicNoted}
            />
          )
        ) : (
          <>
            {finalizeError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{finalizeError}</AlertDescription>
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
