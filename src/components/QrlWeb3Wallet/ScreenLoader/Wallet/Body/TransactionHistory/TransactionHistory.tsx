import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Tabs, TabsList, TabsTrigger } from "@/components/UI/tabs";
import { useStore } from "@/stores/store";
import type {
  TokenFilter,
  TransactionHistoryEntry,
} from "@/types/transactionHistory";
import { History, Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import TransactionHistoryItem from "./TransactionHistoryItem/TransactionHistoryItem";

const formatDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const groupByDate = (
  transactions: TransactionHistoryEntry[],
): [string, TransactionHistoryEntry[]][] => {
  const groups = new Map<string, TransactionHistoryEntry[]>();
  for (const tx of transactions) {
    const key = formatDateKey(tx.timestamp);
    const existing = groups.get(key);
    if (existing) {
      existing.push(tx);
    } else {
      groups.set(key, [tx]);
    }
  }
  return Array.from(groups.entries());
};

const TransactionHistory = observer(() => {
  const { t } = useTranslation();
  const { qrlStore, transactionHistoryStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;
  const {
    filteredTransactions,
    isLoading,
    isLoadingOnChain,
    hasMoreOnChain,
    filter,
  } = transactionHistoryStore;

  const groupedTransactions = useMemo(
    () => groupByDate(filteredTransactions),
    [filteredTransactions],
  );

  useEffect(() => {
    if (accountAddress) {
      transactionHistoryStore.loadHistory(accountAddress, qrlStore.qrlInstance as Parameters<typeof transactionHistoryStore.loadHistory>[1]);
      transactionHistoryStore.loadOnChainHistory(
        accountAddress,
        blockchain.chainId,
      );
    }
    return () => {
      transactionHistoryStore.stopPolling();
    };
  }, [accountAddress, blockchain.chainId]);

  const showInitialSpinner =
    isLoading || (isLoadingOnChain && filteredTransactions.length === 0);

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="relative z-10 p-8">
        <BackButton />
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('txHistory.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Tabs
              value={filter}
              onValueChange={(value) =>
                transactionHistoryStore.setFilter(value as TokenFilter)
              }
            >
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1">
                  {t('txHistory.filterAll')}
                </TabsTrigger>
                <TabsTrigger value="native" className="flex-1">
                  {t('txHistory.filterNative')}
                </TabsTrigger>
                <TabsTrigger value="zrc20" className="flex-1">
                  {t('txHistory.filterZrc20')}
                </TabsTrigger>
                <TabsTrigger value="nft" className="flex-1">
                  {t('txHistory.filterNft')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {showInitialSpinner && (
              <div className="flex items-center justify-center py-8">
                <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!showInitialSpinner && filteredTransactions.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <History className="h-12 w-12" />
                <p className="text-sm">{t('txHistory.empty')}</p>
              </div>
            )}

            {!isLoading && groupedTransactions.length > 0 && (
              <div className="flex flex-col gap-3">
                {groupedTransactions.map(([dateLabel, transactions]) => (
                  <div key={dateLabel} className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {dateLabel}
                    </p>
                    {transactions.map((tx) => (
                      <TransactionHistoryItem
                        key={tx.id}
                        transaction={tx}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {!showInitialSpinner && hasMoreOnChain && (
              <Button
                className="w-full"
                type="button"
                variant="outline"
                disabled={isLoadingOnChain}
                onClick={() =>
                  void transactionHistoryStore.loadMoreOnChain(
                    accountAddress,
                    blockchain.chainId,
                  )
                }
              >
                {isLoadingOnChain && (
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t('txHistory.loadMore')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default TransactionHistory;
