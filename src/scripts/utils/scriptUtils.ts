import browser from "webextension-polyfill";
import { getStorageRecord, isRecord } from "@/utilities/storageGuards";

const isErrorWithStack = (
  value: unknown,
): value is { message: string; stack: string } =>
  isRecord(value) &&
  typeof value.stack === "string" &&
  value.stack.length > 0 &&
  typeof value.message === "string" &&
  value.message.length > 0;

/**
 * Returns an Error if extension.runtime.lastError is present
 * this is a workaround for the non-standard error object that's used
 *
 * According to the docs, we are expected to check lastError in runtime API callbacks:
 * "
 * If you call an asynchronous function that may set lastError, you are expected to
 * check for the error when you handle the result of the function. If lastError has been
 * set and you don't check it within the callback function, then an error will be raised.
 * "
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/lastError}
 */
export function checkForLastError() {
  const lastError: unknown = browser.runtime.lastError;
  if (!lastError) {
    return undefined;
  }

  if (isErrorWithStack(lastError)) {
    return lastError;
  }
  // repair incomplete error object (eg chromium v77)
  const { message } = getStorageRecord(lastError);
  return new Error(typeof message === "string" ? message : undefined);
}

/**
 * Strips internal fields (notably `stack`) from an error before it is forwarded
 * to a dApp. Preserves the JSON-RPC-relevant fields `code`, `message`, and
 * `data`. Stack traces leak bundled-library file hashes that fingerprint the
 * exact `@theqrl/zond-wallet-provider` version (P-7b).
 */
function sanitizeError(error: unknown): {
  code?: number;
  message?: string;
  data?: unknown;
} {
  const fields = getStorageRecord(error);
  return {
    ...(typeof fields.code === "number" && { code: fields.code }),
    message:
      typeof fields.message === "string" ? fields.message : String(error),
    ...(fields.data !== undefined && { data: fields.data }),
  };
}

export function getSerializableObject(jsonObject: unknown): unknown {
  if (isRecord(jsonObject) && jsonObject.error) {
    return { error: sanitizeError(jsonObject.error) };
  }
  return JSON.parse(
    JSON.stringify(jsonObject, (_: string, value: unknown) => {
      if (typeof value === "bigint") {
        return "0x".concat(value.toString(16));
      }
      return value;
    }),
  );
}
