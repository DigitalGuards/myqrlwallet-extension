import { getOptimalTokenBalance } from "@/functions/getOptimalTokenBalance";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import TokenListItem from "../../TokenListItem/TokenListItem";
import TokenListItemLoading from "../../TokenListItemLoading/TokenListItemLoading";

type ZRC20TokenProps = {
  contractAddress: string;
  tokenImage: string;
  triggerReRender?: () => void;
};

const ZRC20Token = observer(
  ({ contractAddress, tokenImage, triggerReRender }: ZRC20TokenProps) => {
    const { qrlStore } = useStore();
    const { qrlConnection, activeAccount, getZrc20TokenDetails } = qrlStore;
    const { blockchain } = qrlConnection;
    const { accountAddress } = activeAccount;

    const [token, setToken] =
      useState<Awaited<ReturnType<typeof getZrc20TokenDetails>>["token"]>();

    useEffect(() => {
      (async () => {
        const tokenDetails = await getZrc20TokenDetails(contractAddress);
        if (!tokenDetails.error) {
          setToken(tokenDetails.token);
        }
      })();
    }, [blockchain, accountAddress]);

    return !token ? (
      <TokenListItemLoading />
    ) : (
      <TokenListItem
        isZrc20Token={true}
        contractAddress={contractAddress}
        decimals={Number(token.decimals)}
        balance={getOptimalTokenBalance(token.balance.toString(), token.symbol)}
        balanceBaseUnits={token.balanceBaseUnits}
        name={token.name}
        symbol={token.symbol}
        image={tokenImage}
        triggerReRender={triggerReRender}
      />
    );
  },
);

export default ZRC20Token;
