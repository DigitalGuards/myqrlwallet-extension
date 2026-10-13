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
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with a TimeoutError instance so callers can distinguish it from the promise's own error", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<string>(() => {});
      const result = withTimeout(neverSettles, 1000, "The call");
      const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
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

  it("clears the timer and preserves the original rejection", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("RPC failed");
      await expect(
        withTimeout(Promise.reject(failure), 1000, "The call"),
      ).rejects.toBe(failure);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles an operation rejection after its deadline", async () => {
    vi.useFakeTimers();
    try {
      let rejectOperation: (error: Error) => void = () => {
        throw new Error("Operation promise was not initialized");
      };
      const operation = new Promise<string>((_resolve, reject) => {
        rejectOperation = reject;
      });
      const result = withTimeout(operation, 1000, "The call");
      const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      rejectOperation(new Error("Late rejection"));
      await vi.runAllTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
