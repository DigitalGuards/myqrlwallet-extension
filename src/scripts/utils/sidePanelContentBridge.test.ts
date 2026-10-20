import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import { handleSidePanelOpenRequest } from "./sidePanelContentBridge";

const sendMessage = vi.spyOn(browser.runtime, "sendMessage");

const request = (nonce: unknown = "nonce-1") => ({
  name: EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL,
  nonce,
});

const setUserActivation = (isActive: boolean | undefined) => {
  Object.defineProperty(navigator, "userActivation", {
    value: isActive === undefined ? undefined : { isActive },
    configurable: true,
  });
};

describe("handleSidePanelOpenRequest", () => {
  beforeEach(() => {
    setUserActivation(true);
    sendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setUserActivation(undefined);
  });

  it("forwards the gesture from the frame that holds it", () => {
    expect(handleSidePanelOpenRequest(request(), { id: "mock-id" })).toBe(true);

    expect(sendMessage).toHaveBeenCalledWith({
      name: EXTENSION_MESSAGES.OPEN_SIDE_PANEL,
      nonce: "nonce-1",
    });
  });

  it("stays silent in frames without an active user gesture", () => {
    setUserActivation(false);

    expect(handleSidePanelOpenRequest(request(), { id: "mock-id" })).toBe(
      false,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stays silent where userActivation is unavailable", () => {
    setUserActivation(undefined);

    expect(handleSidePanelOpenRequest(request(), { id: "mock-id" })).toBe(
      false,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores a request from another extension", () => {
    expect(handleSidePanelOpenRequest(request(), { id: "other" })).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", () => {
    expect(handleSidePanelOpenRequest(null)).toBe(false);
    expect(handleSidePanelOpenRequest({ name: "SOMETHING_ELSE" })).toBe(false);
    expect(handleSidePanelOpenRequest(request(42))).toBe(false);
    expect(handleSidePanelOpenRequest(request(""))).toBe(false);
    expect(handleSidePanelOpenRequest(Object.assign([], request()))).toBe(
      false,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([null, {}, { isActive: "true" }, { isActive: 1 }])(
    "requires a boolean active gesture (%j)",
    (activation) => {
      Object.defineProperty(navigator, "userActivation", {
        value: activation,
        configurable: true,
      });

      expect(handleSidePanelOpenRequest(request(), { id: "mock-id" })).toBe(
        false,
      );
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it("swallows a send failure so the worker can fall back", () => {
    sendMessage.mockRejectedValue(new Error("no receiving end"));

    expect(() =>
      handleSidePanelOpenRequest(request(), { id: "mock-id" }),
    ).not.toThrow();
  });
});
