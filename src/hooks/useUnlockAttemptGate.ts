import { useEffect, useState } from "react";
import type { PasswordCheckResult } from "@/stores/lockStore";
import {
  clearUnlockAttempts,
  getUnlockAttemptState,
  recordFailedUnlockAttempt,
} from "@/utilities/unlockAttemptLimiter";

export type UnlockAttemptGate = {
  /** True while an exponential delay from repeated wrong passwords is in
   * effect. Callers should disable their password field/submit control and
   * skip calling the password check while this is true. */
  isWaiting: boolean;
  /** Seconds remaining until the next attempt is allowed (0 when not
   * waiting), for a "try again in Ns" message. */
  remainingSeconds: number;
  /**
   * Records the outcome of a password check (unlock() or changePassword()):
   * a confirmed wrong password counts against the limiter and may start or
   * extend a wait, success clears the counter, and an inconclusive "failed"
   * outcome (an unreachable service worker, an infrastructure failure)
   * leaves the counter untouched, so a correct password can never earn a
   * lockout. Returns the resulting waitUntil epoch ms (0 if none), so the
   * caller can choose between the plain wrong-password message and the
   * too-many-attempts one for this same submission.
   */
  recordResult: (result: PasswordCheckResult) => Promise<number>;
  /**
   * Re-reads the persisted counter from storage.local and refreshes
   * isWaiting/remainingSeconds from it. The mount-time read alone goes
   * stale the moment a concurrently open surface (e.g. the popup and a
   * side panel open at once) records a failed attempt of its own; gated
   * onSubmit handlers should call this first, before checking isWaiting,
   * so every surface honours the same wait (R2). Returns whether a wait is
   * now in effect.
   */
  refreshWait: () => Promise<boolean>;
};

/**
 * Shared F7 gate-check/record/clear trio for every password oracle in the
 * extension (the lock screen, the inline SessionPasswordPrompt re-arm, and
 * Settings' change-password dialog): one persisted counter in
 * storage.local, one exponential delay curve, one place that decides which
 * PasswordCheckResult outcomes count against it.
 */
export function useUnlockAttemptGate(): UnlockAttemptGate {
  const [waitUntil, setWaitUntil] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getUnlockAttemptState().then((state) => {
      if (!cancelled) setWaitUntil(state.waitUntil);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const computeRemaining = () =>
      Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

    setRemainingSeconds(computeRemaining());
    if (waitUntil <= Date.now()) return;

    // Self-clearing: the interval cancels itself the moment the countdown
    // reaches zero, instead of continuing to tick every 250ms until the
    // component unmounts or waitUntil changes again (N10).
    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [waitUntil]);

  const recordResult = async (result: PasswordCheckResult): Promise<number> => {
    if (result === "wrong-password") {
      const state = await recordFailedUnlockAttempt();
      setWaitUntil(state.waitUntil);
      return state.waitUntil;
    }
    if (result === "success") {
      await clearUnlockAttempts();
      setWaitUntil(0);
      return 0;
    }
    // "failed": leave the counter untouched.
    return waitUntil;
  };

  const refreshWait = async (): Promise<boolean> => {
    const state = await getUnlockAttemptState();
    setWaitUntil(state.waitUntil);
    return state.waitUntil > Date.now();
  };

  return {
    isWaiting: remainingSeconds > 0,
    remainingSeconds,
    recordResult,
    refreshWait,
  };
}
