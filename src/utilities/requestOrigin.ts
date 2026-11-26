/**
 * The origin a dApp request or tab is attributed to, or undefined when the
 * URL has no origin the wallet may key a grant on.
 *
 * Opaque origins (sandboxed frames, data: and about: documents) serialize as
 * "null". A local file has no origin of its own either, but Chromium
 * serializes every file: URL as "file://", so a grant keyed on it would be
 * shared by every local file the browser opens. Both fail closed here, and
 * every place that derives a requester origin goes through this function.
 */
export const toRequestOrigin = (
  url: string | undefined,
): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return undefined;
    const { origin } = parsed;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
};
