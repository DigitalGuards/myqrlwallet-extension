import { profileStorageKey } from "@/utilities/profileStorage";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  handleApprovalWindowRemoved,
  openApprovalSurface,
} from "./approvalSurface";
import {
  handleSidePanelOpenMessage,
  resetSidePanelOpenerForTests,
} from "./sidePanelSurface";

const sidePanelOpen = vi.fn(async () => undefined);

// A browser with the side panel API but no panel currently open.
const installSidePanelApi = () => {
  (globalThis as Record<string, unknown>).chrome = {
    sidePanel: { open: sidePanelOpen },
    runtime: {
      ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
      getContexts: vi.fn(async () => []),
    },
  };
};

// Answers the pending gesture roundtrip as the requesting tab would.
const answerGestureRoundtrip = async (tabId: number) => {
  await vi.waitFor(() =>
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1),
  );
  const calls = vi.mocked(browser.tabs.sendMessage).mock.calls;
  const sent = calls[calls.length - 1]?.[1] as { name: string; nonce: string };
  handleSidePanelOpenMessage(
    { name: "QRL_WALLET_OPEN_SIDE_PANEL", nonce: sent.nonce },
    { id: "mock-id", tab: { id: tabId } } as never,
  );
};

const setSettings = (settings: object) => {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) =>
    key === profileStorageKey("SETTINGS")
      ? { [profileStorageKey("SETTINGS")]: settings }
      : {},
  );
};

describe("openApprovalSurface", () => {
  beforeEach(() => {
    // Module state (the tracked window id) persists across tests; start
    // each test with the notification window closed.
    handleApprovalWindowRemoved(77);
    resetSidePanelOpenerForTests();
    sidePanelOpen.mockClear();
    sidePanelOpen.mockResolvedValue(undefined);
    // The default browser for these cases has no side panel API, so the
    // popup path is the preferred surface.
    setSettings({ sidePanelSurface: "popup" });
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue(undefined);
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
    resetSidePanelOpenerForTests();
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

  it("does nothing when a side panel is already open", async () => {
    setSettings({});
    (globalThis as Record<string, unknown>).chrome = {
      sidePanel: { open: sidePanelOpen },
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts: vi.fn(async (filter: { contextTypes: string[] }) =>
          filter.contextTypes.includes("SIDE_PANEL")
            ? [{ contextType: "SIDE_PANEL" }]
            : [],
        ),
      },
    };

    await openApprovalSurface({ tabId: 5 });

    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(browser.action.openPopup).not.toHaveBeenCalled();
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it("opens the side panel for the requesting tab when it is preferred", async () => {
    setSettings({});
    installSidePanelApi();

    const pending = openApprovalSurface({ tabId: 5 });
    await answerGestureRoundtrip(5);
    await pending;

    expect(sidePanelOpen).toHaveBeenCalledWith({ tabId: 5 });
    expect(browser.action.openPopup).not.toHaveBeenCalled();
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it("falls back to the popup when the gesture roundtrip times out", async () => {
    setSettings({});
    installSidePanelApi();
    vi.useFakeTimers();

    const pending = openApprovalSurface({ tabId: 5 });
    await vi.advanceTimersByTimeAsync(600);
    await pending;
    vi.useRealTimers();

    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(browser.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("skips the side panel entirely for an explicit popup choice", async () => {
    setSettings({ sidePanelSurface: "popup" });
    installSidePanelApi();

    await openApprovalSurface({ tabId: 5 });

    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(browser.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("does not open a window when the action popup is already open", async () => {
    vi.mocked(browser.action.openPopup).mockRejectedValue(
      new Error("openPopup refused"),
    );
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts: vi.fn(async (filter: { contextTypes: string[] }) =>
          filter.contextTypes.includes("POPUP")
            ? [{ contextType: "POPUP" }]
            : [],
        ),
      },
    };

    await openApprovalSurface();

    expect(browser.windows.create).not.toHaveBeenCalled();
  });
});
