import { Alert, AlertDescription } from "@/components/UI/Alert";
import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { lazy, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import StartAccountCreation from "./StartAccountCreation/StartAccountCreation";
import AccountCreationSuccess from "./AccountCreationSuccess/AccountCreationSuccess";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import SessionPasswordPrompt from "../../../Shared/SessionPasswordPrompt/SessionPasswordPrompt";

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
  // F1: shows the inline SessionPasswordPrompt when the session password is
  // unavailable at the pre-reveal check. Holds the generated account so the
  // retry can show the same backup screen without regenerating it.
  const [needsReArmOnStart, setNeedsReArmOnStart] = useState(false);
  const pendingCreatedAccountRef = useRef<Web3BaseWalletAccount>();
  // Same idea, but for the confirm-backup step: `account` is already set by
  // then, so only a flag is needed (no separate ref).
  const [needsReArmOnPersist, setNeedsReArmOnPersist] = useState(false);

  const onAccountCreated = async (created?: Web3BaseWalletAccount) => {
    scrollShellToTop();
    if (!created) return;
    pendingCreatedAccountRef.current = created;
    // Fail closed before showing anything: with no cached password (SW
    // restarted) the account could never be stored, so do not walk the
    // user through a backup that ends in an error. F1: the inline
    // SessionPasswordPrompt re-arms the session and this function runs
    // again with the same generated account, which keeps it in play for
    // the backup step that follows.
    try {
      await getWalletPassword();
    } catch {
      setNeedsReArmOnStart(true);
      setStartError(t("account.sessionPasswordExpired"));
      return;
    }
    pendingCreatedAccountRef.current = undefined;
    setNeedsReArmOnStart(false);
    setStartError("");
    setAccount(created);
  };

  const retryOnAccountCreated = async () => {
    const pendingAccount = pendingCreatedAccountRef.current;
    if (!pendingAccount) return;
    await onAccountCreated(pendingAccount);
  };

  const onBackupConfirmed = async () => {
    if (!account) return;
    let password: string;
    try {
      password = await getWalletPassword();
    } catch {
      setNeedsReArmOnPersist(true);
      setPersistError(t("account.sessionPasswordExpired"));
      return;
    }
    try {
      await encryptAccount(account, password);
    } catch (error) {
      // getWalletPassword() already confirmed a usable password moments
      // ago (N11): a failure here has some other cause, so this shows the
      // real error. A re-arm prompt here would only re-confirm the same
      // already-usable password.
      setNeedsReArmOnPersist(false);
      setPersistError(
        error instanceof Error
          ? error.message
          : t("onboarding.account.persistError"),
      );
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
    setNeedsReArmOnPersist(false);
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
            <>
              <SeedBackup
                account={account}
                onConfirmed={onBackupConfirmed}
                onBack={() => {
                  setAccount(undefined);
                  setPersistError("");
                  setNeedsReArmOnPersist(false);
                }}
                error={persistError}
              />
              {needsReArmOnPersist && (
                <SessionPasswordPrompt onUnlocked={onBackupConfirmed} />
              )}
            </>
          )
        ) : (
          <>
            {startError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {startError}
                  {needsReArmOnStart && (
                    <SessionPasswordPrompt onUnlocked={retryOnAccountCreated} />
                  )}
                </AlertDescription>
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
