import { vi } from "vitest";

/**
 * jsdom and Node serialize the origin of a file: URL as "null". Chromium,
 * where the wallet runs, serializes it as "file://": location.origin,
 * new URL(...).origin and runtime.MessageSender.origin all report that one
 * value for every local file. Tests that feed a local-file sender call this
 * so the code sees what it sees in Chromium. Undo with vi.unstubAllGlobals().
 */
export const useChromiumFileOrigins = (): void => {
  const NativeURL = globalThis.URL;
  class ChromiumURL extends NativeURL {
    override get origin(): string {
      return this.protocol === "file:" ? "file://" : super.origin;
    }
  }
  vi.stubGlobal("URL", ChromiumURL);
};
