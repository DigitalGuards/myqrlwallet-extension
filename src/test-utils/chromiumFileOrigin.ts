import { vi } from "vitest";

/**
 * jsdom and Node serialize the origin of a file: URL as "null". Chromium,
 * where the wallet runs, serializes it as "file://": location.origin,
 * new URL(...).origin and runtime.MessageSender.origin all report that one
 * value for every local file, and so do blob: and filesystem: URLs that wrap
 * a local file. Chromium also derives the origin of a filesystem: URL from
 * the URL it wraps, which Node does not. Tests that feed such a sender call
 * this so the code sees what it sees in Chromium. Undo with
 * vi.unstubAllGlobals().
 */
export const useChromiumFileOrigins = (): void => {
  const NativeURL = globalThis.URL;
  const chromiumOrigin = (url: URL): string => {
    if (url.protocol === "file:") return "file://";
    if (url.protocol === "blob:" || url.protocol === "filesystem:") {
      try {
        return chromiumOrigin(new NativeURL(url.pathname));
      } catch {
        return "null";
      }
    }
    return url.origin;
  };
  class ChromiumURL extends NativeURL {
    override get origin(): string {
      return chromiumOrigin(new NativeURL(this.href));
    }
  }
  vi.stubGlobal("URL", ChromiumURL);
};
