import type { ReactNode } from "react";

/**
 * The wallet's ONE scrolling region. The shell (QrlWeb3Wallet) is
 * overflow-hidden so the scrollbar lives below the static header instead of
 * running over it; every screen mounts its content inside this region.
 * overflow-x-hidden stays load-bearing: setting overflow-y alone computes
 * overflow-x to auto, and the vertical scrollbar's gutter can squeeze
 * full-width content into a horizontal scrollbar.
 */
export const SCROLL_REGION_ID = "wallet-scroll-region";

/** Scroll the wallet's content region to the top (route/step changes).
 *  window.scrollTo is useless here: the window itself never scrolls. */
export const scrollShellToTop = () => {
  document.getElementById(SCROLL_REGION_ID)?.scrollTo(0, 0);
};

const ScrollRegion = ({ children }: { children: ReactNode }) => (
  <div
    id={SCROLL_REGION_ID}
    className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
  >
    {children}
  </div>
);

export default ScrollRegion;
