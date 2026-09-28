import { describe, expect, it } from "vitest";
import { capSimulationTimeoutMs, floorBroadcastTimeoutMs } from "./sendBudget";

describe("capSimulationTimeoutMs", () => {
  it("returns the remaining time when it is under the cap", () => {
    expect(capSimulationTimeoutMs(10_000, 15_000)).toBe(10_000);
  });

  it("clamps to the cap when the remaining time exceeds it", () => {
    expect(capSimulationTimeoutMs(30_000, 15_000)).toBe(15_000);
  });

  it("clamps a negative remaining time to zero rather than the cap", () => {
    expect(capSimulationTimeoutMs(-5_000, 15_000)).toBe(0);
  });

  it("returns exactly the cap when the remaining time equals it", () => {
    expect(capSimulationTimeoutMs(15_000, 15_000)).toBe(15_000);
  });
});

describe("floorBroadcastTimeoutMs", () => {
  it("returns the remaining time when it is above the floor", () => {
    expect(floorBroadcastTimeoutMs(15_000, 5_000)).toBe(15_000);
  });

  it("raises a remaining time under the floor up to the floor", () => {
    expect(floorBroadcastTimeoutMs(2_000, 5_000)).toBe(5_000);
  });

  it("raises a negative remaining time (an already-passed deadline) up to the floor", () => {
    expect(floorBroadcastTimeoutMs(-1_000, 5_000)).toBe(5_000);
  });

  it("returns exactly the floor when the remaining time equals it", () => {
    expect(floorBroadcastTimeoutMs(5_000, 5_000)).toBe(5_000);
  });
});
