import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useTranslation } from "react-i18next";
import ZRC20Tokens from "../Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Tokens";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const AllZRC20Tokens = () => {
  const { t } = useTranslation();
  return (
    <>
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>{t('tokens.allZrc20')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ZRC20Tokens shouldDisplayAllTokens={true} />
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AllZRC20Tokens;
