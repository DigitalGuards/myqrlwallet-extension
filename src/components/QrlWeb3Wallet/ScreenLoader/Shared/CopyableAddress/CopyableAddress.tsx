import { Button } from "@/components/UI/Button";
import { useCopy } from "@/hooks/useCopy";
import { Check, Copy, X } from "lucide-react";
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
  const { copied, failed, copy } = useCopy();

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
        className={`size-7 shrink-0 hover:bg-accent hover:text-secondary ${failed ? "text-destructive" : ""}`}
        aria-label={failed ? t("common.copyFailed") : t("account.copy")}
        onClick={() => void copy(address)}
      >
        {failed ? (
          <X size="14" />
        ) : copied ? (
          <Check size="14" />
        ) : (
          <Copy size="14" />
        )}
      </Button>
    </div>
  );
};

export default CopyableAddress;
