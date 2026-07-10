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
    <div className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-foreground/10 bg-background/85 px-4">
      <QrlWeb3WalletLogo />
      <div className="flex items-center gap-2">
        <AccountBadge />
        <DAppBadge />
        <ChainBadge displayChainName={false} />
        <QrlWeb3WalletMoreOptions />
      </div>
      {/* Ember hairline: the brand rail, softened from the old border-b-2 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-primary/70 via-primary/25 to-transparent"
      />
    </div>
  );
};

export default Header;
