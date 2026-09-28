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

// The service worker's own guard, thrown by LockManager.getDecryptedKeys()
// when it has nothing in memory to hand over: the wallet is genuinely
// locked, whether or not the calling surface's own isLocked belief has
// caught up yet (L4, PR #71 audit). A signing flow that hits this needs its
// own translated copy: this raw English guard text is for the SW console.
const WALLET_LOCKED_MESSAGE = "MyQRLWallet is locked";

export function isWalletLockedError(error: unknown): boolean {
  return error instanceof Error && error.message === WALLET_LOCKED_MESSAGE;
}

/**
 * Turns a caught error into user-facing copy. The wallet-locked guard above
 * and Chrome's transient connection-drop errors each get their own
 * friendly, translated message (L4, R1); any other Error surfaces its own
 * message as-is, matching the N7 precedent of keeping specific error text
 * visible for anything more actionable than those two cases; anything that
 * is not an Error at all falls back to the caller-supplied default.
 */
export function describeExtensionError(
  error: unknown,
  t: TFunction,
  fallback: string,
): string {
  if (isWalletLockedError(error)) {
    return t("account.walletLockedError");
  }
  const message = error instanceof Error ? error.message : "";
  if (
    TRANSIENT_CONNECTION_PATTERNS.some((pattern) => message.includes(pattern))
  ) {
    return t("account.transientConnectionError");
  }
  return message || fallback;
}
