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

import { registrableDomain } from "@/utilities/registrableDomain";

/** How long an origin has to wait once it is past the refusal grace. */
export const APPROVAL_ORIGIN_COOLDOWN_MS = 5_000;

/**
 * Refusals an origin may collect back to back before the cooldown starts
 * applying. A user who rejects by accident and clicks the site's button
 * again is a normal thing to do, so the first refusals cost nothing.
 */
export const APPROVAL_REFUSAL_GRACE = 2;

/**
 * How long a refusal counts towards the streak. It has to exceed the
 * approval idle timeout, otherwise a site that simply reopens a prompt the
 * user ignores each time never builds a streak: every refusal would land
 * after the previous one had already expired.
 */
export const APPROVAL_REFUSAL_WINDOW_MS = 5 * 60_000;

/**
 * Upper bound on remembered cooldowns. Expired entries are pruned on every
 * write, so this only caps a burst of distinct origins.
 */
const MAX_TRACKED_COOLDOWNS = 100;

export type PendingApproval = {
  /** The origin of the frame that sent the request. */
  origin: string;
  /**
   * The origin of the tab that hosts it, when it differs. Content scripts
   * run in every frame, so a page can spend its cooldowns through a fresh
   * subdomain iframe each time; charging the top-level origin as well keeps
   * one page from doing that.
   */
  topLevelOrigin?: string;
  tabId?: number;
};

export type ApprovalSlotRequest = {
  origin: string;
  topLevelOrigin?: string;
  tabId?: number;
};

export type ApprovalSlotClaim =
  | { claimed: true }
  | { claimed: false; reason: "pending"; pendingTabId?: number }
  | { claimed: false; reason: "cooldown"; retryAfterMs: number };

type RefusalStreak = { count: number; lastAt: number };

/**
 * Every key a refusal is charged to, and every key a claim is checked
 * against.
 *
 * The frame origin alone is not enough: a page can host an iframe on a
 * fresh subdomain for each attempt, and each one would arrive with a clean
 * streak. The top-level origin therefore shares the charge, but only when
 * the requesting frame belongs to the same site. A third-party frame such
 * as an ad or an embedded widget answers for itself alone, so it cannot put
 * the page that embeds it into cooldown and break a dApp its visitor is
 * using.
 */
const cooldownKeys = ({
  origin,
  topLevelOrigin,
}: {
  origin: string;
  topLevelOrigin?: string;
}): string[] => {
  if (topLevelOrigin === undefined || topLevelOrigin === origin) {
    return [origin];
  }
  return isSameSite(origin, topLevelOrigin)
    ? [origin, topLevelOrigin]
    : [origin];
};

/** Whether two origins share a registrable domain. */
const isSameSite = (left: string, right: string): boolean => {
  const site = (value: string) => {
    try {
      return registrableDomain(new URL(value).hostname);
    } catch {
      return undefined;
    }
  };
  const leftSite = site(left);
  return leftSite !== undefined && leftSite === site(right);
};

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
export const claimApprovalSlot = ({
  origin,
  topLevelOrigin,
  tabId,
}: ApprovalSlotRequest): ApprovalSlotClaim => {
  if (pendingApproval !== undefined) {
    return {
      claimed: false,
      reason: "pending",
      pendingTabId: pendingApproval.tabId,
    };
  }

  const now = Date.now();
  let longestCooldown = 0;
  for (const key of cooldownKeys({ origin, topLevelOrigin })) {
    const cooldownUntil = cooldownUntilByOrigin.get(key);
    if (cooldownUntil === undefined) continue;
    if (cooldownUntil > now) {
      longestCooldown = Math.max(longestCooldown, cooldownUntil - now);
      continue;
    }
    cooldownUntilByOrigin.delete(key);
  }
  if (longestCooldown > 0) {
    return {
      claimed: false,
      reason: "cooldown",
      retryAfterMs: longestCooldown,
    };
  }

  pendingApproval = { origin, topLevelOrigin, tabId };
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
  const keys = cooldownKeys(released);
  if (!startCooldown) {
    // An approval the user granted clears the streak, so a site in regular
    // use is never throttled by refusals from earlier in the session.
    for (const key of keys) refusalStreakByOrigin.delete(key);
    return;
  }

  pruneTracking(now);
  for (const key of keys) {
    const previous = refusalStreakByOrigin.get(key);
    const withinWindow =
      previous !== undefined &&
      now - previous.lastAt <= APPROVAL_REFUSAL_WINDOW_MS;
    const count = (withinWindow ? previous.count : 0) + 1;
    refusalStreakByOrigin.set(key, { count, lastAt: now });
    if (count > APPROVAL_REFUSAL_GRACE) {
      cooldownUntilByOrigin.set(key, now + APPROVAL_ORIGIN_COOLDOWN_MS);
    }
  }
};

/** Test helper: drop the slot, every cooldown and every refusal streak. */
export const resetApprovalSlot = (): void => {
  pendingApproval = undefined;
  cooldownUntilByOrigin.clear();
  refusalStreakByOrigin.clear();
};
