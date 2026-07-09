import { observer } from "mobx-react-lite";
import ZRC20Tokens from "./ZRC20Tokens/ZRC20Tokens";

// QRL is the chain's native asset, not a token: its balance lives on the
// Active account card, so the Tokens card lists ZRC-20 contracts only.
const TokensCardContent = observer(() => {
  return (
    <div className="flex flex-col gap-2">
      <ZRC20Tokens />
    </div>
  );
});

export default TokensCardContent;
