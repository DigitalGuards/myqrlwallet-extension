import { cn } from "@/utilities/stylingUtil";
import type { SVGProps } from "react";

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children"> & {
  /** Accessible label. Pass "" to hide the mark from assistive tech when a
   * sibling element already carries the name. */
  title?: string;
};

/**
 * The MyQRLWallet "3A" brand mark: thirteen rounded blocks tracing an omega,
 * the shape the QRL protocol itself uses for its signature address prefix.
 * Fills with currentColor so it inherits text-primary (or any other color
 * utility) and tracks the light and dark theme automatically.
 */
const BrandMark = ({ className, title, ...props }: BrandMarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("shrink-0", className)}
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
    {...props}
  >
    {title && <title>{title}</title>}
    <rect x="5.1" y="0.4" width="4.4" height="4.4" rx="0.5" />
    <rect x="9.8" y="0.4" width="4.4" height="4.4" rx="0.5" />
    <rect x="14.5" y="0.4" width="4.4" height="4.4" rx="0.5" />
    <rect x="0.4" y="5.1" width="4.4" height="4.4" rx="0.5" />
    <rect x="19.2" y="5.1" width="4.4" height="4.4" rx="0.5" />
    <rect x="0.4" y="9.8" width="4.4" height="4.4" rx="0.5" />
    <rect x="19.2" y="9.8" width="4.4" height="4.4" rx="0.5" />
    <rect x="5.1" y="14.5" width="4.4" height="4.4" rx="0.5" />
    <rect x="14.5" y="14.5" width="4.4" height="4.4" rx="0.5" />
    <rect x="0.4" y="19.2" width="4.4" height="4.4" rx="0.5" />
    <rect x="5.1" y="19.2" width="4.4" height="4.4" rx="0.5" />
    <rect x="14.5" y="19.2" width="4.4" height="4.4" rx="0.5" />
    <rect x="19.2" y="19.2" width="4.4" height="4.4" rx="0.5" />
  </svg>
);

export default BrandMark;
