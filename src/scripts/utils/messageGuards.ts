import type { TransactionNotificationData } from "./transactionNotification";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNamedMessage = (
  value: unknown,
): value is { name: string; data?: unknown } =>
  isRecord(value) && typeof value.name === "string";

export const isTransactionNotificationData = (
  value: unknown,
): value is TransactionNotificationData =>
  isRecord(value) &&
  (value.status === undefined || typeof value.status === "string") &&
  (value.amount === undefined ||
    typeof value.amount === "string" ||
    typeof value.amount === "number") &&
  (value.tokenSymbol === undefined || typeof value.tokenSymbol === "string") &&
  (value.txHash === undefined || typeof value.txHash === "string");
