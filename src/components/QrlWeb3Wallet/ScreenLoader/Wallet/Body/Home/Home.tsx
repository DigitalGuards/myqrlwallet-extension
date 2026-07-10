import withSuspense from "@/functions/withSuspense";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { useTranslation } from "react-i18next";
import BrandedLoader from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BrandedLoader/BrandedLoader";

const AccountCreateImport = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/AccountCreateImport"
      ),
  ),
);
const BackgroundVideo = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/BackgroundVideo/BackgroundVideo"
      ),
  ),
);

const Home = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlConnection, initProgress } = qrlStore;
  const { isLoading } = qrlConnection;

  const phaseLabels = {
    chain: t("loader.phaseChain"),
    network: t("loader.phaseNetwork"),
    accounts: t("loader.phaseAccounts"),
    session: t("loader.phaseSession"),
  } as const;
  const showStartup = initProgress?.active || isLoading;

  return (
    <>
      <BackgroundVideo />
      <div className="relative z-10 flex w-full flex-col items-center p-8">
        {showStartup ? (
          <div className="flex w-full justify-center pt-24">
            <BrandedLoader
              progress={initProgress?.active ? initProgress.fraction : undefined}
              label={
                initProgress?.active
                  ? phaseLabels[initProgress.phase]
                  : t("home.connecting")
              }
            />
          </div>
        ) : (
          <AccountCreateImport />
        )}
      </div>
    </>
  );
});

export default Home;
