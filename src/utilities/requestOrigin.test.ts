import { afterEach, describe, expect, it, vi } from "vitest";
import { useChromiumFileOrigins } from "@/test-utils/chromiumFileOrigin";
import { toRequestOrigin } from "./requestOrigin";

describe("toRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["https://dapp.example/path?q=1", "https://dapp.example"],
    ["https://dapp.example", "https://dapp.example"],
    ["http://localhost:5173/app", "http://localhost:5173"],
    ["blob:https://dapp.example/1234", "https://dapp.example"],
  ])("keeps the origin of %s", (url, origin) => {
    expect(toRequestOrigin(url)).toBe(origin);
  });

  it.each([
    undefined,
    "",
    "null",
    "not a url",
    "data:text/html,hello",
    "about:blank",
    "file:///home/user/dapp.html",
    "file://",
  ])("finds no origin for %s", (url) => {
    expect(toRequestOrigin(url)).toBeUndefined();
  });

  // jsdom and Node report "null" for a file: URL; Chromium reports
  // "file://" for every local file, as both a page origin and a sender
  // origin. Feed that form so the rule is tested as it runs.
  it.each(["file://", "file:///home/user/dapp.html", "file:///tmp/other.html"])(
    "finds no origin for %s in the form Chromium reports",
    (url) => {
      useChromiumFileOrigins();
      expect(new URL("file:///tmp/a.html").origin).toBe("file://");

      expect(toRequestOrigin(url)).toBeUndefined();
    },
  );
});
