import { formatFiatCompact } from "@/functions/formatFiat";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { useStore } from "@/stores/store";
import StringUtil from "@/utilities/stringUtil";
import { Check, Copy, TrendingDown, TrendingUp } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";

/**
 * Hero balance block, styled after the qrlwallet.com Home card: centered
 * balance, fiat estimate with 24h trend, and the address in a copyable
 * mono pill.
 */
const ActiveAccountDisplay = observer(() => {
  const { qrlStore, priceStore, settingsStore } = useStore();
  const { activeAccount, getAccountBalance } = qrlStore;
  const { accountAddress } = activeAccount;
  const { showBalanceAndPrice, currency } = settingsStore;

  const [copiedAddress, setCopiedAddress] = useState(false);

  const accountBalance = getAccountBalance(accountAddress);
  // The store formats balances as "<amount> <unit>"; split them so the unit
  // can sit on its own smaller line under the amount.
  const balanceSpaceIdx = accountBalance.indexOf(" ");
  const balanceAmount =
    balanceSpaceIdx === -1
      ? accountBalance
      : accountBalance.slice(0, balanceSpaceIdx);
  const balanceUnit =
    balanceSpaceIdx === -1 ? "" : accountBalance.slice(balanceSpaceIdx + 1);
  const { prefix, addressSplit } = StringUtil.getSplitAddress(accountAddress);
  // Compact pill: full address lives on Receive and the account list.
  const abbreviatedAddress = `${prefix}${addressSplit[0]}...${addressSplit[addressSplit.length - 1]}`;

  const numericBalance = parseBalanceValue(accountBalance).toNumber();
  const price = priceStore.getPrice(currency);
  const fiatDisplay =
    showBalanceAndPrice && price > 0
      ? formatFiatCompact(numericBalance, price, currency)
      : "";
  const change24h = priceStore.getChange24h(currency);
  const showChange = showBalanceAndPrice && price > 0 && change24h !== 0;

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 1500);
    } catch {
      // clipboard unavailable; nothing to signal
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex flex-col items-center">
        <div className="font-data animate-appear-in text-3xl font-bold tracking-tight text-foreground">
          {balanceAmount}
        </div>
        {balanceUnit && (
          <div className="font-data text-sm font-medium text-muted-foreground">
            {balanceUnit}
          </div>
        )}
      </div>
      {fiatDisplay && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{fiatDisplay}</span>
          {showChange && (
            <span
              className={`flex items-center gap-0.5 text-xs ${change24h >= 0 ? "text-success" : "text-destructive"}`}
            >
              {change24h >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {Math.abs(change24h).toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-2 rounded-full border border-identity-accent/30 bg-identity-accent/[0.08] px-3 py-1.5 transition-colors hover:bg-identity-accent/[0.14]"
        aria-label="Copy address"
        title={accountAddress}
        onClick={() => void handleCopyAddress()}
      >
        <span className="font-data text-xs text-identity-accent">
          {abbreviatedAddress}
        </span>
        {copiedAddress ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0 text-identity-accent/60" />
        )}
      </button>
    </div>
  );
});

export default ActiveAccountDisplay;
