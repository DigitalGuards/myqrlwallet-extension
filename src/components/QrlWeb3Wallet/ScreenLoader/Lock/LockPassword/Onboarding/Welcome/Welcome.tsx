import BrandMark from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BrandMark/BrandMark";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { MoveRight } from "lucide-react";
import { ONBOARDING_STEPS, OnboardingStepType } from "../Onboarding";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

type WelcomeProps = {
  selectStep: (step: OnboardingStepType) => void;
};

const Welcome = observer(({ selectStep }: WelcomeProps) => {
  const { t } = useTranslation();

  return (
    <Card className="surface-ember animate-appear-in">
      <CardHeader>
        <CardTitle>{t("welcome.title")}</CardTitle>
        <CardDescription className="break-words">
          {t("welcome.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          This release uses a separate v3 Private wallet. Existing v2 wallet
          records remain stored. Create a new v3 account or explicitly import
          your backup for v3.
        </p>
        <div className="flex h-32 w-full items-center gap-5 overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/40 to-secondary/10 px-6">
          <BrandMark
            className="h-16 w-16 shrink-0 text-primary"
            title="MyQRLWallet"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("welcome.tagline1")}
            </span>
            <span className="text-lg font-bold text-secondary">
              {t("welcome.tagline2")}
            </span>
            <span className="text-lg font-bold text-secondary">
              {t("welcome.tagline3")}
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={() => selectStep(ONBOARDING_STEPS.SET_PASSWORD)}
        >
          <MoveRight className="mr-2 h-4 w-4" />
          {t("welcome.button")}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default Welcome;
