import { profileStorageKey } from "@/utilities/profileStorage";
import { isRecord } from "@/utilities/storageGuards";
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
import {
  handleSidePanelVisibilityMessage,
  resetSidePanelVisibilityForTests,
} from "./sidePanelVisibility";

const sidePanelOpen = vi.fn<() => Promise<void>>();
const sendMessage = vi.spyOn(browser.tabs, "sendMessage");
const runtimeSendMessage = vi.spyOn(browser.runtime, "sendMessage");
const openPopup = vi.spyOn(browser.action, "openPopup");
const createWindow = vi.spyOn(browser.windows, "create");
const updateWindow = vi.spyOn(browser.windows, "update");
const getLastFocused = vi.spyOn(browser.windows, "getLastFocused");
const createNotification = vi.spyOn(browser.notifications, "create");
const getTab = vi.spyOn(browser.tabs, "get");
const getLocalStorage = vi.spyOn(browser.storage.local, "get");
const windowProperties = {
  focused: true,
  incognito: false,
  alwaysOnTop: false,
};

// A browser with the side panel API but no panel currently open.
const installSidePanelApi = () => {
  vi.stubGlobal("chrome", {
    sidePanel: { open: sidePanelOpen },
    runtime: {
      ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
      getContexts: vi.fn().mockResolvedValue([]),
    },
  });
};

