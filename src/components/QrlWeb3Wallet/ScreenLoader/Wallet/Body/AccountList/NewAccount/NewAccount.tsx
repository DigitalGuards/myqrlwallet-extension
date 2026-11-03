import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ADD_ACCOUNTS_FIRST } from "../../Home/homeNavigation";

const NewAccount = () => {
  const { t } = useTranslation();
  return (
    <Link to={ROUTES.HOME} state={ADD_ACCOUNTS_FIRST}>
      <Button className="flex w-full gap-2">
        <Plus size="18" /> {t("home.createOrImport")}
      </Button>
    </Link>
  );
};

export default NewAccount;
