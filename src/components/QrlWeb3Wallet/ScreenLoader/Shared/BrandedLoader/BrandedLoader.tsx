import { cn } from "@/utilities/stylingUtil";

type BrandedLoaderProps = {
  label?: string;
  className?: string;
  /** 0..1 switches the bar from an indeterminate sweep to a real fill. */
  progress?: number;
};

/**
 * Branded loader (styles in index.css): with a `progress` fraction it is
 * a determinate ember fill bar; without one it falls back to an
 * indeterminate sweeping beam for waits that have no measurable fraction
 * (like waking the service worker). Keeps the loader-icon testid contract
 * from the spinner it replaces.
 */
const BrandedLoader = ({ label, className, progress }: BrandedLoaderProps) => (
  <div
    role="status"
    data-testid="loader-icon"
    className={cn(
      "flex w-full max-w-56 flex-col items-center gap-3",
      className,
    )}
  >
    <div className="loader-track">
      {typeof progress === "number" ? (
        <div
          className="loader-fill"
          style={{
            width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%`,
          }}
        />
      ) : (
        <div className="loader-beam" />
      )}
    </div>
    {label && (
      <span className="animate-pulse text-xs text-muted-foreground">
        {label}
      </span>
    )}
  </div>
);

export default BrandedLoader;
