import { formatFiatCompact } from "@/functions/formatFiat";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { useStore } from "@/stores/store";
import StringUtil from "@/utilities/stringUtil";
import {
  Check,
  Copy,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";

/**
 * Hero balance block, styled after the qrlwallet.com Home card: centered
 * balance with copy + refresh, fiat estimate with 24h trend, and the
 * address in a copyable mono pill.
 */
const ActiveAccountDisplay = observer(() => {
  const { qrlStore, priceStore, settingsStore } = useStore();
  const { activeAccount, getAccountBalance } = qrlStore;
  const { accountAddress } = activeAccount;
  const { showBalanceAndPrice, currency } = settingsStore;

  const [copiedItem, setCopiedItem] = useState<"balance" | "address" | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const accountBalance = getAccountBalance(accountAddress);
  const { prefix, addressSplit } = StringUtil.getSplitAddress(accountAddress);

  const numericBalance = parseBalanceValue(accountBalance).toNumber();
  const price = priceStore.getPrice(currency);
  const fiatDisplay =
    showBalanceAndPrice && price > 0
      ? formatFiatCompact(numericBalance, price, currency)
      : "";
  const change24h = priceStore.getChange24h(currency);
  const showChange = showBalanceAndPrice && price > 0 && change24h !== 0;

  const handleCopy = async (text: string, item: "balance" | "address") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(item);
      setTimeout(() => setCopiedItem(null), 1500);
    } catch {
      // clipboard unavailable; nothing to signal
    }
  };

  const refreshBalance = async () => {
    setIsRefreshing(true);
    try {
      await qrlStore.refreshBlockchainData();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex animate-appear-in items-center text-2xl font-bold text-foreground">
        <button
          type="button"
          className="flex items-center gap-2"
          aria-label="Copy balance"
          onClick={() => void handleCopy(accountBalance, "balance")}
        >
          <span>{accountBalance}</span>
          {copiedItem === "balance" ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4 opacity-60" />
          )}
        </button>
        <button
          type="button"
          className="ml-2 flex items-center justify-center rounded-full p-1 hover:bg-muted"
          aria-label="Refresh balance"
          onClick={() => void refreshBalance()}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      {fiatDisplay && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{fiatDisplay}</span>
          {showChange && (
            <span
              className={`flex items-center gap-0.5 text-xs ${change24h >= 0 ? "text-green-500" : "text-red-500"}`}
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
        className="mt-1 inline-flex max-w-full items-center gap-2 rounded-full bg-black/20 px-4 py-1.5 backdrop-blur-sm"
        aria-label="Copy address"
        onClick={() => void handleCopy(accountAddress, "address")}
      >
        <span className="break-all font-mono text-xs text-secondary">
          {`${prefix} ${addressSplit.join(" ")}`}
        </span>
        {copiedItem === "address" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-secondary" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0 text-secondary/60" />
        )}
      </button>
    </div>
  );
});

export default ActiveAccountDisplay;
