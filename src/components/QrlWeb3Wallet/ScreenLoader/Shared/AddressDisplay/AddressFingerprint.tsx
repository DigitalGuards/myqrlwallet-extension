import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import { cn } from "@/utilities/stylingUtil";

export type AddressFingerprintProps = {
  address: string;
  className?: string;
};

/** Compact visual identity with the exact address available to assistive technology. */
const AddressFingerprint = ({
  address,
  className,
}: AddressFingerprintProps) => (
  <span
    className={cn(
      "font-data inline-block min-w-0 max-w-full break-words [overflow-wrap:anywhere]",
      className,
    )}
    title={address}
  >
    <span className="sr-only">{address}</span>
    <span aria-hidden="true">{formatQrlAddressFingerprint(address)}</span>
  </span>
);

export default AddressFingerprint;
