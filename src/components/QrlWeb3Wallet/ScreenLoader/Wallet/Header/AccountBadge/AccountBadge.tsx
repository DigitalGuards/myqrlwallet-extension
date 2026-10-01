import { Button } from "@/components/UI/Button";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import AddressFingerprint from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressFingerprint";
import { cva } from "class-variance-authority";
import { Wallet } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

// Ice blue identifies: the account marker wears the identity color.
// min-w-0 plus px-2 keeps this the chip that gives way when the header runs
// out of room, so the label ellipsises and the status chips stay whole.
const badgeButtonClasses = cva(
  "font-data flex min-w-0 items-center gap-1 rounded-full border-identity-accent/30 px-2 text-xs text-identity-accent hover:text-identity-accent",
  {
    variants: {
      isActive: {
        true: ["bg-identity-accent/10"],
      },
    },
    defaultVariants: {
      isActive: false,
    },
  },
);

const AccountBadge = observer(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const pathName = location.pathname;
  const { qrlStore, accountLabelsStore } = useStore();
  const { activeAccount, qrlAccounts } = qrlStore;
  const { accountAddress } = activeAccount;

  // Start the read at mount. Waiting for an address meant the read only
  // began after the account was already on screen, so the chip was
  // guaranteed at least one render with no name to show.
  useEffect(() => {
    accountLabelsStore.loadLabels();
  }, []);

  // Positional name while the stored one is still in flight, so the chip
  // never flashes the raw address between the account becoming active and
  // its label arriving.
  const label = accountLabelsStore.displayLabel(
    accountAddress,
    qrlAccounts.accounts,
  );

  return (
    !!accountAddress && (
      <Link className="min-w-0" to={ROUTES.ACCOUNT_LIST}>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={badgeButtonClasses({
                isActive: pathName === ROUTES.ACCOUNT_LIST,
              })}
              aria-label={`${t("nav.accounts")}: ${accountAddress}`}
            >
              <Wallet className="h-3 w-3 shrink-0" />
              {/* No name yet means the wallet icon stands alone. The chip
                  carries a name; the address has its own places: the
                  tooltip below and the account list. */}
              {label ? (
                <span className="max-w-20 truncate">{label}</span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex max-w-72 flex-col gap-1">
              <Label>{t("nav.accounts")}</Label>
              <AddressFingerprint
                address={accountAddress}
                className="text-xs"
              />
            </div>
          </TooltipContent>
        </Tooltip>
      </Link>
    )
  );
});

export default AccountBadge;
