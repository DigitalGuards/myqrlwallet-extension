import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import {
  isBoolean,
  isFiniteNumber,
  isString,
  isTransactionHistoryEntry,
} from "./storageGuards";

// Route state can outlive its sender. Validate the complete view before the
// detail screen displays it or passes its replacement fields to the signer.
export const isTransactionDetailEntry = (
  value: unknown,
): value is TransactionHistoryEntry =>
  isTransactionHistoryEntry(value) &&
  (
    [
      "id",
      "from",
      "to",
      "tokenSymbol",
      "tokenName",
      "tokenContractAddress",
      "blockNumber",
      "gasUsed",
      "effectiveGasPrice",
      "chainId",
    ] as const
  ).every((key) => isString(value[key])) &&
  (isString(value.amount) || isFiniteNumber(value.amount)) &&
  isBoolean(value.isZrc20Token) &&
  (value.tokenDecimals === null || isFiniteNumber(value.tokenDecimals)) &&
  isBoolean(value.status) &&
  isFiniteNumber(value.timestamp) &&
  (
    [
      "paidFeesQrl",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "data",
      "replacementTransactionHash",
    ] as const
  ).every((key) => value[key] === undefined || isString(value[key])) &&
  (
    ["receiptStatusVerified", "submissionRejected", "isInternal"] as const
  ).every((key) => value[key] === undefined || isBoolean(value[key])) &&
  (["nonce", "gasLimit"] as const).every(
    (key) => value[key] === undefined || isFiniteNumber(value[key]),
  ) &&
  (value.pendingStatus === undefined ||
    value.pendingStatus === "pending" ||
    value.pendingStatus === "unknown" ||
    value.pendingStatus === "confirmed" ||
    value.pendingStatus === "failed" ||
    value.pendingStatus === "replaced" ||
    value.pendingStatus === "cancelled" ||
    value.pendingStatus === "dropped") &&
  (value.replacedByAction === undefined ||
    value.replacedByAction === "speed-up" ||
    value.replacedByAction === "cancel");
