import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { ROUTES } from "@/router/router";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { useCopy } from "@/hooks/useCopy";
import { Check, Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

type AccountCreationSuccessProps = {
  account?: Web3BaseWalletAccount;
};

const AccountCreationSuccess = ({ account }: AccountCreationSuccessProps) => {
  const { t } = useTranslation();
  const accountAddress = account?.address ?? "";

  const { copied, failed, copy } = useCopy({ resetAfterMs: 1000 });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("account.created")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="flex min-w-0 flex-col gap-2">
          <div>{t("account.publicAddress")}</div>
          <FullAddress
            address={accountAddress}
            className="w-full font-bold text-identity-accent"
          />
          <div>{t("account.shareInfo")}</div>
        </div>
      </CardContent>
      <CardFooter className="gap-4">
        <Button
          className={`w-full ${failed ? "text-destructive" : ""}`}
          type="button"
          variant="outline"
          onClick={() => void copy(accountAddress)}
        >
          {failed ? (
            <X className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {failed
            ? t("common.copyFailed")
            : copied
              ? t("account.copied")
              : t("account.copy")}
        </Button>
        <Link
          className="w-full"
          to={ROUTES.HOME}
          state={{ shouldStartFresh: true }}
        >
          <Button className="w-full" type="button">
            <Check className="mr-2 h-4 w-4" />
            {t("account.done")}
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
};

export default AccountCreationSuccess;
