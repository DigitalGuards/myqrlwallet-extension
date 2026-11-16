import { observer } from "mobx-react-lite";
import QRC20Tokens from "./QRC20Tokens/QRC20Tokens";

type TokensCardContentProps = {
  onCountChange?: (count: number) => void;
};

// QRL is the chain's native asset, not a token: its balance lives on the
// Active account card, so the Tokens card lists QRC-20 contracts only.
const TokensCardContent = observer(
  ({ onCountChange }: TokensCardContentProps) => {
    return (
      <div className="flex flex-col gap-2">
        <QRC20Tokens onCountChange={onCountChange} />
      </div>
    );
  },
);

export default TokensCardContent;
