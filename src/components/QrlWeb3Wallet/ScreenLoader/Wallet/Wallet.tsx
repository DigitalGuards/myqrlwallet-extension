import withSuspense from "@/functions/withSuspense";
import ScrollRegion from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { lazy } from "react";

const Header = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/Header"),
  ),
);
const Body = withSuspense(
  lazy(
    () => import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Body"),
  ),
);
const SidePanelNotice = withSuspense(
  lazy(
    () =>
      import("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/SidePanelNotice/SidePanelNotice"),
  ),
);

const Wallet = () => {
  return (
    <>
      <Header />
      <ScrollRegion>
        <SidePanelNotice />
        <Body />
      </ScrollRegion>
    </>
  );
};

export default Wallet;
