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
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
    expect(claimApprovalSlot({ origin: ORIGIN_B, tabId: 2 })).toEqual({
      claimed: false,
      reason: "pending",
      pendingTabId: 1,
    });
  });

  it("refuses a second claim from the very same origin and tab", () => {
    claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    const second = claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    expect(second.claimed).toBe(false);
  });

  it("reports the tab that owns the pending request", () => {
    claimApprovalSlot({ origin: ORIGIN_A, tabId: 42 });
    expect(getPendingApproval()).toEqual({ origin: ORIGIN_A, tabId: 42 });
    const refused = claimApprovalSlot({ origin: ORIGIN_B, tabId: 7 });
    expect(refused).toMatchObject({ reason: "pending", pendingTabId: 42 });
  });

  it("frees the slot on release", () => {
    claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    releaseApprovalSlot();
    expect(getPendingApproval()).toBeUndefined();
    expect(claimApprovalSlot({ origin: ORIGIN_B, tabId: 2 })).toEqual({
      claimed: true,
    });
  });

  it("leaves an approved origin free to ask again at once", () => {
    claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    releaseApprovalSlot({ startCooldown: false });
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });

  const refuse = (origin: string, times: number) => {
    for (let attempt = 0; attempt < times; attempt += 1) {
      claimApprovalSlot({ origin, tabId: 1 });
      releaseApprovalSlot({ startCooldown: true });
    }
  };

  it("lets a site ask again right after the first refusals", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });

  it("puts a repeatedly refused origin in cooldown so it cannot re-arm the slot", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);

    const blocked = claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    expect(blocked.claimed).toBe(false);
    expect(blocked).toMatchObject({ reason: "cooldown" });

    // Other sites keep working while one origin is backing off.
    expect(claimApprovalSlot({ origin: ORIGIN_B, tabId: 2 })).toEqual({
      claimed: true,
    });
  });

  it("lets the origin back in once the cooldown has elapsed", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 }).claimed).toBe(
      false,
    );

    vi.advanceTimersByTime(APPROVAL_ORIGIN_COOLDOWN_MS + 1);
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });

  it("reports how long the cooldown still has to run", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    vi.advanceTimersByTime(1_000);

    const blocked = claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    if (blocked.claimed) throw new Error("expected a cooldown refusal");
    if (blocked.reason !== "cooldown") throw new Error("expected a cooldown");
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(
      APPROVAL_ORIGIN_COOLDOWN_MS - 1_000,
    );
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("reports pending ahead of cooldown when both apply", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE + 1);
    claimApprovalSlot({ origin: ORIGIN_B, tabId: 2 });

    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toMatchObject({
      reason: "pending",
      pendingTabId: 2,
    });
  });

  it("clears the refusal streak once the user approves something", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 });
    releaseApprovalSlot({ startCooldown: false });

    // The streak restarts, so the next refusals are free again.
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });

  it("forgets a refusal streak that has gone quiet", () => {
    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    vi.advanceTimersByTime(APPROVAL_REFUSAL_WINDOW_MS + 1);

    refuse(ORIGIN_A, APPROVAL_REFUSAL_GRACE);
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });

  it("charges a refusal to the top-level origin as well (L-3)", () => {
    const TOP = "https://a.example";
    // Each attempt arrives from a fresh subdomain iframe, which would
    // otherwise bring its own clean streak every time.
    for (let attempt = 0; attempt <= APPROVAL_REFUSAL_GRACE; attempt += 1) {
      claimApprovalSlot({
        origin: `https://frame${attempt}.a.example`,
        topLevelOrigin: TOP,
        tabId: 1,
      });
      releaseApprovalSlot({ startCooldown: true });
    }

    const blocked = claimApprovalSlot({
      origin: "https://frame-next.a.example",
      topLevelOrigin: TOP,
      tabId: 1,
    });
    expect(blocked).toMatchObject({ claimed: false, reason: "cooldown" });

    // An unrelated page is unaffected.
    expect(claimApprovalSlot({ origin: ORIGIN_B, tabId: 2 })).toEqual({
      claimed: true,
    });
  });

  it("leaves the host page alone when a third-party frame is refused (L-5)", () => {
    // An ad or widget frame answers for itself. Charging the page that
    // embeds it would let any third party put a dApp its visitor is using
    // into cooldown.
    const HOST = "https://shop.example";
    for (let attempt = 0; attempt <= APPROVAL_REFUSAL_GRACE + 2; attempt += 1) {
      claimApprovalSlot({
        origin: "https://ads.third-party.example",
        topLevelOrigin: HOST,
        tabId: 1,
      });
      releaseApprovalSlot({ startCooldown: true });
    }

    expect(
      claimApprovalSlot({ origin: HOST, topLevelOrigin: HOST, tabId: 1 }),
    ).toEqual({ claimed: true });
    releaseApprovalSlot();
    // The third party itself is still in cooldown.
    expect(
      claimApprovalSlot({
        origin: "https://ads.third-party.example",
        topLevelOrigin: HOST,
        tabId: 1,
      }),
    ).toMatchObject({ claimed: false, reason: "cooldown" });
  });

  it("clears the top-level streak on an approval too (L-3)", () => {
    const TOP = "https://a.example";
    for (let attempt = 0; attempt < APPROVAL_REFUSAL_GRACE; attempt += 1) {
      claimApprovalSlot({
        origin: `https://frame${attempt}.a.example`,
        topLevelOrigin: TOP,
        tabId: 1,
      });
      releaseApprovalSlot({ startCooldown: true });
    }
    claimApprovalSlot({
      origin: "https://frame-ok.a.example",
      topLevelOrigin: TOP,
      tabId: 1,
    });
    releaseApprovalSlot({ startCooldown: false });

    for (let attempt = 0; attempt < APPROVAL_REFUSAL_GRACE; attempt += 1) {
      claimApprovalSlot({
        origin: `https://frame-b${attempt}.a.example`,
        topLevelOrigin: TOP,
        tabId: 1,
      });
      releaseApprovalSlot({ startCooldown: true });
    }
    expect(
      claimApprovalSlot({
        origin: "https://frame-b-next.a.example",
        topLevelOrigin: TOP,
        tabId: 1,
      }),
    ).toEqual({ claimed: true });
  });

  it("does nothing on a release with no slot held", () => {
    expect(() => releaseApprovalSlot({ startCooldown: true })).not.toThrow();
    expect(claimApprovalSlot({ origin: ORIGIN_A, tabId: 1 })).toEqual({
      claimed: true,
    });
  });
});