// Answers the pending gesture roundtrip as the requesting tab would.
const answerGestureRoundtrip = async (tabId: number) => {
  await vi.waitFor(() => {
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  const calls = sendMessage.mock.calls;
  const sent: unknown = calls[calls.length - 1]?.[1];
  if (!isRecord(sent) || typeof sent.nonce !== "string") {
    throw new Error("Expected a side panel gesture request with a nonce.");
  }
  handleSidePanelOpenMessage(
    { name: "QRL_WALLET_OPEN_SIDE_PANEL", nonce: sent.nonce },
    {
      id: "mock-id",
      tab: {
        id: tabId,
        index: 0,
        active: true,
        highlighted: true,
        pinned: false,
        incognito: false,
      },
    },
  );
};

const setSettings = (settings: object) => {
  getLocalStorage.mockImplementation((key) =>
    Promise.resolve(
      key === profileStorageKey("SETTINGS")
        ? { [profileStorageKey("SETTINGS")]: settings }
        : {},
    ),
  );
};

describe("openApprovalSurface", () => {
  beforeEach(() => {
    // Module state (the tracked window id) persists across tests; start
    // each test with the notification window closed.
    handleApprovalWindowRemoved(77);
    handleApprovalWindowRemoved(78);
    resetSidePanelOpenerForTests();
    sidePanelOpen.mockClear();
    sidePanelOpen.mockResolvedValue(undefined);
    // The default browser for these cases has no side panel API, so the
    // popup path is the preferred surface.
    setSettings({ sidePanelSurface: "popup" });
    sendMessage.mockResolvedValue(undefined);
    openPopup.mockResolvedValue(undefined);
    createWindow.mockResolvedValue({
      ...windowProperties,
      id: 77,
    });
    updateWindow.mockResolvedValue(windowProperties);
    getLastFocused.mockResolvedValue({
      ...windowProperties,
      left: 100,
      top: 50,
      width: 1280,
      height: 800,
    });
    // The requesting tab (id 5) lives in window 9.
    getTab.mockResolvedValue({
      id: 5,
      windowId: 9,
      index: 0,
      active: true,
      highlighted: true,
      pinned: false,
      incognito: false,
    });
  });

  afterEach(() => {
    resetSidePanelOpenerForTests();
    resetSidePanelVisibilityForTests();
    vi.unstubAllGlobals();
  });

  it("prefers the anchored action popup and opens no window", async () => {
    await openApprovalSurface();

    expect(openPopup).toHaveBeenCalledTimes(1);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("falls back to a notification window when openPopup is refused", async () => {
    openPopup.mockRejectedValue(new Error("openPopup refused"));

    await openApprovalSurface();

    expect(createWindow).toHaveBeenCalledWith({
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

  it("focuses the tracked window on subsequent approval requests", async () => {
    openPopup.mockRejectedValue(new Error("openPopup refused"));
    await openApprovalSurface();

    await openApprovalSurface();

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(updateWindow).toHaveBeenCalledWith(77, {
      focused: true,
      drawAttention: true,
    });
  });

  it("creates a fresh window after the tracked one was closed", async () => {
    openPopup.mockRejectedValue(new Error("openPopup refused"));
    await openApprovalSurface();
    handleApprovalWindowRemoved(77);

    await openApprovalSurface();

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(updateWindow).not.toHaveBeenCalled();
  });

  it("does nothing when a side panel is already open", async () => {
    setSettings({});
    vi.stubGlobal("chrome", {
      sidePanel: { open: sidePanelOpen },
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts: vi.fn((filter: { contextTypes: string[] }) =>
          Promise.resolve(
            filter.contextTypes.includes("SIDE_PANEL")
              ? [{ contextType: "SIDE_PANEL" }]
              : [],
          ),
        ),
      },
    });

    await openApprovalSurface({ tabId: 5 });

    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(openPopup).not.toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("opens the side panel for the requesting tab when it is preferred", async () => {
    setSettings({});
    installSidePanelApi();

    const pending = openApprovalSurface({ tabId: 5 });
    await answerGestureRoundtrip(5);
    await pending;

    expect(sidePanelOpen).toHaveBeenCalledWith({ tabId: 5 });
    expect(openPopup).not.toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
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
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it("skips the side panel entirely for an explicit popup choice", async () => {
    setSettings({ sidePanelSurface: "popup" });
    installSidePanelApi();

    await openApprovalSurface({ tabId: 5 });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it("does not open a window when the action popup is already open", async () => {
    openPopup.mockRejectedValue(new Error("openPopup refused"));
    vi.stubGlobal("chrome", {
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts: vi.fn((filter: { contextTypes: string[] }) =>
          Promise.resolve(
            filter.contextTypes.includes("POPUP")
              ? [{ contextType: "POPUP" }]
              : [],
          ),
        ),
      },
    });

    await openApprovalSurface();

    expect(createWindow).not.toHaveBeenCalled();
  });

  describe("notification window placement", () => {
    beforeEach(() => {
      openPopup.mockRejectedValue(new Error("Browser window has no toolbar."));
    });

    it("opens the window without a position when Chrome rejects the bounds", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      createWindow.mockImplementation((options) =>
        options?.left === undefined && options?.top === undefined
          ? Promise.resolve({ ...windowProperties, id: 78 })
          : Promise.reject(
              new Error(
                "Invalid value for bounds. Bounds must be at least 50% within visible screen space.",
              ),
            ),
      );

      await openApprovalSurface({ tabId: 5 });

      expect(createWindow).toHaveBeenCalledTimes(2);
      expect(createWindow).toHaveBeenLastCalledWith({
        url: "chrome-extension://mock-id/index.html",
        type: "popup",
        focused: true,
        width: 396,
        height: 640,
      });
      expect(warn).not.toHaveBeenCalled();

      // The retried window is the tracked one: the next request focuses it.
      await openApprovalSurface({ tabId: 5 });
      expect(createWindow).toHaveBeenCalledTimes(2);
      expect(updateWindow).toHaveBeenCalledWith(78, {
        focused: true,
        drawAttention: true,
      });
      warn.mockRestore();
    });

    it("never throws and warns once when no window can be opened", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cause = new Error("x");
      getLastFocused.mockRejectedValue(new Error("x"));
      createWindow.mockRejectedValue(cause);

      await expect(openApprovalSurface({ tabId: 5 })).resolves.toBeUndefined();

      expect(createWindow).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "QrlWeb3Wallet: Could not open the wallet",
        cause,
      );
      warn.mockRestore();
    });
  });

  describe("with a side panel already open", () => {
    const stubOpenContexts = (open: readonly string[]) => {
      vi.stubGlobal("chrome", {
        sidePanel: { open: sidePanelOpen },
        runtime: {
          ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
          getContexts: vi.fn((filter: { contextTypes: string[] }) =>
            Promise.resolve(
              filter.contextTypes
                .filter((type) => open.includes(type))
                .map((contextType) => ({ contextType })),
            ),
          ),
        },
      });
    };

    beforeEach(() => {
      setSettings({});
      stubOpenContexts(["SIDE_PANEL"]);
    });

    it("asks for attention behind another wallet's window and never takes focus", async () => {
      getLastFocused.mockResolvedValue({
        ...windowProperties,
        id: 12,
        type: "popup",
      });

      await openApprovalSurface({ tabId: 5 });

      expect(updateWindow).toHaveBeenCalledTimes(1);
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
      expect(openPopup).not.toHaveBeenCalled();
      expect(createWindow).not.toHaveBeenCalled();
    });

    it("asks for attention when no browser window has focus", async () => {
      getLastFocused.mockResolvedValue({
        ...windowProperties,
        id: 9,
        focused: false,
      });

      await openApprovalSurface({ tabId: 5 });

      expect(updateWindow).toHaveBeenCalledTimes(1);
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
    });

    it("leaves the windows alone when the tab's window already has focus", async () => {
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 9 });

      await openApprovalSurface({ tabId: 5 });

      expect(updateWindow).not.toHaveBeenCalled();
    });

    it("leaves the windows alone without a requesting tab", async () => {
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 12 });

      await openApprovalSurface();

      expect(getTab).not.toHaveBeenCalled();
      expect(updateWindow).not.toHaveBeenCalled();
    });

    it("never throws when the window lookups reject", async () => {
      getLastFocused.mockRejectedValue(new Error("x"));
      updateWindow.mockRejectedValue(new Error("x"));

      await expect(openApprovalSurface({ tabId: 5 })).resolves.toBeUndefined();

      expect(createWindow).not.toHaveBeenCalled();
    });
  });
  describe("with a side panel that may sit behind another extension's panel", () => {
    const panelSender = {
      id: "mock-id",
      url: "chrome-extension://mock-id/index.html?sidepanel=true",
    };

    const stubPanelLive = () => {
      vi.stubGlobal("chrome", {
        sidePanel: { open: sidePanelOpen },
        runtime: {
          ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
          getContexts: vi.fn((filter: { contextTypes: string[] }) =>
            Promise.resolve(
              filter.contextTypes.includes("SIDE_PANEL")
                ? [{ contextType: "SIDE_PANEL" }]
                : [],
            ),
          ),
        },
      });
    };

    // Plays the panel page: answers every probe the worker sends.
    const panelAnswers = (visible: boolean, windowId = 9) => {
      runtimeSendMessage.mockImplementation((message: unknown) => {
        if (
          isRecord(message) &&
          message.name === "QRL_WALLET_PROBE_SIDE_PANEL"
        ) {
          handleSidePanelVisibilityMessage(
            {
              name: "QRL_WALLET_SIDE_PANEL_VISIBILITY",
              nonce: message.nonce,
              visible,
              windowId,
            },
            panelSender,
          );
        }
        return Promise.resolve(undefined);
      });
    };

    beforeEach(() => {
      setSettings({});
      stubPanelLive();
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 12 });
    });

    afterEach(() => {
      createNotification.mockClear();
      runtimeSendMessage.mockReset();
      runtimeSendMessage.mockResolvedValue(undefined);
    });

    it("announces a hidden panel and never shows it for a page request", async () => {
      panelAnswers(false);
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 9 });

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(openPopup).not.toHaveBeenCalled();
      expect(createWindow).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it("keeps the attention request and the notification when another window has the focus", async () => {
      panelAnswers(false);
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 12 });

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
      expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it("runs no roundtrip when no browser window has the focus", async () => {
      panelAnswers(false);
      getLastFocused.mockResolvedValue({
        ...windowProperties,
        id: 9,
        focused: false,
      });

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
    });

    it("runs no roundtrip when two panels report differently", async () => {
      vi.stubGlobal("chrome", {
        sidePanel: { open: sidePanelOpen },
        runtime: {
          ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
          getContexts: vi.fn((filter: { contextTypes: string[] }) =>
            Promise.resolve(
              filter.contextTypes.includes("SIDE_PANEL")
                ? [{ contextType: "SIDE_PANEL" }, { contextType: "SIDE_PANEL" }]
                : [],
            ),
          ),
        },
      });
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 9 });
      runtimeSendMessage.mockImplementation((message: unknown) => {
        if (isRecord(message) && message.nonce !== undefined) {
          for (const visible of [false, true]) {
            handleSidePanelVisibilityMessage(
              {
                name: "QRL_WALLET_SIDE_PANEL_VISIBILITY",
                nonce: message.nonce,
                visible,
                windowId: 9,
              },
              panelSender,
            );
          }
        }
        return Promise.resolve(undefined);
      });

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("posts no notification for a repeat request of the pending approval", async () => {
      panelAnswers(false);
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 9 });
      sendMessage.mockRejectedValue(new Error("no content script"));

      await openApprovalSurface({ tabId: 5 });
      await openApprovalSurface({ tabId: 5, announce: false });
      await openApprovalSurface({ tabId: 5, announce: false });

      expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it("leaves a visible panel alone", async () => {
      panelAnswers(true);

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it("posts only the notification when a hidden panel's tab has no gesture", async () => {
      panelAnswers(false);
      getLastFocused.mockResolvedValue({ ...windowProperties, id: 9 });
      sendMessage.mockRejectedValue(new Error("no content script"));

      await openApprovalSurface({ tabId: 5 });

      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(openPopup).not.toHaveBeenCalled();
      expect(createWindow).not.toHaveBeenCalled();
      expect(updateWindow).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification).toHaveBeenCalledWith(
        "approval-waiting-9",
        expect.objectContaining({ type: "basic", title: "Approval waiting" }),
      );
    });

    it("treats a panel that stays silent as showing", async () => {
      vi.useFakeTimers();

      const pending = openApprovalSurface({ tabId: 5 });
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      vi.useRealTimers();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(updateWindow).toHaveBeenCalledWith(9, { drawAttention: true });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it("leaves a hidden panel in another window alone", async () => {
      panelAnswers(false, 4);

      await openApprovalSurface({ tabId: 5 });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it("does not probe without a requesting tab", async () => {
      panelAnswers(false);

      await openApprovalSurface();

      expect(runtimeSendMessage).not.toHaveBeenCalled();
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("never opens a popup or window next to a live panel", async () => {
      panelAnswers(false);
      sendMessage.mockRejectedValue(new Error("no content script"));
      openPopup.mockRejectedValue(new Error("refused"));

      await openApprovalSurface({ tabId: 5 });

      expect(openPopup).not.toHaveBeenCalled();
      expect(createWindow).not.toHaveBeenCalled();
    });
  });
});
