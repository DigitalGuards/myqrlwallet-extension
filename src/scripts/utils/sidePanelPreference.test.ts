import { afterEach, describe, expect, it } from "vitest";
import {
  isSidePanelSupported,
  resolveSidePanelPreferred,
  SIDE_PANEL_PATH,
} from "./sidePanelPreference";

const withSidePanelApi = (present: boolean) => {
  if (present) {
    (globalThis as Record<string, unknown>).chrome = {
      sidePanel: { open: () => Promise.resolve() },
    };
  } else {
    (globalThis as Record<string, unknown>).chrome = {};
  }
};

describe("resolveSidePanelPreferred", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("defaults to the side panel when no explicit choice was made", () => {
    expect(resolveSidePanelPreferred({}, true)).toBe(true);
  });

  it("keeps the side panel for an explicit panel choice", () => {
    expect(resolveSidePanelPreferred({ sidePanelSurface: "panel" }, true)).toBe(
      true,
    );
  });

  it("respects an explicit popup choice", () => {
    expect(resolveSidePanelPreferred({ sidePanelSurface: "popup" }, true)).toBe(
      false,
    );
  });

  it("ignores the legacy sidePanelPreferred boolean", () => {
    // Older builds re-persisted this on every unrelated settings write, so a
    // stored false is not evidence of a user choice.
    expect(resolveSidePanelPreferred({ sidePanelPreferred: false }, true)).toBe(
      true,
    );
    expect(
      resolveSidePanelPreferred(
        { sidePanelPreferred: false, sidePanelSurface: "popup" },
        true,
      ),
    ).toBe(false);
  });

  it("is false on browsers without the side panel API", () => {
    expect(resolveSidePanelPreferred({}, false)).toBe(false);
    expect(
      resolveSidePanelPreferred({ sidePanelSurface: "panel" }, false),
    ).toBe(false);
  });

  it("detects API support from the chrome namespace", () => {
    withSidePanelApi(true);
    expect(isSidePanelSupported()).toBe(true);
    expect(resolveSidePanelPreferred({})).toBe(true);

    withSidePanelApi(false);
    expect(isSidePanelSupported()).toBe(false);
    expect(resolveSidePanelPreferred({})).toBe(false);
  });

  it("marks the panel document so the UI can classify the surface", () => {
    expect(SIDE_PANEL_PATH).toBe("index.html?sidepanel=true");
  });
});
