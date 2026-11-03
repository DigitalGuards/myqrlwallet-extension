import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useStore } from "@/stores/store";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import PersonalSign from "./PersonalSign/PersonalSign";

const QrlSignTypedDataV4 = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;
  // qrl_signTypedData_v4 never reaches an approval surface: the middleware
  // refuses it before one opens, so personal_sign is the only content here.
  const isPersonalSign =
    dAppRequestData?.method === RESTRICTED_METHODS.PERSONAL_SIGN;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-2xl font-bold">{t("dapp.signature.title")}</div>
        <div>{t("dapp.signature.description")}</div>
      </div>
      <div className="flex flex-col gap-4">
        {isPersonalSign && <PersonalSign />}
      </div>
    </div>
  );
});

export default QrlSignTypedDataV4;
