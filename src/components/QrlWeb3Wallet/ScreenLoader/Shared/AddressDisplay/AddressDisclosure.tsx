import { Button } from "@/components/UI/Button";
import { cn } from "@/utilities/stylingUtil";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AddressFingerprint from "./AddressFingerprint";
import FullAddress from "./FullAddress";

export type AddressDisclosureProps = {
  address: string;
  className?: string;
  fingerprintClassName?: string;
  fullAddressClassName?: string;
};

/**
 * Compact address with explicit reveal and raw-copy actions for narrow surfaces.
 *
 * @example
 * <AddressDisclosure address={resolvedAddress} />
 */
const AddressDisclosure = ({
  address,
  className,
  fingerprintClassName,
  fullAddressClassName,
}: AddressDisclosureProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullAddressId = useId();
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimerRef.current), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <AddressFingerprint
          address={address}
          className={cn("min-w-0 flex-1 text-xs", fingerprintClassName)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={
            copied ? t("account.copied") : t("account.copyFullAddress")
          }
          title={copied ? t("account.copied") : t("account.copyFullAddress")}
          onClick={() => void onCopy()}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-controls={fullAddressId}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("account.hideFullAddress")
              : t("account.showFullAddress")
          }
          title={
            expanded
              ? t("account.hideFullAddress")
              : t("account.showFullAddress")
          }
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {expanded && (
        <div
          id={fullAddressId}
          data-testid="address-disclosure-full"
          className="border-current/20 mt-1 min-w-0 max-w-full rounded-md border bg-background/50 p-2"
        >
          <FullAddress
            address={address}
            className={cn("text-xs leading-relaxed", fullAddressClassName)}
          />
        </div>
      )}
    </div>
  );
};

export default AddressDisclosure;
