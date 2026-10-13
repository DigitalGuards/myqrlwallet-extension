import { getRandomTailwindTextColor } from "@/utilities/stylingUtil";
import { cva } from "class-variance-authority";
import { Link } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const chainFallbackIconClasses = cva("flex-shrink-0", {
  variants: {
    chainIconSize: {
      small: ["h-3 w-3"],
      medium: ["h-6 w-6"],
    },
  },
  defaultVariants: {
    chainIconSize: "medium",
  },
});

const chainIconClasses = cva("flex-shrink-0", {
  variants: {
    shouldDisplayFallback: {
      true: ["hidden"],
      false: ["block"],
    },
    chainIconSize: {
      small: ["h-3 w-3"],
      medium: ["h-6 w-6"],
    },
  },
  defaultVariants: {
    shouldDisplayFallback: false,
    chainIconSize: "medium",
  },
});

type ChainIconSize = "small" | "medium";

type ChainIconType = {
  src: string;
  alt: string;
  chainIconSize?: ChainIconSize;
};

const ChainIcon = ({ src, alt, chainIconSize }: ChainIconType) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasSrcError, setHasSrcError] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setHasSrcError(false);
  }, [src, alt]);

  const shouldDisplayFallback = useMemo(
    () => isLoading || hasSrcError,
    [isLoading, hasSrcError],
  );

  return (
    <>
      {shouldDisplayFallback && (
        <Link
          className={chainFallbackIconClasses({
            chainIconSize,
            className: getRandomTailwindTextColor(alt),
          })}
          data-testid="link-icon"
        />
      )}
      <img
        className={chainIconClasses({ shouldDisplayFallback, chainIconSize })}
        src={src}
        alt={alt}
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
};

export default ChainIcon;
