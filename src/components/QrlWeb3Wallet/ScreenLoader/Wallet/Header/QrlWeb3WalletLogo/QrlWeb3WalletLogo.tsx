import BrandMark from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BrandMark/BrandMark";
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
          <BrandMark
            className="h-6 w-6 text-primary"
            title="MyQRLWallet Logo"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Label>{t("nav.home")}</Label>
        </TooltipContent>
      </Tooltip>
    </Link>
  );
};

export default QrlWeb3WalletLogo;
