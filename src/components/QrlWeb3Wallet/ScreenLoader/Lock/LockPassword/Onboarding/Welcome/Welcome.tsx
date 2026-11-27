import { Button } from "@/components/UI/Button";
import { pinnedMainnet } from "@/configuration/pinnedNetworks";
import { hasLegacyWalletData } from "@/utilities/legacyWalletData";
import { MoveRight } from "lucide-react";
import { ONBOARDING_STEPS, OnboardingStepType } from "../Onboarding";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type WelcomeProps = {
  selectStep: (step: OnboardingStepType) => void;
};

const ROWS = [
  { title: "welcome.keysTitle", body: "welcome.keysBody" },
  { title: "welcome.signTitle", body: "welcome.signBody" },
  { title: "welcome.connectTitle", body: "welcome.connectBody" },
] as const;

const Welcome = ({ selectStep }: WelcomeProps) => {
  const { t } = useTranslation();
  // The v3 storage notice only makes sense when there are pre-v3 records to
  // talk about, so it starts hidden and appears once storage confirms them.
  // A fresh install therefore never flashes it. Detection never rejects, so
  // the welcome screen renders either way.
  const [showLegacyNotice, setShowLegacyNotice] = useState(false);

  useEffect(() => {
    let active = true;
    void hasLegacyWalletData()
      .then((hasLegacyData) => {
        if (active) setShowLegacyNotice(hasLegacyData);
      })
      // Belt and braces: detection already swallows storage failures, and a
      // notice is never worth an unhandled rejection on the welcome screen.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="flex animate-appear-in flex-col gap-6">
      <h2 className="text-balance text-center text-2xl font-semibold leading-tight tracking-tight text-foreground">
        {t("welcome.headline")}
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {ROWS.map((row) => (
          <li key={row.title} className="py-4">
            <p className="text-base font-semibold text-foreground">
              {t(row.title)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t(row.body)}</p>
          </li>
        ))}
      </ul>
      {showLegacyNotice && (
        <p
          role="note"
          className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground"
        >
          {t("welcome.legacyNotice")}
        </p>
      )}
      <Button
        className="w-full"
        onClick={() => {
          selectStep(ONBOARDING_STEPS.SET_PASSWORD);
        }}
      >
        <MoveRight className="mr-2 h-4 w-4" />
        {t("welcome.button")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t(pinnedMainnet() ? "welcome.noteMainnet" : "welcome.note")}
      </p>
    </section>
  );
};

export default Welcome;
