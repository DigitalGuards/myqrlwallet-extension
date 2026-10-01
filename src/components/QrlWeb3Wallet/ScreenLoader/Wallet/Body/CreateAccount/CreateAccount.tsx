import { Alert, AlertDescription } from "@/components/UI/Alert";
import { Button } from "@/components/UI/Button";
import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { describeExtensionError } from "@/functions/describeExtensionError";
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
  const { encryptAccount, ensureWalletPassword } = lockStore;
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
  // Set on any other persist failure (R1): a plain Retry button, no
  // password field, since the password was already confirmed usable.
  const [needsRetryOnPersist, setNeedsRetryOnPersist] = useState(false);

  const onAccountCreated = async (created?: Web3BaseWalletAccount) => {
    scrollShellToTop();
    if (!created) return;
    pendingCreatedAccountRef.current = created;
    // Fail closed before showing anything: with no session password left
    // in the service worker (it restarted) the account could never be
    // stored, so do not walk the user through a backup that ends in an
    // error. F1: the inline SessionPasswordPrompt re-arms the session and
    // this function runs again with the same generated account, which
    // keeps it in play for the backup step that follows.
    try {
      await ensureWalletPassword();
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
    try {
      await ensureWalletPassword();
    } catch {
      setNeedsReArmOnPersist(true);
      setNeedsRetryOnPersist(false);
      setPersistError(t("account.sessionPasswordExpired"));
      return;
    }
    try {
      // No password on the wire: the service worker encrypts with the one
      // its unlock session already holds.
      await encryptAccount(account);
    } catch (error) {
      // ensureWalletPassword() already confirmed a usable password moments
      // ago (N11): a failure here has some other cause, so this shows the
      // real error behind a plain Retry button (R1). A re-arm prompt here
      // would only re-confirm the same already-usable password.
      setNeedsReArmOnPersist(false);
      setNeedsRetryOnPersist(true);
      setPersistError(
        describeExtensionError(error, t, t("onboarding.account.persistError")),
      );
      return;
    }
    // Name it before the pointer moves, so the first render that shows this
    // account already has a name for the header chip. Naming after
    // activation left the chip nameless for two storage round trips. A
    // naming failure must not block the account itself: the header falls
    // back to the account's position and syncLabels backstops the stored
    // label later.
    await accountLabelsStore.ensureLabel(account.address).catch(() => {});
    try {
      await setActiveAccount(account.address);
    } catch (error) {
      setNeedsRetryOnPersist(true);
      setPersistError(
        describeExtensionError(error, t, t("onboarding.account.persistError")),
      );
      return;
    }
    scrollShellToTop();
    setNeedsReArmOnPersist(false);
    setNeedsRetryOnPersist(false);
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
                  setNeedsRetryOnPersist(false);
                }}
                error={persistError}
              />
              {needsReArmOnPersist && (
                <SessionPasswordPrompt onUnlocked={onBackupConfirmed} />
              )}
              {needsRetryOnPersist && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={onBackupConfirmed}
                >
                  {t("account.retryButton")}
                </Button>
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
