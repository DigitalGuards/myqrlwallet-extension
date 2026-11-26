import { cn } from "@/utilities/stylingUtil";
import StringUtil from "@/utilities/stringUtil";

export type FullAddressProps = {
  address: string;
  className?: string;
  /** Set false where the surface already exposes the address to assistive technology and a tooltip adds nothing. */
  showTitle?: boolean;
};

/** Complete grouped address for review surfaces. Grouping never changes the raw value. */
const FullAddress = ({
  address,
  className,
  showTitle = true,
}: FullAddressProps) => {
  const { prefix, addressSplit } = StringUtil.getSplitAddress(address);

  return (
    <span
      className={cn(
        "font-data inline-block min-w-0 max-w-full break-words [overflow-wrap:anywhere]",
        className,
      )}
      title={showTitle ? address : undefined}
    >
      <span className="sr-only">{address}</span>
      <span aria-hidden="true">{`${prefix} ${addressSplit.join(" ")}`}</span>
    </span>
  );
};

export default FullAddress;
