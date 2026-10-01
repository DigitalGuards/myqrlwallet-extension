import { Alert, AlertDescription } from "@/components/UI/Alert";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import { describeExtensionError } from "@/functions/describeExtensionError";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { lazy, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import SessionPasswordPrompt from "../../../Shared/SessionPasswordPrompt/SessionPasswordPrompt";

const AccountImportSuccess = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess"),
  ),
);
const ImportMnemonicForm = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportMnemonicForm/ImportMnemonicForm"),
  ),
);
const ImportHexSeedForm = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm"),
  ),
);
const ImportEncryptedWallet = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet"),
  ),
);

const ImportAccount = observer(() => {
  const { t } = useTranslation();
  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);
  const [finalizeError, setFinalizeError] = useState("");
  // Set only while the session password is unavailable, so the inline
  // SessionPasswordPrompt shows; holds the account that still needs
  // finalizing so the retry can pick up exactly where it left off, without
  // the user re-entering their mnemonic/seed/file.
  const [needsReArm, setNeedsReArm] = useState(false);
  // Set on any other finalize failure (R1): a plain Retry button, no
  // password field, since the password was already confirmed usable.
  const [needsRetry, setNeedsRetry] = useState(false);
  const pendingAccountRef = useRef<Web3BaseWalletAccount>();
  // Set when the imported account is already in the wallet. Distinct from
  // finalizeError: nothing failed, so neither a re-arm prompt nor a retry
  // button belongs on it.
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const { lockStore, qrlStore, accountLabelsStore } = useStore();
  const { encryptAccount, ensureWalletPassword } = lockStore;
  const { setActiveAccount, qrlAccounts } = qrlStore;

  // Shared finalize step for every import path (mnemonic, hex seed, wallet
  // file). Each path only has to produce the account; secret persistence stays
  // on the single existing encrypted-storage route (encryptAccount stores the
  // hex seed via the lock manager keystore).
  const finalizeImport = async (importedAccount: Web3BaseWalletAccount) => {
    scrollShellToTop();
    // Re-importing an account the wallet already holds used to run the whole
    // finalize path and land on the success screen, so a duplicate read as a
    // fresh import. Addresses are compared lowercased because the import
    // paths and the stored list disagree on hex casing.
    const importedAddress = importedAccount.address.toLowerCase();
    const isDuplicate = qrlAccounts.accounts.some(
      ({ accountAddress }) => accountAddress.toLowerCase() === importedAddress,
    );
    if (isDuplicate) {
      pendingAccountRef.current = undefined;
      setNeedsReArm(false);
      setNeedsRetry(false);
      setFinalizeError("");
      setDuplicateNotice(t("importAccount.alreadyImported"));
      return;
    }
    setDuplicateNotice("");
    pendingAccountRef.current = importedAccount;
    // Fail closed before any write. ensureWalletPassword() throws whenever
    // the service worker is locked - including a stale popup-side isLocked
    // observable racing an actual SW restart (see SessionPasswordPrompt's
    // doc comment). Writing the account pointer first left that address in
    // the accounts list with no keystore, so the import both reported
    // failure and appeared to have happened. F1: the inline
    // SessionPasswordPrompt below re-arms the session and this same
    // function runs again with the same account, so the import completes
    // in place.
    try {
      await ensureWalletPassword();
    } catch {
      setNeedsReArm(true);
      setNeedsRetry(false);
      setFinalizeError(t("account.passwordUnavailable"));
      return;
    }
    setAccount(importedAccount);
    try {
      // No password on the wire: the service worker encrypts with the one
      // its unlock session already holds.
      await encryptAccount(importedAccount);
    } catch (error) {
      // ensureWalletPassword() already confirmed a usable password moments
      // ago (N11): a failure here has some other cause, so this shows the
      // real error behind a plain Retry button (R1). A re-arm prompt here
      // would only re-confirm the same already-usable password.
      setNeedsReArm(false);
      setNeedsRetry(true);
      setFinalizeError(
        describeExtensionError(error, t, t("onboarding.account.persistError")),
      );
      return;
    }
    // Name it before the pointer moves, so the first render that shows this
    // account already has a name for the header chip. Naming after
    // activation left the chip nameless for two storage round trips.
    // Never strand a persisted import on a naming failure: the header falls
    // back to the account's position and syncLabels backstops the stored
    // label later.
    await accountLabelsStore
      .ensureLabel(importedAccount.address)
      .catch(() => {});
    // Pointer after the keystore: an account the wallet points at always has
    // a key behind it. Safe here because the wallet already has at least one
    // account, so the service worker never sees the keystores-without-
    // accounts state that onboarding has to order around.
    try {
      await setActiveAccount(importedAccount.address);
    } catch (error) {
      setNeedsReArm(false);
      setNeedsRetry(true);
      setFinalizeError(
        describeExtensionError(error, t, t("onboarding.account.persistError")),
      );
      return;
    }
    pendingAccountRef.current = undefined;
    setNeedsReArm(false);
    setNeedsRetry(false);
    setFinalizeError("");
    setHasAccountImported(true);
  };

  // Retries the same finalize step in place, whether it is following a
  // successful SessionPasswordPrompt re-arm or a plain Retry click (R1):
  // the imported mnemonic/seed/file already produced `importedAccount`
  // before the failure, so nothing the user entered is lost.
  const retryPendingImport = async () => {
    const pendingAccount = pendingAccountRef.current;
    if (!pendingAccount) return;
    await finalizeImport(pendingAccount);
  };

  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        {hasAccountImported ? (
          <AccountImportSuccess account={account} />
        ) : (
          <>
            <BackButton />
            {duplicateNotice && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{duplicateNotice}</AlertDescription>
              </Alert>
            )}
            {finalizeError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {finalizeError}
                  {needsReArm && (
                    <SessionPasswordPrompt onUnlocked={retryPendingImport} />
                  )}
                  {needsRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={retryPendingImport}
                    >
                      {t("account.retryButton")}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader>
                <CardTitle>{t("importAccount.title")}</CardTitle>
                <CardDescription className="break-words">
                  {t("importAccount.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <Tabs defaultValue="mnemonic" className="w-full min-w-0">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="mnemonic">
                      {t("importAccount.tabMnemonic")}
                    </TabsTrigger>
                    <TabsTrigger value="hexSeed">
                      {t("importAccount.tabHexSeed")}
                    </TabsTrigger>
                    <TabsTrigger value="walletFile">
                      {t("importAccount.tabWalletFile")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="mnemonic" className="mt-4">
                    <ImportMnemonicForm onImported={finalizeImport} />
                  </TabsContent>
                  <TabsContent value="hexSeed" className="mt-4">
                    <ImportHexSeedForm onImported={finalizeImport} />
                  </TabsContent>
                  <TabsContent value="walletFile" className="mt-4">
                    <ImportEncryptedWallet onImported={finalizeImport} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
});

export default ImportAccount;
