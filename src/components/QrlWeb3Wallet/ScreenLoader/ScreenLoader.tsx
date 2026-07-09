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
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequest"
      ),
  ),
);
const Wallet = withSuspense(
  lazy(() => import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Wallet")),
);

const ScreenLoader = observer(() => {
  const { dAppRequestStore, lockStore, qrlStore } = useStore();
  const { hasDAppRequest, readDAppRequestData } = dAppRequestStore;
  const { isLocked, readLockState } = lockStore;

  const [screen, setScreen] = useState(SCREENS.LOCK);
  const wasLockedRef = useRef(true);

  useEffect(() => {
    (async () => {
      await readLockState();
      await readDAppRequestData();
    })();
  }, []);

  useEffect(() => {
    if (wasLockedRef.current && !isLocked) {
      // Re-initialize blockchain connection after unlock so the wallet
      // doesn't stay in a "not connected" state when the service worker
      // was asleep during the initial load.
      qrlStore.initializeBlockchain();
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
});

export default ScreenLoader;
