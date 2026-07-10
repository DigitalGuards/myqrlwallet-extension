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
  const { qrlConnection } = qrlStore;
  const { isLoading } = qrlConnection;

  return (
    <>
      <BackgroundVideo />
      <div className="relative z-10 flex w-full flex-col items-center p-8">
        {isLoading ? (
          <div className="flex w-full justify-center pt-24">
            <BrandedLoader label={t("home.connecting")} />
          </div>
        ) : (
          <AccountCreateImport />
        )}
      </div>
    </>
  );
});

export default Home;
