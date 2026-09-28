import { describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./withTimeout";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    await expect(
      withTimeout(Promise.resolve("done"), 1000, "The call"),
    ).resolves.toBe("done");
  });

  it("rejects with the promise's own error when it rejects before the timeout", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "The call"),
    ).rejects.toThrow("boom");
  });

  it("rejects with a labeled TimeoutError once the deadline elapses", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<string>(() => {});
      const result = withTimeout(neverSettles, 1000, "The call");
      const assertion = expect(result).rejects.toThrow(
        "The call timed out after 1000ms",
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with a TimeoutError instance so callers can distinguish it from the promise's own error", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<string>(() => {});
      const result = withTimeout(neverSettles, 1000, "The call");
      const assertion = result.catch((error) => {
        expect(error).toBeInstanceOf(TimeoutError);
      });
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer once the promise settles, so it does not fire afterwards", async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.resolve("done"), 1000, "The call");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
