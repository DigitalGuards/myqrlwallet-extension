import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

const OnboardingCompleted = () => {
  const { t } = useTranslation();
  return (
    <Card className="animate-appear-in shadow-xl">
      <CardHeader>
        <CardTitle>{t("onboarding.completed.title")}</CardTitle>
        <CardDescription className="break-words">
          {t("onboarding.completed.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative flex h-32 w-full overflow-hidden">
          <img
            src="onboarding-completed.png"
            data-testid="onboarding-completed"
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={() => {
            window.close();
          }}
        >
          <Check className="mr-2 h-4 w-4" />
          {t("onboarding.completed.button")}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default OnboardingCompleted;
