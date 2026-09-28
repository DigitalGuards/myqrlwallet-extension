import { Alert, AlertDescription } from "@/components/UI/Alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
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
  const pendingAccountRef = useRef<Web3BaseWalletAccount>();
  const { lockStore, qrlStore, accountLabelsStore } = useStore();
  const { encryptAccount, getWalletPassword } = lockStore;
  const { setActiveAccount } = qrlStore;

  // Shared finalize step for every import path (mnemonic, hex seed, wallet
  // file). Each path only has to produce the account; secret persistence stays
  // on the single existing encrypted-storage route (encryptAccount stores the
  // hex seed via the lock manager keystore).
  const finalizeImport = async (importedAccount: Web3BaseWalletAccount) => {
    scrollShellToTop();
    pendingAccountRef.current = importedAccount;
    // Fail closed before any write. The unlock session can be usable for
    // reads and still have no password: after a service-worker restart the
    // decrypted keys self-heal from session storage (so the wallet reads as
    // unlocked and no lock screen is shown) while the memory-only password
    // is gone. Writing the account pointer first left that address in the
    // accounts list with no keystore, so the import both reported failure
    // and appeared to have happened. F1: the inline SessionPasswordPrompt
    // below re-arms the session and this same function runs again with the
    // same account, so the import completes in place.
    let password: string;
    try {
      password = await getWalletPassword();
    } catch {
      setNeedsReArm(true);
      setFinalizeError(t("account.passwordUnavailable"));
      return;
    }
    setAccount(importedAccount);
    try {
      await encryptAccount(importedAccount, password);
    } catch {
      setNeedsReArm(true);
      setFinalizeError(t("account.passwordUnavailable"));
      return;
    }
    // Pointer after the keystore: an account the wallet points at always has
    // a key behind it. Safe here because the wallet already has at least one
    // account, so the service worker never sees the keystores-without-
    // accounts state that onboarding has to order around.
    try {
      await setActiveAccount(importedAccount.address);
    } catch {
      setNeedsReArm(false);
      setFinalizeError(t("onboarding.account.persistError"));
      return;
    }
    // Name it now so the header reads "Account N" immediately rather than
    // the raw address until some other screen happens to run syncLabels.
    // Never strand a persisted import on a naming failure: syncLabels
    // backstops the label later.
    await accountLabelsStore
      .ensureLabel(importedAccount.address)
      .catch(() => {});
    pendingAccountRef.current = undefined;
    setNeedsReArm(false);
    setFinalizeError("");
    setHasAccountImported(true);
  };

  // The typed password re-armed the service worker exactly like a fresh
  // unlock (see SessionPasswordPrompt). Retry the same finalize step in
  // place: the imported mnemonic/seed/file already produced `importedAccount`
  // before the password check failed, so nothing the user entered is lost.
  const retryAfterReArm = async () => {
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
            {finalizeError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {finalizeError}
                  {needsReArm && (
                    <SessionPasswordPrompt onUnlocked={retryAfterReArm} />
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
