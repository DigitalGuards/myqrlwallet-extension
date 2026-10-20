import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnlockAttempts,
  getUnlockAttemptState,
  recordFailedUnlockAttempt,
} from "@/utilities/unlockAttemptLimiter";
import { useUnlockAttemptGate } from "./useUnlockAttemptGate";

vi.mock("@/utilities/unlockAttemptLimiter", () => ({
  clearUnlockAttempts: vi.fn(),
  getUnlockAttemptState: vi.fn(),
  recordFailedUnlockAttempt: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getUnlockAttemptState).mockReset().mockResolvedValue({
    failedAttempts: 0,
    waitUntil: 0,
  });
  vi.mocked(clearUnlockAttempts).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordFailedUnlockAttempt).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("unlock attempt gate", () => {
  it("reports a failed mount read and allows the caller to retry it", async () => {
    const error = new Error("Storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getUnlockAttemptState).mockRejectedValueOnce(error);
    const { result } = await act(() => renderHook(useUnlockAttemptGate));

    expect(report).toHaveBeenCalledWith(
      "Failed to load unlock attempts:",
      error,
    );
    expect(result.current.isWaiting).toBe(false);
    expect(clearUnlockAttempts).not.toHaveBeenCalled();
    expect(recordFailedUnlockAttempt).not.toHaveBeenCalled();

    vi.mocked(getUnlockAttemptState).mockResolvedValueOnce({
      failedAttempts: 6,
      waitUntil: Date.now() + 5000,
    });
    await act(async () => {
      await expect(result.current.refreshWait()).resolves.toBe(true);
    });
    expect(result.current.remainingSeconds).toBe(5);
  });

  it("propagates an explicit refresh failure", async () => {
    const { result } = await act(() => renderHook(useUnlockAttemptGate));
    const error = new Error("Storage unavailable");
    vi.mocked(getUnlockAttemptState).mockRejectedValueOnce(error);
    await expect(result.current.refreshWait()).rejects.toBe(error);
  });

  it("counts down a persisted delay and clears the finished interval", async () => {
    vi.mocked(getUnlockAttemptState).mockResolvedValueOnce({
      failedAttempts: 6,
      waitUntil: Date.now() + 5000,
    });
    const { result } = await act(() => renderHook(useUnlockAttemptGate));
    expect(result.current.isWaiting).toBe(true);
    expect(result.current.remainingSeconds).toBe(5);
    expect(vi.getTimerCount()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(result.current.isWaiting).toBe(false);
    expect(result.current.remainingSeconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the interval on unmount", async () => {
    vi.mocked(getUnlockAttemptState).mockResolvedValueOnce({
      failedAttempts: 6,
      waitUntil: Date.now() + 5000,
    });
    const { unmount } = await act(() => renderHook(useUnlockAttemptGate));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a mount read that finishes after unmount", async () => {
    let finish: (state: {
      failedAttempts: number;
      waitUntil: number;
    }) => void = () => {};
    const read = new Promise<{ failedAttempts: number; waitUntil: number }>(
      (resolve) => {
        finish = resolve;
      },
    );
    vi.mocked(getUnlockAttemptState).mockReturnValueOnce(read);
    const { unmount } = renderHook(useUnlockAttemptGate);
    unmount();
    await act(async () => {
      finish({ failedAttempts: 6, waitUntil: Date.now() + 5000 });
      await read;
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records wrong passwords, preserves inconclusive outcomes and clears success", async () => {
    const { result } = await act(() => renderHook(useUnlockAttemptGate));
    const waitUntil = Date.now() + 5000;
    vi.mocked(recordFailedUnlockAttempt).mockResolvedValueOnce({
      failedAttempts: 6,
      waitUntil,
    });
    await act(async () => {
      await expect(result.current.recordResult("wrong-password")).resolves.toBe(
        waitUntil,
      );
    });
    expect(result.current.remainingSeconds).toBe(5);

    await expect(result.current.recordResult("failed")).resolves.toBe(
      waitUntil,
    );
    expect(recordFailedUnlockAttempt).toHaveBeenCalledTimes(1);
    expect(clearUnlockAttempts).not.toHaveBeenCalled();

    await act(async () => {
      await expect(result.current.recordResult("success")).resolves.toBe(0);
    });
    expect(clearUnlockAttempts).toHaveBeenCalledTimes(1);
    expect(result.current.isWaiting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
