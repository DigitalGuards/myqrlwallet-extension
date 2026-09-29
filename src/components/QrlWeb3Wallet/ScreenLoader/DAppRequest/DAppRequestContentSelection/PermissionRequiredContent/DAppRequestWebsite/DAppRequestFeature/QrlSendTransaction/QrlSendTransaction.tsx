import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import QrlSendTransactionForContent from "./QrlSendTransactionForContent/QrlSendTransactionForContent";
import { useEffect, useState } from "react";

export const SEND_TRANSACTION_TYPES = {
  CONTRACT_DEPLOYMENT: "CONTRACT_DEPLOYMENT",
  CONTRACT_INTERACTION: "CONTRACT_INTERACTION",
  QRL_TRANSFER: "QRL_TRANSFER",
  /** A `to` with no amount and no calldata: a bare call, not a transfer. */
  PLAIN_CALL: "PLAIN_CALL",
  UNKNOWN: "UNKNOWN",
} as const;

const QrlSendTransaction = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore } = useStore();
  const { dAppRequestData } = dAppRequestStore;

  // Every shape gets a heading and a description. An unclassified request
  // used to render an empty heading and hide its recipient while still
  // being signable (security review finding M2), which read as a blank
  // approval screen for a transaction that moved real value.
  const [transactionHeading, setTransactionHeading] = useState(
    t("dapp.sendTransaction.unknownShape"),
  );
  const [transactionSubHeading, setTransactionSubHeading] = useState(
    t("dapp.sendTransaction.unknownShapeDescription"),
  );
  const [transactionType, setTransactionType] = useState<
    keyof typeof SEND_TRANSACTION_TYPES
  >(SEND_TRANSACTION_TYPES.UNKNOWN);

  useEffect(() => {
    const params = dAppRequestData?.params[0];
    if (!params || typeof params !== "object") {
      return;
    }
    // The first three branches keep the exact conditions (and therefore the
    // exact signing paths) they always had. Only the shapes that used to
    // fall through to a blank UNKNOWN screen are new.
    const { to, value, data } = params;
    if (!to && data) {
      setTransactionHeading(t("dapp.sendTransaction.contractDeploy"));
      setTransactionSubHeading(
        t("dapp.sendTransaction.contractDeployDescription"),
      );
      setTransactionType(SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT);
    } else if (to && data) {
      setTransactionHeading(t("dapp.sendTransaction.contractInteract"));
      setTransactionSubHeading(
        t("dapp.sendTransaction.contractInteractDescription"),
      );
      setTransactionType(SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION);
    } else if (to && value && !data) {
      setTransactionHeading(t("dapp.sendTransaction.transferQrl"));
      setTransactionSubHeading(
        t("dapp.sendTransaction.transferQrlDescription"),
      );
      setTransactionType(SEND_TRANSACTION_TYPES.QRL_TRANSFER);
    } else if (to) {
      // A recipient with neither an amount nor calldata. It is still a real
      // transaction that pays a fee, so it is shown as a plain call with
      // the recipient visible. It keeps the contract-call signing path it
      // already had, because the transfer path requires an amount.
      setTransactionHeading(t("dapp.sendTransaction.plainCall"));
      setTransactionSubHeading(t("dapp.sendTransaction.plainCallDescription"));
      setTransactionType(SEND_TRANSACTION_TYPES.PLAIN_CALL);
    } else {
      setTransactionHeading(t("dapp.sendTransaction.unknownShape"));
      setTransactionSubHeading(
        t("dapp.sendTransaction.unknownShapeDescription"),
      );
      setTransactionType(SEND_TRANSACTION_TYPES.UNKNOWN);
    }
  }, [dAppRequestData]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-2xl font-bold">{transactionHeading}</div>
        <div>{transactionSubHeading}</div>
      </div>
      <div className="flex flex-col gap-4">
        <QrlSendTransactionForContent transactionType={transactionType} />
      </div>
    </div>
  );
});

export default QrlSendTransaction;
