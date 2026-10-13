import { scrollShellToTop } from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { ROUTES } from "@/router/router";
import StorageUtil from "@/utilities/storageUtil";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * An empty component that stays inside the QrlWeb3Wallet component to watch for changing routes.
 * This component takes care of scrolling the screen to top on route change and ensures the user is redirected to the same page on opening the extension.
 */
const RouteMonitor = () => {
  const [previousRouteUsed, setPreviousRouteUsed] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    (async () => {
      const activePage: unknown = await StorageUtil.getActivePage();
      if (typeof activePage === "string" && activePage) {
        await StorageUtil.clearActivePage();
        setPreviousRouteUsed(true);
        await navigate(activePage);
      } else {
        setPreviousRouteUsed(true);
        await navigate(ROUTES.HOME);
      }
    })().catch((error: unknown) => {
      console.error("Failed to restore the active page:", error);
    });
  }, []);

  useEffect(() => {
    scrollShellToTop();
    (async () => {
      if (previousRouteUsed) await StorageUtil.setActivePage(pathname);
    })().catch((error: unknown) => {
      console.error("Failed to save the active page:", error);
    });
  }, [pathname]);

  return null;
};

export default RouteMonitor;
