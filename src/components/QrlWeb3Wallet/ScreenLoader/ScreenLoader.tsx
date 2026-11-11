import withSuspense from "@/functions/withSuspense";
import ScrollRegion from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
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

  if (screen === SCREENS.LOCK)
    return (
      <ScrollRegion>
        <Lock />
      </ScrollRegion>
    );

  if (screen === SCREENS.DAPP_REQUEST)
    return (
      <ScrollRegion>
        <DAppRequest />
      </ScrollRegion>
    );

  if (screen === SCREENS.WALLET) return <Wallet />;
  return undefined;
});

export default ScreenLoader;
