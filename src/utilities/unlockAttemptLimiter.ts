import { walletLocalStorage } from "@/utilities/profileStorage";

/**
 * Failed-unlock-attempt throttling for the lock screen (F7).
 *
 * Persisted in storage.local, which survives a service-worker restart and
 * a browser relaunch: an attacker who can only try passwords across
 * separate SW wake-ups must not get a fresh budget each time. Cleared on a
 * successful unlock, and cleared implicitly by a factory reset
 * (walletLocalStorage.clear() wipes every prefixed key).
 *
 * This only ever delays retries: there is no attempt cap and no automatic
 * wipe. The seed is unrecoverable without the password either way, so a
 * wipe-on-failure policy would only turn a forgotten password into a
 * destroyed wallet faster.
 */

const FAILED_ATTEMPTS_KEY = "UNLOCK_FAILED_ATTEMPTS";

// Delay only starts after this many consecutive failures, so a normal
// mistyped password or two never shows a wait.
const ATTEMPT_THRESHOLD = 5;
// 6th failure waits 5s, 7th waits 10s, 8th waits 20s, doubling from there,
// capped at 5 minutes.
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

export type UnlockAttemptState = {
  failedAttempts: number;
  /** Epoch ms the next unlock attempt is allowed at; 0 means no wait. */
  waitUntil: number;
};

const EMPTY_STATE: UnlockAttemptState = { failedAttempts: 0, waitUntil: 0 };

export const getUnlockAttemptState = async (): Promise<UnlockAttemptState> => {
  const data = await walletLocalStorage.get(FAILED_ATTEMPTS_KEY);
  const stored = data?.[FAILED_ATTEMPTS_KEY] as UnlockAttemptState | undefined;
  if (
    !stored ||
    typeof stored.failedAttempts !== "number" ||
    typeof stored.waitUntil !== "number"
  ) {
    return { ...EMPTY_STATE };
  }
  return stored;
};

const delayForAttempt = (failedAttempts: number): number => {
  if (failedAttempts <= ATTEMPT_THRESHOLD) return 0;
  const exponent = failedAttempts - ATTEMPT_THRESHOLD - 1;
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
};

/**
 * Record a wrong-password attempt and return the resulting state, including
 * how long the caller must wait before the next attempt (0 if none yet).
 */
export const recordFailedUnlockAttempt =
  async (): Promise<UnlockAttemptState> => {
    const current = await getUnlockAttemptState();
    const failedAttempts = current.failedAttempts + 1;
    const delayMs = delayForAttempt(failedAttempts);
    const next: UnlockAttemptState = {
      failedAttempts,
      waitUntil: delayMs > 0 ? Date.now() + delayMs : 0,
    };
    await walletLocalStorage.set({ [FAILED_ATTEMPTS_KEY]: next });
    return next;
  };

/** Reset the counter after a successful unlock. */
export const clearUnlockAttempts = async (): Promise<void> => {
  await walletLocalStorage.remove(FAILED_ATTEMPTS_KEY);
};
