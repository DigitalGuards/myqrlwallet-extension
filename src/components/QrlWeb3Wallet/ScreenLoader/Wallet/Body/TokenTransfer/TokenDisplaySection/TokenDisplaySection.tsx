import { getRandomTailwindTextColor } from "@/utilities/stylingUtil";
import { FileBox } from "lucide-react";

type TokenDisplaySectionProps = {
  tokenImage: string;
  tokenSymbol: string;
  tokenName: string;
};

const TokenDisplaySection = ({
  tokenImage,
  tokenSymbol,
  tokenName,
}: TokenDisplaySectionProps) => {
  return (
    <div className="flex items-center gap-4">
      {tokenImage ? (
        <img className="h-12 w-12" src={tokenImage} alt={tokenSymbol} />
      ) : (
        <FileBox
          className={`shrink-0 ${getRandomTailwindTextColor(tokenSymbol)}`}
          size={48}
        />
      )}
      <div className="flex flex-col">
        <div className="text-2xl font-bold">{tokenSymbol}</div>
        {tokenName && tokenName !== tokenSymbol && (
          <div className="text-sm text-muted-foreground">{tokenName}</div>
        )}
      </div>
    </div>
  );
};

export default TokenDisplaySection;
