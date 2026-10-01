import { describe, expect, it } from "vitest";
import { isTrustedExtensionSender } from "./trustedSender";

// The mocked polyfill reports runtime.id "mock-id" and builds extension
// URLs under chrome-extension://mock-id/.
const EXTENSION_PAGE = "chrome-extension://mock-id/index.html";

describe("isTrustedExtensionSender", () => {
  it("accepts this extension's own pages", () => {
    expect(
      isTrustedExtensionSender({ id: "mock-id", url: EXTENSION_PAGE }),
    ).toBe(true);
  });

  it("accepts a side-panel or popup url with query parameters", () => {
    expect(
      isTrustedExtensionSender({
        id: "mock-id",
        url: `${EXTENSION_PAGE}?sidepanel=true`,
      }),
    ).toBe(true);
  });

  it("rejects a content script, which reports the page's own origin", () => {
    // The content script runs with this extension's id and the dApp's url,
    // so the id alone is no proof of where a message came from.
    expect(
      isTrustedExtensionSender({
        id: "mock-id",
        url: "https://dapp.example/app",
      }),
    ).toBe(false);
  });

  it("rejects another extension", () => {
    expect(
      isTrustedExtensionSender({
        id: "some-other-extension",
        url: "chrome-extension://some-other-extension/index.html",
      }),
    ).toBe(false);
  });

  it("rejects an extension url that only starts like ours", () => {
    expect(
      isTrustedExtensionSender({
        id: "mock-id",
        url: "https://evil.example/chrome-extension://mock-id/index.html",
      }),
    ).toBe(false);
  });

  it.each([
    undefined,
    {},
    { id: "mock-id" },
    { url: EXTENSION_PAGE },
    { id: 7 as unknown as string, url: EXTENSION_PAGE },
    { id: "mock-id", url: 7 as unknown as string },
  ])("rejects an incomplete sender (%s)", (sender) => {
    expect(isTrustedExtensionSender(sender)).toBe(false);
  });
});
