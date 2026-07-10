import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { getOptimalGasFee } from "@/functions/getOptimalGasFee";
import { ROUTES } from "@/router/router";
import StringUtil from "@/utilities/stringUtil";
import { TransactionReceipt, utils } from "@theqrl/web3";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import CircuitBackground from "../../../../Shared/CircuitBackground/CircuitBackground";

type TransactionSuccessfulProps = {
  transactionReceipt: TransactionReceipt;
};

export const TransactionSuccessful = ({
  transactionReceipt,
}: TransactionSuccessfulProps) => {
  const { t } = useTranslation();
  const {
    blockHash,
    blockNumber,
    transactionHash,
    gasUsed,
    effectiveGasPrice,
  } = transactionReceipt;

  const { prefix: prefixTxHash, addressSplit: addressSplitTxHash } =
    StringUtil.getSplitAddress(transactionHash.toString());
  const { prefix: prefixBlockHash, addressSplit: addressSplitBlockHash } =
    StringUtil.getSplitAddress(blockHash.toString());

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t('transfer.completed')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex flex-col gap-2">
              <div>{t('transfer.completedHash')}</div>
              <div className="font-bold text-secondary">
                {`${prefixTxHash} ${addressSplitTxHash.join(" ")}`}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div>{t('transfer.completedBlockHash')}</div>
              <div className="font-bold text-secondary">
                {`${prefixBlockHash} ${addressSplitBlockHash.join(" ")}`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div className="flex flex-col gap-2">
                <div>{t('transfer.completedBlockNumber')}</div>
                <div className="font-bold text-secondary">
                  {blockNumber.toString()}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div>{t('transfer.completedGasUsed')}</div>
                <div className="font-bold text-secondary">
                  {getOptimalGasFee(
                    utils.fromPlanck(
                      Number(gasUsed) * Number(effectiveGasPrice ?? 0),
                      "quanta",
                    ),
                  )}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-4">
            <span />
            <Link className="w-full" to={ROUTES.HOME}>
              <Button className="w-full" type="button">
                <Check className="mr-2 h-4 w-4" />
                {t('transfer.completedDone')}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
