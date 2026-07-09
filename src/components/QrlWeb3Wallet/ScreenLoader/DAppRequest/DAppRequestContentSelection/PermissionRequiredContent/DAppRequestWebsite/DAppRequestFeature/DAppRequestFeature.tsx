import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import QrlRequestAccount from "./QrlRequestAccount/QrlRequestAccount";
import QrlSendTransaction from "./QrlSendTransaction/QrlSendTransaction";
import QrlSignTypedDataV4 from "./QrlSignTypedDataV4/QrlSignTypedDataV4";
import QrlPqSign from "./QrlPqSign/QrlPqSign";

const DAppRequestFeature = observer(() => {
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;

  switch (dAppRequestData?.method) {
    case RESTRICTED_METHODS.QRL_REQUEST_ACCOUNTS:
    case RESTRICTED_METHODS.WALLET_REQUEST_PERMISSIONS:
      return <QrlRequestAccount />;
    case RESTRICTED_METHODS.QRL_SEND_TRANSACTION:
      return <QrlSendTransaction />;
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4:
    case RESTRICTED_METHODS.PERSONAL_SIGN:
      return <QrlSignTypedDataV4 />;
    case RESTRICTED_METHODS.QRL_SIGN_MESSAGE:
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA:
      return <QrlPqSign />;
    default:
      return <></>;
  }
});

export default DAppRequestFeature;
