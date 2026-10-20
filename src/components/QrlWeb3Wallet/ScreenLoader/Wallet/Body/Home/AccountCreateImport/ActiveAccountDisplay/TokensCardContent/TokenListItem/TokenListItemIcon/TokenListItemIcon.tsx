import { getRandomTailwindTextColor } from "@/utilities/stylingUtil";
import { cva } from "class-variance-authority";
import { FileBox } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

const tokenIconClasses = cva("h-8 w-8 flex-shrink-0", {
  variants: {
    shouldDisplayFallback: {
      true: ["hidden"],
      false: ["block"],
    },
  },
  defaultVariants: {
    shouldDisplayFallback: false,
  },
});

type TokenListItemIconProps = {
  icon: string;
  symbol: string;
};

const TokenListItemIcon = observer(
  ({ icon, symbol }: TokenListItemIconProps) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasSrcError, setHasSrcError] = useState(false);

    useEffect(() => {
      setIsLoading(true);
      setHasSrcError(false);
    }, [icon, symbol]);

    const shouldDisplayFallback = useMemo(
      () => isLoading || hasSrcError,
      [isLoading, hasSrcError],
    );

    return (
      <>
        {shouldDisplayFallback && (
          <FileBox
            className={`shrink-0 ${getRandomTailwindTextColor(symbol)}`}
            size={32}
            data-testid="filebox-icon"
          />
        )}
        <img
          className={tokenIconClasses({ shouldDisplayFallback })}
          src={icon}
          alt={symbol}
          onLoad={() => {
            setIsLoading(false);
          }}
          onError={() => {
            setIsLoading(false);
            setHasSrcError(true);
          }}
        />
      </>
    );
  },
);

export default TokenListItemIcon;
