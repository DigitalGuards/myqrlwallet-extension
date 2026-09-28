/**
 * Thrown by withTimeout when its own timer fires first. Distinguished from
 * the guarded promise's own rejection (a real error the caller must still
 * see unchanged) by class, so callers can tell "this specific operation
 * never settled in time" apart from any other failure shape without
 * resorting to message matching.
 */
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Races a promise against a timer so a stuck RPC call cannot hold its caller
 * forever. The underlying promise is not cancelled: there is no abort hook
 * for the request-manager call this guards, so a late resolution after the
 * timer fires is simply ignored. The timer is always cleared, on either
 * outcome, so it cannot keep a test runner or the service worker alive.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}
