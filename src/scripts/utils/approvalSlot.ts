/**
 * The wallet shows one dApp approval at a time, so the service worker keeps
 * a single approval slot. This module owns that slot.
 *
 * Two properties matter and both were missing while the slot was a bare
 * `let isRequestPending = false` claimed part way through the middleware:
 *
 * 1. The claim is synchronous. The middleware used to run its permission
 *    precheck and its silent-completion check, both async, before setting
 *    the flag. Two requests arriving in the same tick therefore both saw an
 *    empty slot, both proceeded, and the second one's session-storage write
 *    replaced the first one's. The first request was then orphaned: the
 *    approval surface showed the second request, and the first dApp waited
 *    for the idle timeout. Claiming before the first await removes that
 *    window entirely.
 *
 * 2. An origin that keeps losing the slot has to back off. Without a
 *    cooldown, one page can re-arm the slot as fast as its rejections come
 *    back and no other dApp ever gets an approval through. The cooldown is
 *    short enough that a user who rejects by accident and clicks again on
 *    the page is not obstructed.
 *
 * The slot also remembers which tab the pending request came from. The
 * middleware needs that to raise the approval surface in the tab that owns
 * the request: raising it for whichever tab asked last can put site A's
 * approval prompt in the side panel next to site B's page.
 */

/** How long an origin has to wait once it is past the refusal grace. */
export const APPROVAL_ORIGIN_COOLDOWN_MS = 5_000;

/**
 * Refusals an origin may collect back to back before the cooldown starts
 * applying. A user who rejects by accident and clicks the site's button
 * again is a normal thing to do, so the first refusals cost nothing.
 */
export const APPROVAL_REFUSAL_GRACE = 2;

/**
 * How long a refusal counts towards the streak. A site the user turns down
 * once an hour is not the pattern this guards against.
 */
export const APPROVAL_REFUSAL_WINDOW_MS = 60_000;

/**
 * Upper bound on remembered cooldowns. Expired entries are pruned on every
 * write, so this only caps a burst of distinct origins.
 */
const MAX_TRACKED_COOLDOWNS = 100;

export type PendingApproval = {
  origin: string;
  tabId?: number;
};

export type ApprovalSlotClaim =
  | { claimed: true }
  | { claimed: false; reason: "pending"; pendingTabId?: number }
  | { claimed: false; reason: "cooldown"; retryAfterMs: number };

type RefusalStreak = { count: number; lastAt: number };

let pendingApproval: PendingApproval | undefined;
const cooldownUntilByOrigin = new Map<string, number>();
const refusalStreakByOrigin = new Map<string, RefusalStreak>();

const pruneTracking = (now: number) => {
  for (const [origin, until] of cooldownUntilByOrigin) {
    if (until <= now) cooldownUntilByOrigin.delete(origin);
  }
  for (const [origin, streak] of refusalStreakByOrigin) {
    if (now - streak.lastAt > APPROVAL_REFUSAL_WINDOW_MS) {
      refusalStreakByOrigin.delete(origin);
    }
  }
  while (cooldownUntilByOrigin.size >= MAX_TRACKED_COOLDOWNS) {
    const oldest = cooldownUntilByOrigin.keys().next();
    if (oldest.done) break;
    cooldownUntilByOrigin.delete(oldest.value);
  }
  while (refusalStreakByOrigin.size >= MAX_TRACKED_COOLDOWNS) {
    const oldest = refusalStreakByOrigin.keys().next();
    if (oldest.done) break;
    refusalStreakByOrigin.delete(oldest.value);
  }
};

/**
 * Take the approval slot for `origin`. Synchronous by design: callers must
 * claim before their first await.
 */
export const claimApprovalSlot = (
  origin: string,
  tabId?: number,
): ApprovalSlotClaim => {
  if (pendingApproval !== undefined) {
    return {
      claimed: false,
      reason: "pending",
      pendingTabId: pendingApproval.tabId,
    };
  }

  const now = Date.now();
  const cooldownUntil = cooldownUntilByOrigin.get(origin);
  if (cooldownUntil !== undefined) {
    if (cooldownUntil > now) {
      return {
        claimed: false,
        reason: "cooldown",
        retryAfterMs: cooldownUntil - now,
      };
    }
    cooldownUntilByOrigin.delete(origin);
  }

  pendingApproval = { origin, tabId };
  return { claimed: true };
};

/** The request currently holding the slot, if any. */
export const getPendingApproval = (): PendingApproval | undefined =>
  pendingApproval === undefined ? undefined : { ...pendingApproval };

/**
 * Give the slot back. `startCooldown` is set when the approval ended
 * without the user approving it (an explicit rejection, a closed approval
 * surface, or the idle timeout), which are the outcomes a hostile page can
 * produce over and over on its own.
 */
export const releaseApprovalSlot = ({
  startCooldown = false,
}: { startCooldown?: boolean } = {}): void => {
  const released = pendingApproval;
  pendingApproval = undefined;
  if (released === undefined) return;

  const now = Date.now();
  if (!startCooldown) {
    // An approval the user granted clears the streak, so a site in regular
    // use is never throttled by refusals from earlier in the session.
    refusalStreakByOrigin.delete(released.origin);
    return;
  }

  pruneTracking(now);
  const previous = refusalStreakByOrigin.get(released.origin);
  const withinWindow =
    previous !== undefined &&
    now - previous.lastAt <= APPROVAL_REFUSAL_WINDOW_MS;
  const count = (withinWindow ? previous.count : 0) + 1;
  refusalStreakByOrigin.set(released.origin, { count, lastAt: now });
  if (count > APPROVAL_REFUSAL_GRACE) {
    cooldownUntilByOrigin.set(
      released.origin,
      now + APPROVAL_ORIGIN_COOLDOWN_MS,
    );
  }
};

/** Test helper: drop the slot, every cooldown and every refusal streak. */
export const resetApprovalSlot = (): void => {
  pendingApproval = undefined;
  cooldownUntilByOrigin.clear();
  refusalStreakByOrigin.clear();
};
