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
    <div className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 dark:border-foreground/10 dark:bg-background/85">
      <QrlWeb3WalletLogo />
      {/* min-w-0 lets the account chip truncate so the three status chips and
          the menu stay inside a narrow side panel. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <AccountBadge />
        <DAppBadge />
        <ChainBadge displayChainName={false} />
        <QrlWeb3WalletMoreOptions />
      </div>
      {/* Dark: sky-blue hairline, the brand rail. Light: a neutral hairline
          under the white header. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border dark:bg-transparent dark:bg-gradient-to-r dark:from-primary/70 dark:via-primary/25 dark:to-transparent"
      />
    </div>
  );
};

export default Header;
