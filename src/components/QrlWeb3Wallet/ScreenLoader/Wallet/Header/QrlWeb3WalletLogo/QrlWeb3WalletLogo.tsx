import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { ROUTES } from "@/router/router";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const QrlWeb3WalletLogo = () => {
  const { t } = useTranslation();
  return (
    <Link to={ROUTES.HOME}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <img
            className="h-6 w-6"
            src="icons/qrl/default.png"
            alt="MyQRLWallet Logo"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Label>{t('nav.home')}</Label>
        </TooltipContent>
      </Tooltip>
    </Link>
  );
};

export default QrlWeb3WalletLogo;
