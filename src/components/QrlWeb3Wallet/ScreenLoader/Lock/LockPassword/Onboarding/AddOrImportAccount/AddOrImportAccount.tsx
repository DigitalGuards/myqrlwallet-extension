import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import SeedBackup from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/SeedBackup/SeedBackup";
import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import Web3, { Web3BaseWalletAccount } from "@theqrl/web3";
import { Download, MoveRight, Plus, Undo } from "lucide-react";
import { observer } from "mobx-react-lite";
import { lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { ONBOARDING_STEPS, OnboardingStepType } from "../Onboarding";
import AccountAddressDisplay from "./AccountAddressDisplay/AccountAddressDisplay";

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

type AddOrImportAccountProps = {
  selectStep: (step: OnboardingStepType) => void;
  addAnAccountToWallet: (account: Web3BaseWalletAccount) => Promise<void>;
};

type Mode = "choose" | "create" | "import";

/**
 * First-account step of onboarding. A new account goes through the seed
 * backup (reveal, then confirm) before it is persisted; an import lands
 * straight on the address confirmation.
 */
const AddOrImportAccount = observer(
  ({ selectStep, addAnAccountToWallet }: AddOrImportAccountProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { activeAccount } = qrlStore;
    const { accountAddress } = activeAccount;
    const hasAccount = !!accountAddress;

    const [mode, setMode] = useState<Mode>("choose");
    const [createdAccount, setCreatedAccount] =
      useState<Web3BaseWalletAccount>();
    const [persistError, setPersistError] = useState("");

    const onCreate = () => {
      const { qrl } = new Web3();
      setCreatedAccount(qrl?.accounts?.create());
      setPersistError("");
      setMode("create");
    };

    const onBackupConfirmed = async () => {
      if (!createdAccount) return;
      try {
        await addAnAccountToWallet(createdAccount);
      } catch (error) {
        setPersistError(`${t("onboarding.account.persistError")} ${error}`);
        return;
      }
      selectStep(ONBOARDING_STEPS.COMPLETED);
    };

    const onImported = async (account: Web3BaseWalletAccount) => {
      await addAnAccountToWallet(account);
      setMode("choose");
    };

    // Before the "account ready" card: persisting sets the active account
    // first and finishes the keystore write afterwards, and the backup card
    // (busy, or showing the persist error) must stay up until that resolves.
    if (mode === "create" && createdAccount) {
      return (
        <SeedBackup
          account={createdAccount}
          onConfirmed={onBackupConfirmed}
          onBack={() => {
            setCreatedAccount(undefined);
            setMode("choose");
          }}
          error={persistError}
        />
      );
    }

    if (hasAccount) {
      return (
        <Card className="animate-appear-in">
          <CardHeader>
            <CardTitle>{t("onboarding.account.readyTitle")}</CardTitle>
            <CardDescription className="break-words">
              {t("onboarding.account.readyDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountAddressDisplay />
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => selectStep(ONBOARDING_STEPS.COMPLETED)}
            >
              <MoveRight className="mr-2 h-4 w-4" />
              {t("onboarding.account.continueButton")}
            </Button>
          </CardFooter>
        </Card>
      );
    }

    if (mode === "import") {
      return (
        <Card className="animate-appear-in">
          <CardHeader>
            <CardTitle>{t("importAccount.title")}</CardTitle>
            <CardDescription className="break-words">
              {t("importAccount.description")}
            </CardDescription>
          </CardHeader>
          {/* min-w-0 on the panel: a long wallet filename must truncate
              inside the card. Without it the panel widens past the popup. */}
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
                <ImportMnemonicForm onImported={onImported} />
              </TabsContent>
              <TabsContent value="hexSeed" className="mt-4">
                <ImportHexSeedForm onImported={onImported} />
              </TabsContent>
              <TabsContent value="walletFile" className="mt-4">
                <ImportEncryptedWallet onImported={onImported} />
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              type="button"
              variant="ghost"
              onClick={() => setMode("choose")}
            >
              <Undo className="mr-2 h-4 w-4" />
              {t("onboarding.account.back")}
            </Button>
          </CardFooter>
        </Card>
      );
    }

    return (
      <Card className="animate-appear-in">
        <CardHeader>
          <CardTitle>{t("onboarding.account.title")}</CardTitle>
          <CardDescription className="break-words">
            {t("onboarding.account.description")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-3">
          <Button className="w-full" onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("onboarding.account.createButton")}
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={() => setMode("import")}
          >
            <Download className="mr-2 h-4 w-4" />
            {t("onboarding.account.importButton")}
          </Button>
        </CardFooter>
      </Card>
    );
  },
);

export default AddOrImportAccount;
