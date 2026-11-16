import { knownSwapEscrow } from "@/configuration/knownSwapEscrows";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";

/**
 * Whether a history entry is an outgoing call to a contract.
 *
 * Entries this wallet sent carry their call data. The explorer's aggregate
 * rows carry none, so an explorer-sourced entry counts as a contract call
 * only when it goes to a swap escrow pinned in the wallet. Token and NFT
 * rows keep their own labels, and internal entries are value that contract
 * code moved.
 */
export const isContractCallEntry = (
  entry: Pick<
    TransactionHistoryEntry,
    | "data"
    | "to"
    | "chainId"
    | "isInternal"
    | "isZrc20Token"
    | "tokenContractAddress"
  >,
): boolean => {
  if (entry.isInternal === true) return false;
  // A deployment has no recipient: its init code is not a call.
  if (entry.to === "") return false;
  if (entry.isZrc20Token || entry.tokenContractAddress !== "") return false;
  const data = entry.data ?? "";
  if (data !== "" && data !== "0x") return true;
  return knownSwapEscrow(entry.chainId, entry.to) !== undefined;
};

/**
 * A contract call whose receipt shows the chain rolled it back. Only a
 * verified receipt counts: a call the node refused before it was mined
 * never ran and is a plain failure.
 */
export const isRolledBackContractCall = (
  entry: Pick<
    TransactionHistoryEntry,
    | "data"
    | "to"
    | "chainId"
    | "isInternal"
    | "isZrc20Token"
    | "tokenContractAddress"
    | "status"
    | "pendingStatus"
    | "receiptStatusVerified"
  >,
): boolean =>
  isContractCallEntry(entry) &&
  entry.receiptStatusVerified === true &&
  (entry.pendingStatus ?? (entry.status ? "confirmed" : "failed")) === "failed";

/**
 * A native entry whose receipt shows it failed on chain. The chain moves no
 * value for it: only the fee was spent. A token row, an internal entry and a
 * transaction the node refused before mining (no verified receipt) are left
 * out.
 */
export const isFailedOnChainWithoutTransfer = (
  entry: Pick<
    TransactionHistoryEntry,
    | "isInternal"
    | "isZrc20Token"
    | "status"
    | "pendingStatus"
    | "receiptStatusVerified"
  >,
): boolean =>
  entry.isInternal !== true &&
  !entry.isZrc20Token &&
  entry.receiptStatusVerified === true &&
  (entry.pendingStatus ?? (entry.status ? "confirmed" : "failed")) === "failed";
