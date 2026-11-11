import withSuspense from "@/functions/withSuspense";
import ScrollRegion from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useLocation, useNavigate } from "react-router-dom";
import { lazy, useEffect, useRef, useState } from "react";

const SCREENS = {
  LOCK: "LOCK",
  DAPP_REQUEST: "DAPP_REQUEST",
  WALLET: "WALLET",
};

const Lock = withSuspense(
  lazy(() => import("@/components/QrlWeb3Wallet/ScreenLoader/Lock/Lock")),
);
const DAppRequest = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequest"),
  ),
);
const Wallet = withSuspense(
  lazy(() => import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Wallet")),
);

/**
 * A normal send ends on the history, where the new transaction shows as
 * pending. An approved dApp send does the same on a surface that stays
 * open. It is its own component so that only it follows the route and the
 * screens below ScreenLoader are left alone on navigation.
 */
const CompletedDAppSendHistory = observer(() => {
  const { dAppRequestStore, qrlStore, settingsStore } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { completedDAppSend } = dAppRequestStore;

  useEffect(() => {
    if (!completedDAppSend) return;
    const { from } = completedDAppSend;
    dAppRequestStore.clearCompletedDAppSend();
    // The popup closes itself after an approval. A route change there would
    // only alter the screen the wallet opens on next time.
    if (settingsStore.isPopupWindow) return;
    // The pending entry is stored under the sender as the request spelled
    // it, and the history lists the active account under its own spelling,
    // so only an exact match shows the new transaction there.
    if (from !== qrlStore.activeAccount.accountAddress) return;
    void Promise.resolve(
      navigate(ROUTES.TRANSACTION_HISTORY, {
        replace: location.pathname === ROUTES.TRANSACTION_HISTORY,
      }),
    ).catch((error: unknown) => {
      console.error("Failed to show the transaction history:", error);
    });
  }, [completedDAppSend]);

  return null;
});

const ScreenLoader = observer(() => {
  const { dAppRequestStore, lockStore, qrlStore } = useStore();
  const { hasDAppRequest } = dAppRequestStore;
  const { isLocked } = lockStore;

  const [screen, setScreen] = useState(SCREENS.LOCK);
  const wasLockedRef = useRef(true);

  useEffect(() => {
    (async () => {
      await lockStore.readLockState();
      await dAppRequestStore.readDAppRequestData();
    })().catch((error: unknown) => {
      console.error("Failed to load the wallet screen state:", error);
    });
  }, []);

  useEffect(() => {
    if (wasLockedRef.current && !isLocked) {
      // Re-initialize blockchain connection after unlock so the wallet
      // doesn't stay in a "not connected" state when the service worker
      // was asleep during the initial load.
      qrlStore.initializeBlockchain().catch((error: unknown) => {
        console.error(
          "Failed to initialize the blockchain after unlock:",
          error,
        );
      });
    }
    wasLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    if (isLocked) {
      setScreen(SCREENS.LOCK);
    } else if (hasDAppRequest) {
      setScreen(SCREENS.DAPP_REQUEST);
    } else {
      setScreen(SCREENS.WALLET);
    }
  }, [isLocked, hasDAppRequest]);

  const content =
    screen === SCREENS.LOCK ? (
      <ScrollRegion>
        <Lock />
      </ScrollRegion>
    ) : screen === SCREENS.DAPP_REQUEST ? (
      <ScrollRegion>
        <DAppRequest />
      </ScrollRegion>
    ) : screen === SCREENS.WALLET ? (
      <Wallet />
    ) : undefined;

  return (
    <>
      <CompletedDAppSendHistory />
      {content}
    </>
  );
});

export default ScreenLoader;
