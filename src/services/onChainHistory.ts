import { getExplorerApiBase } from "@/configuration/assetDiscoveryConfig";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { isNullishString, isRecord, isUnknownArray } from "./explorerGuards";

/**
 * Explorer-side transaction history, same plumbing as assetDiscovery.
 * Local storage only knows transactions sent from this extension; the
 * explorer fills in everything else (received transfers, sends made from
 * other wallets on the same seed). Chains without a configured explorer
 * and every error path resolve to an empty page, so a flaky explorer
 * degrades to local-only history and keeps the screen usable.
 */

export const ON_CHAIN_PAGE_SIZE = 10;

export type OnChainHistoryPage = {
  entries: TransactionHistoryEntry[];
  totalCount: number;
  /** True when the explorer is unreachable or returns an error status or
   *  malformed response envelope. Chains without a configured explorer
   *  produce an empty successful page. */
  failed: boolean;
};

// One row of the zondscan /api/address/aggregate/:addr response,
// restricted to the fields the extension consumes.
type ExplorerAggregateTx = {
  From?: string | null;
  To?: string | null;
  TxHash: string;
  /** Block timestamp, hex seconds ("0x6a4fb2e4"). */
  TimeStamp?: string | null;
  /** Decimal string already in QRL units ("750.000000000000000000"). */
  Amount?: string | null;
  /** Decimal string already in QRL units. */
  PaidFees?: string;
  BlockNumber?: string | null;
  Status?: string | null;
};

const isExplorerAggregateTx = (value: unknown): value is ExplorerAggregateTx =>
  isRecord(value) &&
  typeof value.TxHash === "string" &&
  value.TxHash.length > 0 &&
  isNullishString(value.From) &&
  isNullishString(value.To) &&
  isNullishString(value.TimeStamp) &&
  isNullishString(value.Amount) &&
  (value.PaidFees === undefined || typeof value.PaidFees === "string") &&
  isNullishString(value.BlockNumber) &&
  isNullishString(value.Status);

// One row of the aggregate's internal-transactions list: value moved by
// contract code (nested call frames), indexed by the explorer since
// zondscan #162. Field names are capitalized by the handler.
type ExplorerAggregateInternalTx = {
  From?: string | null;
  To?: string | null;
  Hash: string;
  /** QRL units as a JSON number (the explorer's legacy float schema). */
  Value?: number | null;
  /** Block timestamp, hex seconds ("0x6a5275c4"). */
  BlockTimestamp?: string | null;
  TraceAddress?: number[] | null;
};

const isExplorerAggregateInternalTx = (
  value: unknown,
): value is ExplorerAggregateInternalTx =>
  isRecord(value) &&
  typeof value.Hash === "string" &&
  value.Hash.length > 0 &&
  isNullishString(value.From) &&
  isNullishString(value.To) &&
  isNullishString(value.BlockTimestamp) &&
  (value.Value === undefined ||
    value.Value === null ||
    typeof value.Value === "number") &&
  (value.TraceAddress === undefined ||
    value.TraceAddress === null ||
    (isUnknownArray(value.TraceAddress) &&
      value.TraceAddress.every(
        (position) =>
          typeof position === "number" &&
          Number.isSafeInteger(position) &&
          position >= 0,
      )));

const emptyPage = (failed = false): OnChainHistoryPage => ({
  entries: [],
  totalCount: 0,
  failed,
});

const toEntry = (
  row: ExplorerAggregateTx,
  chainId: string,
): TransactionHistoryEntry => {
  const amount =
    row.Amount && /^\d+(?:\.\d+)?$/.test(row.Amount) ? row.Amount : "0";
  const timestampSeconds = parseInt(row.TimeStamp ?? "", 16);
  const txHash = row.TxHash;
  return {
    id: txHash,
    from: row.From ?? "",
    to: row.To ?? "",
    amount,
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
    status: row.Status === "0x1",
    pendingStatus:
      row.Status === "0x1"
        ? "confirmed"
        : row.Status === "0x0"
          ? "failed"
          : "unknown",
    receiptStatusVerified: row.Status === "0x0" || row.Status === "0x1",
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
  const txHash = ensureHexPrefix(row.Hash);
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
    // The outer transaction carries the fee.
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
    if (!response.ok) return emptyPage(true);

    const data: unknown = await response.json();
    if (!isRecord(data)) return emptyPage(true);
    const rows = isUnknownArray(data.transactions_by_address)
      ? data.transactions_by_address
      : [];
    const txEntries = rows
      .filter(isExplorerAggregateTx)
      .map((row) => toEntry(row, chainId));

    // Internal transactions ride along in the same response, one page of
    // each list per request. They surface value received via contract
    // code (HTLC claims, withdrawals) that the outer transaction hides.
    const internalRows = isUnknownArray(data.internal_transactions_by_address)
      ? data.internal_transactions_by_address
      : [];
    const internalEntries = internalRows
      .filter(isExplorerAggregateInternalTx)
      .map((row) => toInternalEntry(row, chainId));

    const countOr = (value: unknown, fallback: number): number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : fallback;
    // Both lists paginate together; keep fetching pages until the longer
    // one is exhausted.
    const totalCount = Math.max(
      countOr(data.transactions_count, txEntries.length),
      countOr(data.internal_transactions_count, internalEntries.length),
    );
    return {
      entries: [...txEntries, ...internalEntries],
      totalCount,
      failed: false,
    };
  } catch {
    return emptyPage(true);
  }
}
