import { isRecord } from "@/utilities/storageGuards";

export const isLockState = (
  value: unknown,
): value is { isLocked: boolean; hasPasswordSet: boolean } =>
  isRecord(value) &&
  typeof value.isLocked === "boolean" &&
  typeof value.hasPasswordSet === "boolean";
