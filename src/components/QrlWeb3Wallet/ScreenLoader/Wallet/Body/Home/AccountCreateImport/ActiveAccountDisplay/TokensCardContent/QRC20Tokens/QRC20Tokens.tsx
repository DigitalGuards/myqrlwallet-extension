import { tokenView } from "@/utilities/storageViews";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRC20Token from "./QRC20Token/QRC20Token";
import { QRC_20_ITEMS_DISPLAY_LIMIT } from "@/constants/qrc20Token";
import { TokenContractType } from "@/scripts/middlewares/middlewareTypes";

type QRC20TokensProps = {
  shouldDisplayAllTokens?: boolean;
  // Reported after every load of the stored list, so a parent gating on
  // "is this list empty" tracks in-place hides as well as chain and account
  // switches instead of holding a snapshot of its own.
  onCountChange?: (count: number) => void;
};

const QRC20Tokens = observer(
  ({ shouldDisplayAllTokens = false, onCountChange }: QRC20TokensProps) => {
    const { t } = useTranslation();
    const { qrlStore } = useStore();
    const { activeAccount, qrlConnection } = qrlStore;
    const { accountAddress } = activeAccount;
    const { blockchain } = qrlConnection;

    const [reRender, setReRender] = useState(0);
    const [tokenContractsList, setTokenContractsList] = useState<
      TokenContractType[]
    >([]);

    const numberOfTokens = tokenContractsList.length;
    const displayLimit = shouldDisplayAllTokens
      ? numberOfTokens + 1
      : QRC_20_ITEMS_DISPLAY_LIMIT;

    useEffect(() => {
      (async () => {
        const storedTokens =
          await StorageUtil.getTokenContractsList(accountAddress);
        setTokenContractsList(storedTokens.map(tokenView));
        onCountChange?.(storedTokens.length);
      })().catch((error: unknown) => {
        console.error("Failed to load tokens:", error);
      });
    }, [blockchain, accountAddress, reRender]);

    const triggerReRender = () => {
      setReRender(reRender + 1);
    };

    if (shouldDisplayAllTokens && !numberOfTokens) {
      return <div>{t("tokens.empty")}</div>;
    }

    return (
      <>
        {tokenContractsList
          .slice(0, displayLimit)
          .map(({ address, image, symbol }) => (
            <QRC20Token
              key={address}
              contractAddress={address}
              tokenImage={image}
              storedSymbol={symbol}
              triggerReRender={triggerReRender}
            />
          ))}
      </>
    );
  },
);

export default QRC20Tokens;
