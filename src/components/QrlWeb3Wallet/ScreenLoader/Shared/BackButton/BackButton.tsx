import { MoveLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

type BackButtonProps = {
  navigationRoute?: string;
};

const BackButton = ({ navigationRoute }: BackButtonProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      data-testid="backButtonTestId"
      aria-label={t("common.back")}
      className="flex w-min items-center gap-2 rounded-md pb-4 transition-all hover:-ml-1 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() =>
        navigationRoute ? navigate(navigationRoute) : navigate(-1)
      }
    >
      <MoveLeft />
      <span className="text-lg font-medium leading-none text-foreground">
        {t("common.back")}
      </span>
    </button>
  );
};

export default BackButton;
