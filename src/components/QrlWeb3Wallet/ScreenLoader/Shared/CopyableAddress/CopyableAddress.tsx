import { Button } from "@/components/UI/Button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FullAddress from "../AddressDisplay/FullAddress";

type CopyableAddressProps = {
  address: string;
  // Applied to the address text (size/color vary per screen).
  className?: string;
};

/**
 * The split-grouped address display used across the NFT screens, with a
 * copy button. The grouped rendering is easier to eyeball but impossible
 * to copy by selection (the spaces come along), so the button copies the
 * raw address.
 */
const CopyableAddress = ({ address, className }: CopyableAddressProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimerRef.current), []);

  const onCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-w-0 max-w-full items-start gap-2">
      <FullAddress
        address={address}
        className={`min-w-0 flex-1 ${className ?? ""}`}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7 shrink-0 hover:bg-accent hover:text-secondary"
        aria-label={t("account.copy")}
        onClick={onCopy}
      >
        {copied ? <Check size="14" /> : <Copy size="14" />}
      </Button>
    </div>
  );
};

export default CopyableAddress;
