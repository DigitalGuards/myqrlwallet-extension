import withSuspense from "@/functions/withSuspense";
import { lazy } from "react";

const QrlWeb3WalletLogo = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/QrlWeb3WalletLogo/QrlWeb3WalletLogo"
      ),
  ),
);
const AccountBadge = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/AccountBadge/AccountBadge"
      ),
  ),
);
const DAppBadge = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/DAppBadge/DAppBadge"
      ),
  ),
);
const ChainBadge = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge"
      ),
  ),
);
const QrlWeb3WalletMoreOptions = withSuspense(
  lazy(
    () =>
      import(
        "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/QrlWeb3WalletMoreOptions/QrlWeb3WalletMoreOptions"
      ),
  ),
);

const Header = () => {
  return (
    <div className="z-20 flex h-16 shrink-0 items-center justify-between border-b-2 border-secondary bg-background px-4">
      <QrlWeb3WalletLogo />
      <div className="flex items-center gap-2">
        <AccountBadge />
        <DAppBadge />
        <ChainBadge displayChainName={false} />
        <QrlWeb3WalletMoreOptions />
      </div>
    </div>
  );
};

export default Header;
