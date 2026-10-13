import { cva } from "class-variance-authority";
import { useEffect, useState } from "react";

type CurrencyImagePreloadProps = {
  iconUrls: readonly unknown[];
};

const currencyImageClasses = cva("mt-1 transition-all duration-1000", {
  variants: {
    hasValidUrl: {
      true: ["h-8 w-8 mr-4 opacity-100"],
      false: ["h-8 w-0 opacity-0"],
    },
  },
  defaultVariants: {
    hasValidUrl: false,
  },
});

// Only inline data URIs are allowed for pre-approval preview, so the dApp
// cannot use the icon URL as a network ping that fires before the user
// approves the request (F-11).
const ALLOWED_DATA_URI_PREFIXES = [
  "data:image/png",
  "data:image/jpeg",
  "data:image/jpg",
  "data:image/svg+xml",
  "data:image/webp",
  "data:image/gif",
];

const isInlineImageDataUri = (url: unknown): url is string => {
  if (typeof url !== "string") {
    return false;
  }
  const lower = url.trim().toLowerCase();
  return ALLOWED_DATA_URI_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

const CurrencyImagePreload = ({ iconUrls }: CurrencyImagePreloadProps) => {
  const [validUrl, setValidUrl] = useState<string | undefined>();

  useEffect(() => {
    const lifecycle = new AbortController();

    void (async () => {
      for (const url of iconUrls) {
        if (!isInlineImageDataUri(url)) {
          continue;
        }
        try {
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              resolve();
            };
            img.onerror = () => {
              reject(new Error("Currency icon failed to load"));
            };
            img.src = url;
          });

          if (!lifecycle.signal.aborted) {
            setValidUrl(url);
            break;
          }
        } catch {
          continue;
        }
      }
    })();

    return () => {
      lifecycle.abort();
    };
  }, [iconUrls]);

  return (
    <img
      src={validUrl}
      alt="Currency icon"
      className={currencyImageClasses({ hasValidUrl: !!validUrl })}
    />
  );
};

export default CurrencyImagePreload;
