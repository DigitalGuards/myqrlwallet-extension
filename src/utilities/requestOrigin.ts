// dApp requests come from web pages, so a requester origin is an http: or
// https: origin. The content script runs on every URL, but nothing else can
// own a grant: extension pages talk to the worker by runtime message.
const REQUESTER_ORIGIN_SCHEMES: ReadonlySet<string> = new Set([
  "http:",
  "https:",
]);

/**
 * The origin a dApp request or tab is attributed to, or undefined when the
 * URL has no origin the wallet may key a grant on.
 *
 * The decision is made on the computed origin, so a URL that wraps another
 * one (blob:, filesystem:) is judged by the origin it serializes to. Opaque
 * origins (sandboxed frames, data: and about: documents) serialize as
 * "null". A local file has no origin of its own either, but Chromium
 * serializes every file: URL, and every blob: or filesystem: URL wrapping
 * one, as "file://", so a grant keyed on it would be shared by every local
 * file. Both fail closed, as does any origin that is not http: or https:.
 * Every place that derives a requester origin goes through this function.
 */
export const toRequestOrigin = (
  url: string | undefined | null,
): string | undefined => {
  if (!url) return undefined;
  try {
    const { origin } = new URL(url);
    if (origin === "null" || origin === "file://") return undefined;
    return REQUESTER_ORIGIN_SCHEMES.has(new URL(origin).protocol)
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
};
