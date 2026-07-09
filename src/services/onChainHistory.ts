import { getExplorerApiBase } from "@/configuration/assetDiscoveryConfig";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";

/**
 * Explorer-side transaction history, same plumbing as assetDiscovery.
 * Local storage only knows transactions sent from this extension; the
 * explorer fills in everything else (received transfers, sends made from
 * other wallets on the same seed). Chains without a configured explorer
 * and every error path resolve to an empty page, so a flaky explorer
 * degrades to local-only history instead of breaking the screen.
 */

export const ON_CHAIN_PAGE_SIZE = 10;

export type OnChainHistoryPage = {
  entries: TransactionHistoryEntry[];
  totalCount: number;
};

// One row of the zondscan /api/address/aggregate/:addr response,
// restricted to the fields the extension consumes.
type ExplorerAggregateTx = {
  From?: string;
  To?: string;
  TxHash?: string;
  /** Block timestamp, hex seconds ("0x6a4fb2e4"). */
  TimeStamp?: string;
  /** Decimal string already in QRL units ("750.000000000000000000"). */
  Amount?: string;
  /** Decimal string already in QRL units. */
  PaidFees?: string;
  BlockNumber?: string;
};

type ExplorerAggregateResponse = {
  transactions_by_address?: ExplorerAggregateTx[] | null;
  transactions_count?: number;
};

const emptyPage = (): OnChainHistoryPage => ({ entries: [], totalCount: 0 });

const toEntry = (
  row: ExplorerAggregateTx,
  chainId: string,
): TransactionHistoryEntry => {
  const amount = Number(row.Amount);
  const timestampSeconds = parseInt(row.TimeStamp ?? "", 16);
  const txHash = row.TxHash ?? "";
  return {
    id: txHash,
    from: row.From ?? "",
    to: row.To ?? "",
    amount: Number.isFinite(amount) ? amount : 0,
    tokenSymbol: NATIVE_TOKEN.symbol,
    tokenName: NATIVE_TOKEN.name,
    isZrc20Token: false,
    tokenContractAddress: "",
    tokenDecimals: NATIVE_TOKEN.decimals,
    transactionHash: txHash,
    blockNumber: row.BlockNumber ?? "",
    gasUsed: "",
    effectiveGasPrice: "",
    paidFeesQrl: row.PaidFees,
    status: true,
    timestamp: Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : 0,
    chainId,
  };
};

export async function fetchOnChainHistory(
  address: string,
  chainId: string,
  page: number,
): Promise<OnChainHistoryPage> {
  const apiBase = getExplorerApiBase(chainId);
  if (!apiBase || !address) return emptyPage();

  try {
    const response = await fetch(
      `${apiBase}/api/address/aggregate/${address}?page=${page}&limit=${ON_CHAIN_PAGE_SIZE}`,
    );
    if (!response.ok) return emptyPage();

    const data = (await response.json()) as ExplorerAggregateResponse;
    const rows = Array.isArray(data?.transactions_by_address)
      ? data.transactions_by_address
      : [];
    const entries = rows
      .filter((row) => !!row.TxHash)
      .map((row) => toEntry(row, chainId));
    const totalCount =
      typeof data?.transactions_count === "number" &&
      data.transactions_count >= 0
        ? data.transactions_count
        : entries.length;
    return { entries, totalCount };
  } catch {
    return emptyPage();
  }
}
