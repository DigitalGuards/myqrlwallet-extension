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
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}
