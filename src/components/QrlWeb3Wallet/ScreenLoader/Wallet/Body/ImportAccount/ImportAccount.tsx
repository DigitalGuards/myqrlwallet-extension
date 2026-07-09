import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const AccountImportSuccess = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess"
      ),
  ),
);
const ImportMnemonicForm = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportMnemonicForm/ImportMnemonicForm"
      ),
  ),
);
const ImportHexSeedForm = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm"
      ),
  ),
);
const ImportEncryptedWallet = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet"
      ),
  ),
);

const ImportAccount = observer(() => {
  const { t } = useTranslation();
  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);
  const { lockStore, qrlStore } = useStore();
  const { encryptAccount, getWalletPassword } = lockStore;
  const { setActiveAccount } = qrlStore;

  // Shared finalize step for every import path (mnemonic, hex seed, wallet
  // file). Each path only has to produce the account; secret persistence stays
  // on the single existing encrypted-storage route (encryptAccount stores the
  // hex seed via the lock manager keystore).
  const finalizeImport = async (importedAccount: Web3BaseWalletAccount) => {
    window.scrollTo(0, 0);
    setAccount(importedAccount);
    await setActiveAccount(importedAccount.address);
    const password = await getWalletPassword();
    await encryptAccount(importedAccount, password);
    setHasAccountImported(true);
  };

  return (
    <>
      <CircuitBackground />
      <div className="relative z-10 p-8">
        {hasAccountImported ? (
          <AccountImportSuccess account={account} />
        ) : (
          <>
            <BackButton />
            <Tabs defaultValue="mnemonic" className="w-full">
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
              <TabsContent value="mnemonic">
                <ImportMnemonicForm onImported={finalizeImport} />
              </TabsContent>
              <TabsContent value="hexSeed">
                <ImportHexSeedForm onImported={finalizeImport} />
              </TabsContent>
              <TabsContent value="walletFile">
                <ImportEncryptedWallet onImported={finalizeImport} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  );
});

export default ImportAccount;
