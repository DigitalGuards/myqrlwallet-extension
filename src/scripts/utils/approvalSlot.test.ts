import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_ORIGIN_COOLDOWN_MS,
  APPROVAL_REFUSAL_GRACE,
  APPROVAL_REFUSAL_WINDOW_MS,
  claimApprovalSlot,
  getPendingApproval,
  releaseApprovalSlot,
  resetApprovalSlot,
} from "./approvalSlot";

const ORIGIN_A = "https://a.example";
const ORIGIN_B = "https://b.example";

describe("approvalSlot", () => {
  beforeEach(() => {
    resetApprovalSlot();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetApprovalSlot();
  });

  it("hands the slot to the first claim and refuses every later one", () => {
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
    expect(claimApprovalSlot(ORIGIN_B, 2)).toEqual({
      claimed: false,
      reason: "pending",
      pendingTabId: 1,
    });
  });

  it("refuses a second claim from the very same origin and tab", () => {
    claimApprovalSlot(ORIGIN_A, 1);
    const second = claimApprovalSlot(ORIGIN_A, 1);
    expect(second.claimed).toBe(false);
  });

  it("reports the tab that owns the pending request", () => {
    claimApprovalSlot(ORIGIN_A, 42);
    expect(getPendingApproval()).toEqual({ origin: ORIGIN_A, tabId: 42 });
    const refused = claimApprovalSlot(ORIGIN_B, 7);
    expect(refused).toMatchObject({ reason: "pending", pendingTabId: 42 });
  });

  it("frees the slot on release", () => {
    claimApprovalSlot(ORIGIN_A, 1);
    releaseApprovalSlot();
    expect(getPendingApproval()).toBeUndefined();
    expect(claimApprovalSlot(ORIGIN_B, 2)).toEqual({ claimed: true });
  });

  it("leaves an approved origin free to ask again at once", () => {
    claimApprovalSlot(ORIGIN_A, 1);
    releaseApprovalSlot({ startCooldown: false });
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });

  const refuse = (origin: string, times: number) => {
    for (let attempt = 0; attempt < times; attempt += 1) {
      claimApprovalSlot(origin, 1);
      releaseApprovalSlot({ startCooldown: true });
    }
  };

  it("lets a site ask again right after the first refusals", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });

  it("puts a repeatedly refused origin in cooldown so it cannot re-arm the slot", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);

    const blocked = claimApprovalSlot(ORIGIN_A, 1);
    expect(blocked.claimed).toBe(false);
    expect(blocked).toMatchObject({ reason: "cooldown" });

    // Other sites keep working while one origin is backing off.
    expect(claimApprovalSlot(ORIGIN_B, 2)).toEqual({ claimed: true });
  });

  it("lets the origin back in once the cooldown has elapsed", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    expect(claimApprovalSlot(ORIGIN_A, 1).claimed).toBe(false);

    vi.advanceTimersByTime(APPROVAL_ORIGIN_COOLDOWN_MS + 1);
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });

  it("reports how long the cooldown still has to run", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    vi.advanceTimersByTime(1_000);

    const blocked = claimApprovalSlot(ORIGIN_A, 1);
    if (blocked.claimed) throw new Error("expected a cooldown refusal");
    if (blocked.reason !== "cooldown") throw new Error("expected a cooldown");
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(
      APPROVAL_ORIGIN_COOLDOWN_MS - 1_000,
    );
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("reports pending ahead of cooldown when both apply", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    claimApprovalSlot(ORIGIN_B, 2);

    expect(claimApprovalSlot(ORIGIN_A, 1)).toMatchObject({
      reason: "pending",
      pendingTabId: 2,
    });
  });

  it("clears the refusal streak once the user approves something", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    claimApprovalSlot(ORIGIN_A, 1);
    releaseApprovalSlot({ startCooldown: false });

    // The streak restarts, so the next refusals are free again.
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });

  it("forgets a refusal streak that has gone quiet", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    vi.advanceTimersByTime(APPROVAL_REFUSAL_WINDOW_MS + 1);

    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });

  it("does nothing on a release with no slot held", () => {
    expect(() => releaseApprovalSlot({ startCooldown: true })).not.toThrow();
    expect(claimApprovalSlot(ORIGIN_A, 1)).toEqual({ claimed: true });
  });
});
