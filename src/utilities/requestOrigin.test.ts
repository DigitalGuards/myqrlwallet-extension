import { afterEach, describe, expect, it, vi } from "vitest";
import { useChromiumFileOrigins } from "@/test-utils/chromiumFileOrigin";
import { toRequestOrigin } from "./requestOrigin";

describe("toRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The value stored grants are keyed on. These must stay byte-identical to
  // what new URL(url).origin gave before the helper existed.
  it.each([
    ["https://dapp.example/path?q=1", "https://dapp.example"],
    ["https://dapp.example", "https://dapp.example"],
    ["https://dapp.example:8443/app", "https://dapp.example:8443"],
    ["https://dapp.example:443/app", "https://dapp.example"],
    ["http://localhost:5173/app", "http://localhost:5173"],
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080"],
    ["https://bücher.example/shop", "https://xn--bcher-kva.example"],
    ["https://xn--bcher-kva.example/shop", "https://xn--bcher-kva.example"],
    ["https://dapp.example./", "https://dapp.example."],
    ["blob:https://dapp.example/1234", "https://dapp.example"],
  ])("keeps the origin of %s", (url, origin) => {
    expect(toRequestOrigin(url)).toBe(origin);
    expect(toRequestOrigin(url)).toBe(new URL(url).origin);
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
    "chrome-extension://abcdefghijklmnop/index.html",
    "chrome://newtab/",
    "ws://dapp.example/socket",
    "ftp://dapp.example/file",
  ])("finds no origin for %s", (url) => {
    expect(toRequestOrigin(url)).toBeUndefined();
  });

  // jsdom and Node report "null" for a file: URL; Chromium reports
  // "file://" for every local file, as both a page origin and a sender
  // origin, and for blob: and filesystem: URLs that wrap one. Feed that
  // form so the rule is tested as it runs.
  it.each([
    "file://",
    "file:///home/user/dapp.html",
    "file:///tmp/other.html",
    "blob:file:///6f1c2b9e-1111-4222-8333-944455556666",
    "filesystem:file:///temporary/dapp.html",
  ])("finds no origin for %s in the form Chromium reports", (url) => {
    useChromiumFileOrigins();
    expect(new URL(url).origin).toBe("file://");

    expect(toRequestOrigin(url)).toBeUndefined();
  });

  it("keeps a web origin wrapped in filesystem: in the form Chromium reports", () => {
    useChromiumFileOrigins();
    expect(toRequestOrigin("filesystem:https://dapp.example/temporary/a")).toBe(
      "https://dapp.example",
    );
  });
});
