import { cn } from "@/utilities/stylingUtil";

type BrandedLoaderProps = {
  label?: string;
  className?: string;
};

/**
 * Branded indeterminate loader: an ember beam sweeping a faint track
 * (styles in index.css). Startup has no real progress fraction to show,
 * so the moving beam plus a status label is what keeps the wait from
 * reading as stuck. Keeps the loader-icon testid contract from the
 * spinner it replaces.
 */
const BrandedLoader = ({ label, className }: BrandedLoaderProps) => (
  <div
    role="status"
    data-testid="loader-icon"
    className={cn(
      "flex w-full max-w-56 flex-col items-center gap-3",
      className,
    )}
  >
    <div className="loader-track">
      <div className="loader-beam" />
    </div>
    {label && (
      <span className="animate-pulse text-xs text-muted-foreground">
        {label}
      </span>
    )}
  </div>
);

export default BrandedLoader;
