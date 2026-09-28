import type { TFunction } from "i18next";

// Chrome's own message-passing errors when the service worker is between
// wake-ups (or was just terminated mid-request). They carry no useful
// detail for a user and are always transient - the next attempt normally
// just works once the worker wakes back up.
const TRANSIENT_CONNECTION_PATTERNS = [
  "Receiving end does not exist",
  "Could not establish connection",
  "The message port closed before a response was received",
];

/**
 * Turns a caught error into user-facing copy. Chrome's transient
 * connection-drop errors get one friendly, translated message (R1); any
 * other Error surfaces its own message as-is, matching the N7 precedent of
 * keeping specific error text visible for anything more actionable than a
 * transient connection drop; anything that is not an Error at all falls
 * back to the caller-supplied default.
 */
export function describeExtensionError(
  error: unknown,
  t: TFunction,
  fallback: string,
): string {
  const message = error instanceof Error ? error.message : "";
  if (
    TRANSIENT_CONNECTION_PATTERNS.some((pattern) => message.includes(pattern))
  ) {
    return t("account.transientConnectionError");
  }
  return message || fallback;
}
