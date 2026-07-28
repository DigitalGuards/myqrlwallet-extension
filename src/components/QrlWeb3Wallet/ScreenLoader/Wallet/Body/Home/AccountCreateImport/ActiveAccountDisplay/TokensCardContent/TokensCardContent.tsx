import { observer } from "mobx-react-lite";
import ZRC20Tokens from "./ZRC20Tokens/ZRC20Tokens";

type TokensCardContentProps = {
  onCountChange?: (count: number) => void;
};

// QRL is the chain's native asset, not a token: its balance lives on the
// Active account card, so the Tokens card lists ZRC-20 contracts only.
const TokensCardContent = observer(
  ({ onCountChange }: TokensCardContentProps) => {
    return (
      <div className="flex flex-col gap-2">
        <ZRC20Tokens onCountChange={onCountChange} />
      </div>
    );
  },
);

export default TokensCardContent;
