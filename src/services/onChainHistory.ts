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

// One row of the aggregate's internal-transactions list: value moved by
// contract code (nested call frames), indexed by the explorer since
// zondscan #162. Field names are capitalized by the handler.
type ExplorerAggregateInternalTx = {
  Type?: string;
  From?: string;
  To?: string;
  Hash?: string;
  /** QRL units as a JSON number (the explorer's legacy float schema). */
  Value?: number;
  /** Block timestamp, hex seconds ("0x6a5275c4"). */
  BlockTimestamp?: string;
  TraceAddress?: number[] | null;
};

type ExplorerAggregateResponse = {
  transactions_by_address?: ExplorerAggregateTx[] | null;
  transactions_count?: number;
  internal_transactions_by_address?: ExplorerAggregateInternalTx[] | null;
  internal_transactions_count?: number;
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

const ensureHexPrefix = (hash: string): string =>
  hash.startsWith("0x") ? hash : `0x${hash}`;

const toInternalEntry = (
  row: ExplorerAggregateInternalTx,
  chainId: string,
): TransactionHistoryEntry => {
  const timestampSeconds = parseInt(row.BlockTimestamp ?? "", 16);
  const txHash = ensureHexPrefix(row.Hash ?? "");
  const trace = Array.isArray(row.TraceAddress)
    ? row.TraceAddress.join(".")
    : "";
  return {
    // The outer transaction may appear as its own entry with the same
    // hash, so internal entries need a distinct id (hash + tree position).
    id: `${txHash}-internal-${trace}`,
    from: row.From ?? "",
    to: row.To ?? "",
    amount:
      typeof row.Value === "number" && Number.isFinite(row.Value)
        ? row.Value
        : 0,
    tokenSymbol: NATIVE_TOKEN.symbol,
    tokenName: NATIVE_TOKEN.name,
    isZrc20Token: false,
    tokenContractAddress: "",
    tokenDecimals: NATIVE_TOKEN.decimals,
    transactionHash: txHash,
    blockNumber: "",
    gasUsed: "",
    effectiveGasPrice: "",
    // The fee lives on the outer transaction, not the payout frame.
    paidFeesQrl: "0",
    status: true,
    timestamp: Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : 0,
    chainId,
    isInternal: true,
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
    const txEntries = rows
      .filter((row) => !!row.TxHash)
      .map((row) => toEntry(row, chainId));

    // Internal transactions ride along in the same response, one page of
    // each list per request. They surface value received via contract
    // code (HTLC claims, withdrawals) that the outer transaction hides.
    const internalRows = Array.isArray(data?.internal_transactions_by_address)
      ? data.internal_transactions_by_address
      : [];
    const internalEntries = internalRows
      .filter((row) => !!row.Hash)
      .map((row) => toInternalEntry(row, chainId));

    const countOr = (value: unknown, fallback: number): number =>
      typeof value === "number" && value >= 0 ? value : fallback;
    // Both lists paginate together; keep fetching pages until the longer
    // one is exhausted.
    const totalCount = Math.max(
      countOr(data?.transactions_count, txEntries.length),
      countOr(data?.internal_transactions_count, internalEntries.length),
    );
    return { entries: [...txEntries, ...internalEntries], totalCount };
  } catch {
    return emptyPage();
  }
}
