import type { TransactionHistoryEntry } from "@/types/transactionHistory";

function receiptHash(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return "";
}

export function needsReceipt(entry: TransactionHistoryEntry): boolean {
  return (
    entry.pendingStatus === "pending" ||
    entry.pendingStatus === "unknown" ||
    (entry.pendingStatus === "failed" &&
      !entry.blockNumber &&
      !entry.submissionRejected)
  );
}

/** Only a receipt proves execution failed. Observation errors remain reconcilable. */
export function transactionFailureUpdate(
  error: unknown,
  transactionHash?: string,
): Partial<TransactionHistoryEntry> {
  if (error && typeof error === "object" && "receipt" in error) {
    const receipt = error.receipt;
    if (
      receipt &&
      typeof receipt === "object" &&
      "status" in receipt &&
      "blockNumber" in receipt &&
      receipt.blockNumber != null &&
      transactionHash &&
      "transactionHash" in receipt &&
      receiptHash(receipt.transactionHash) === transactionHash.toLowerCase()
    ) {
      const status = String(receipt.status);
      if (["0", "0x0", "false", "1", "0x1", "true"].includes(status)) {
        const succeeded = ["1", "0x1", "true"].includes(status);
        return {
          pendingStatus: succeeded ? "confirmed" : "failed",
          status: succeeded,
          receiptStatusVerified: true,
          blockNumber: String(receipt.blockNumber),
          gasUsed: "gasUsed" in receipt ? String(receipt.gasUsed) : "",
          effectiveGasPrice:
            "effectiveGasPrice" in receipt
              ? String(receipt.effectiveGasPrice)
              : "",
        };
      }
    }
  }
  if (error && typeof error === "object") {
    const rpcError =
      "innerError" in error &&
      error.innerError &&
      typeof error.innerError === "object"
        ? error.innerError
        : error;
    // These JSON-RPC codes explicitly reject the request or transaction.
    if (
      "code" in rpcError &&
      [-32600, -32601, -32602, -32003].includes(Number(rpcError.code))
    ) {
      return {
        pendingStatus: "failed",
        status: false,
        submissionRejected: true,
      };
    }
  }
  return { pendingStatus: "unknown", status: false };
}
