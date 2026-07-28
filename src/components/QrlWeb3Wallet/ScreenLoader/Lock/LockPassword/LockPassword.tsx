import { APP_TAB_FILE } from "@/constants/qrlWeb3Wallet";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import LockPasswordCheck from "./LockPasswordCheck/LockPasswordCheck";
import Onboarding from "./Onboarding/Onboarding";

const LockPassword = observer(() => {
  const { lockStore, settingsStore } = useStore();
  const { isPopupWindow } = settingsStore;
  const { hasPasswordSet, isLocked } = lockStore;

  const [isOnboarding, setIsOnboarding] = useState(false);

  // Re-runs when hasPasswordSet flips false while this screen is mounted
  // (a wallet reset from the lock screen), not just on first mount.
  useEffect(() => {
    if (!hasPasswordSet) {
      if (isPopupWindow) {
        browser.tabs.create({
          url: browser.runtime.getURL(APP_TAB_FILE),
        });
      } else {
        setIsOnboarding(true);
      }
    }
  }, [hasPasswordSet, isPopupWindow]);

  if (isOnboarding) return <Onboarding />;

  if (!isLocked || !hasPasswordSet) return;

  if (hasPasswordSet) return <LockPasswordCheck />;

  return;
});

export default LockPassword;
