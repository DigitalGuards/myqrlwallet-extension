import { useStore } from "@/stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import AddOrImportAccount from "./AddOrImportAccount/AddOrImportAccount";
import LockPasswordSetup from "./LockPasswordSetup/LockPasswordSetup";
import OnboardingCompleted from "./OnboardingCompleted/OnboardingCompleted";
import Welcome from "./Welcome/Welcome";

export const ONBOARDING_STEPS = Object.freeze({
  WELCOME: "WELCOME",
  SET_PASSWORD: "SET_PASSWORD",
  ADD_OR_IMPORT_ACCOUNT: "ADD_OR_IMPORT_ACCOUNT",
  COMPLETED: "COMPLETED",
});

export type OnboardingStepType =
  (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

const Onboarding = observer(() => {
  const { lockStore, qrlStore, accountLabelsStore } = useStore();
  const { encryptAccount } = lockStore;
  const { setActiveAccount } = qrlStore;

  const [step, setStep] = useState<OnboardingStepType>(
    ONBOARDING_STEPS.WELCOME,
  );
  const [password, setPassword] = useState("");

  const selectStep = (step: OnboardingStepType) => {
    setStep(step);
  };

  const setNewPassword = (password: string) => {
    setPassword(password);
  };

  const addAnAccountToWallet = async (account: Web3BaseWalletAccount) => {
    setActiveAccount(account.address);
    await encryptAccount(account, password);
    // Name it now so the header reads "Account N" immediately rather than
    // the raw address until some other screen happens to run syncLabels.
    await accountLabelsStore.ensureLabel(account.address);
  };

  if (step === ONBOARDING_STEPS.WELCOME)
    return <Welcome selectStep={selectStep} />;

  if (step === ONBOARDING_STEPS.SET_PASSWORD)
    return (
      <LockPasswordSetup
        selectStep={selectStep}
        setNewPassword={setNewPassword}
      />
    );

  if (step === ONBOARDING_STEPS.ADD_OR_IMPORT_ACCOUNT)
    return (
      <AddOrImportAccount
        selectStep={selectStep}
        addAnAccountToWallet={addAnAccountToWallet}
      />
    );

  if (step === ONBOARDING_STEPS.COMPLETED) return <OnboardingCompleted />;
});

export default Onboarding;
