import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  handleApprovalWindowRemoved,
  openApprovalSurface,
} from "./approvalSurface";

const setSettings = (settings: object) => {
  vi.mocked(browser.storage.local.get).mockImplementation(
    async (key) => (key === "SETTINGS" ? { SETTINGS: settings } : {}),
  );
};

describe("openApprovalSurface", () => {
  beforeEach(() => {
    // Module state (the tracked window id) persists across tests; start
    // each test with the notification window closed.
    handleApprovalWindowRemoved(77);
    setSettings({});
    vi.mocked(browser.action.openPopup).mockResolvedValue(undefined);
    vi.mocked(browser.windows.create).mockResolvedValue({
      id: 77,
    } as never);
    vi.mocked(browser.windows.update).mockResolvedValue({} as never);
    vi.mocked(browser.windows.getLastFocused).mockResolvedValue({
      left: 100,
      top: 50,
      width: 1280,
      height: 800,
    } as never);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("prefers the anchored action popup and opens no window", async () => {
    await openApprovalSurface();

    expect(browser.action.openPopup).toHaveBeenCalledTimes(1);
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it("falls back to a notification window when openPopup is refused", async () => {
    vi.mocked(browser.action.openPopup).mockRejectedValue(
      new Error("openPopup refused"),
    );

    await openApprovalSurface();

    expect(browser.windows.create).toHaveBeenCalledWith({
      url: "chrome-extension://mock-id/index.html",
      type: "popup",
      focused: true,
      width: 396,
      height: 640,
      // anchored to the top-right of the last-focused window
      left: 100 + 1280 - 396 - 16,
      top: 50 + 76,
    });
  });

  it("focuses the tracked window instead of stacking a second one", async () => {
    vi.mocked(browser.action.openPopup).mockRejectedValue(
      new Error("openPopup refused"),
    );
    await openApprovalSurface();

    await openApprovalSurface();

    expect(browser.windows.create).toHaveBeenCalledTimes(1);
    expect(browser.windows.update).toHaveBeenCalledWith(77, {
      focused: true,
      drawAttention: true,
    });
  });

  it("creates a fresh window after the tracked one was closed", async () => {
    vi.mocked(browser.action.openPopup).mockRejectedValue(
      new Error("openPopup refused"),
    );
    await openApprovalSurface();
    handleApprovalWindowRemoved(77);

    await openApprovalSurface();

    expect(browser.windows.create).toHaveBeenCalledTimes(2);
    expect(browser.windows.update).not.toHaveBeenCalled();
  });

  it("does nothing in side-panel mode", async () => {
    setSettings({ sidePanelPreferred: true });

    await openApprovalSurface();

    expect(browser.action.openPopup).not.toHaveBeenCalled();
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it("does not open a window when the action popup is already open", async () => {
    vi.mocked(browser.action.openPopup).mockRejectedValue(
      new Error("openPopup refused"),
    );
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts: vi.fn(
          async (filter: { contextTypes: string[] }) =>
            filter.contextTypes.includes("POPUP") ? [{ contextType: "POPUP" }] : [],
        ),
      },
    };

    await openApprovalSurface();

    expect(browser.windows.create).not.toHaveBeenCalled();
  });
});
