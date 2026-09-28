/**
 * Splits one shared deadline between a pre-flight simulation step and the
 * broadcast that follows it (QrlSendTransactionForContent's
 * simulate-then-broadcast flow for qrl_sendTransaction).
 *
 * Letting the broadcast get whatever the simulation happened to leave of
 * the shared budget meant a slow simulation could leave the broadcast with
 * almost no window at all (near zero once clamped), so a dApp transaction
 * would answer "may still be processing" for a broadcast that barely got
 * to run. Capping the simulation's own timeout keeps it from ever eating
 * more than its share, and flooring the broadcast's timeout keeps it
 * meaningful even if something else ate into the shared budget first. Both
 * are plain math, kept here so they are directly testable without going
 * through a real (or faked) clock.
 */

/** The simulation's own timeout: whatever remains of the shared deadline,
 *  capped so it can never claim more than `capMs` of it. */
export function capSimulationTimeoutMs(
  remainingMs: number,
  capMs: number,
): number {
  return Math.min(capMs, Math.max(remainingMs, 0));
}

/** The broadcast's own timeout: whatever remains of the shared deadline
 *  after the simulation, floored so it is never squeezed to (near) zero. */
export function floorBroadcastTimeoutMs(
  remainingMs: number,
  floorMs: number,
): number {
  return Math.max(remainingMs, floorMs);
}
