import { isRecord } from "@/utilities/storageGuards";
import { profileStorageKey } from "@/utilities/profileStorage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  handleApprovalWindowRemoved,
  isSidePanelOpen,
  openApprovalSurface,
} from "./approvalSurface";
import {
  applyEarlySidePanelToolbarBehavior,
  applySidePanelToolbarBehavior,
  handleSidePanelInstalled,
  handleSidePanelOpenMessage,
  requestSidePanelOpen,
  resetSidePanelOpenerForTests,
} from "./sidePanelSurface";

const getLocalStorage = vi.spyOn(browser.storage.local, "get");
const setLocalStorage = vi.spyOn(browser.storage.local, "set");
const sendTabMessage = vi.spyOn(browser.tabs, "sendMessage");

const SETTINGS_KEY = profileStorageKey("SETTINGS");

const setSettings = (settings: object) => {
  getLocalStorage.mockImplementation((key) =>
    Promise.resolve(key === SETTINGS_KEY ? { [SETTINGS_KEY]: settings } : {}),
  );
};

const sidePanelOpen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const setPanelBehavior = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const setOptions = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

const installSidePanelApi = () => {
  vi.stubGlobal("chrome", {
    sidePanel: { open: sidePanelOpen, setPanelBehavior, setOptions },
  });
};

const tabSender = (tabId: number, id = "mock-id") =>
  ({
    id,
    tab: {
      id: tabId,
      index: 0,
      active: true,
      highlighted: true,
      pinned: false,
      incognito: false,
    },
  }) satisfies browser.Runtime.MessageSender;

describe("side panel toolbar behavior", () => {
  beforeEach(() => {
    sidePanelOpen.mockClear();
    setPanelBehavior.mockClear();
    setOptions.mockClear();
    setSettings({});
    installSidePanelApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns the panel on early when no explicit choice was made", async () => {
    await applyEarlySidePanelToolbarBehavior();

    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    // The early pass stays cheap: the path is pinned by the reconcile pass.
    expect(setOptions).not.toHaveBeenCalled();
  });

  it("turns the panel off early for an explicit popup choice", async () => {
    // Chrome persists the last behaviour across sessions, so leaving it
    // alone would hand the panel to a popup user on the next cold start.
    setSettings({ sidePanelSurface: "popup" });

    await applyEarlySidePanelToolbarBehavior();

    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: false,
    });
    expect(setOptions).not.toHaveBeenCalled();
  });

  it("does nothing on a browser without the side panel API", async () => {
    vi.stubGlobal("chrome", undefined);

    await applyEarlySidePanelToolbarBehavior();
    await applySidePanelToolbarBehavior();

    expect(setPanelBehavior).not.toHaveBeenCalled();
  });

  it("reconciles to the persisted preference and pins the panel path", async () => {
    setSettings({ sidePanelSurface: "popup" });

    await applySidePanelToolbarBehavior();

    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: false,
    });
    expect(setOptions).toHaveBeenCalledWith({
      path: "index.html?sidepanel=true",
    });
  });

  it("keeps the toolbar usable when panel behavior is unavailable", async () => {
    vi.stubGlobal("chrome", { sidePanel: { open: sidePanelOpen } });

    await applyEarlySidePanelToolbarBehavior();
    await applySidePanelToolbarBehavior();

    expect(setPanelBehavior).not.toHaveBeenCalled();
    expect(setOptions).not.toHaveBeenCalled();
  });

  it("handles a rejected toolbar update", async () => {
    setPanelBehavior.mockRejectedValueOnce(new Error("unavailable"));

    await expect(applySidePanelToolbarBehavior()).resolves.toBeUndefined();

    expect(setOptions).not.toHaveBeenCalled();
  });
});

describe("side panel context detection", () => {
  afterEach(() => {
    handleApprovalWindowRemoved(77);
    vi.unstubAllGlobals();
  });

  it.each([undefined, {}, { runtime: {} }])(
    "reports no open panel when the context API is unavailable %#",
    async (chromeApi) => {
      vi.stubGlobal("chrome", chromeApi);

      await expect(isSidePanelOpen()).resolves.toBe(false);
    },
  );

  it.each([null, {}, { length: 1 }, "panel"])(
    "rejects a malformed context result %#",
    async (contexts) => {
      vi.stubGlobal("chrome", {
        runtime: {
          ContextType: { SIDE_PANEL: "SIDE_PANEL" },
          getContexts: vi.fn().mockResolvedValue(contexts),
        },
      });

      await expect(isSidePanelOpen()).resolves.toBe(false);
    },
  );

  it("treats a rejected context query as no open panel", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL" },
        getContexts: vi.fn().mockRejectedValue(new Error("unavailable")),
      },
    });

    await expect(isSidePanelOpen()).resolves.toBe(false);
  });

  it("opens the fallback window for malformed popup context results", async () => {
    setSettings({ sidePanelSurface: "popup" });
    vi.spyOn(browser.action, "openPopup").mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const createWindow = vi.spyOn(browser.windows, "create");
    const getContexts = vi.fn().mockResolvedValue({ length: 1 });
    vi.stubGlobal("chrome", {
      runtime: {
        ContextType: { SIDE_PANEL: "SIDE_PANEL", POPUP: "POPUP" },
        getContexts,
      },
    });

    await openApprovalSurface();

    expect(getContexts.mock.calls).toEqual([
      [{ contextTypes: ["SIDE_PANEL"] }],
      [{ contextTypes: ["POPUP"] }],
    ]);
    expect(createWindow).toHaveBeenCalledOnce();
  });
});

describe("handleSidePanelInstalled", () => {
  beforeEach(() => {
    setSettings({});
    setLocalStorage.mockClear();
  });

  it("arms the notice for an existing install", async () => {
    await handleSidePanelInstalled("update");

    expect(setLocalStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: { sidePanelNoticePending: true },
    });
  });

  it("never shows the notice on a fresh install", async () => {
    await handleSidePanelInstalled("install");

    expect(setLocalStorage).not.toHaveBeenCalled();
  });

  it("skips users who already chose a surface", async () => {
    setSettings({ sidePanelSurface: "popup" });

    await handleSidePanelInstalled("update");

    expect(setLocalStorage).not.toHaveBeenCalled();
  });

  it("does not re-arm a notice that was already seen", async () => {
    setSettings({ sidePanelNoticeSeen: true });

    await handleSidePanelInstalled("update");

    expect(setLocalStorage).not.toHaveBeenCalled();
  });
});

describe("side panel gesture roundtrip", () => {
  beforeEach(() => {
    resetSidePanelOpenerForTests();
    sidePanelOpen.mockClear();
    sidePanelOpen.mockResolvedValue(undefined);
    installSidePanelApi();
    sendTabMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSidePanelOpenerForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const answerLatestNonce = (
    sender: browser.Runtime.MessageSender,
    name: string = EXTENSION_MESSAGES.OPEN_SIDE_PANEL,
  ) => {
    const calls = sendTabMessage.mock.calls;
    const request: unknown = calls[calls.length - 1]?.[1];
    if (!isRecord(request) || typeof request.nonce !== "string") {
      throw new Error("Expected a side panel request nonce");
    }
    return handleSidePanelOpenMessage({ name, nonce: request.nonce }, sender);
  };

  it("opens the panel for the tab that forwarded the gesture", async () => {
    const pending = requestSidePanelOpen(9);
    await vi.waitFor(() => {
      expect(sendTabMessage).toHaveBeenCalledTimes(1);
    });

    expect(answerLatestNonce(tabSender(9))).toBe(true);

    await expect(pending).resolves.toBe(true);
    expect(sidePanelOpen).toHaveBeenCalledWith({ tabId: 9 });
  });

  it("resolves false when the tab never answers", async () => {
    vi.useFakeTimers();
    const pending = requestSidePanelOpen(9);
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toBe(false);
    expect(sidePanelOpen).not.toHaveBeenCalled();
  });

  it("resolves false when the tab has no content script", async () => {
    sendTabMessage.mockRejectedValue(new Error("no receiving end"));

    await expect(requestSidePanelOpen(9)).resolves.toBe(false);
    expect(sidePanelOpen).not.toHaveBeenCalled();
  });

  it("resolves false when chrome refuses to open the panel", async () => {
    sidePanelOpen.mockRejectedValue(new Error("no user gesture"));
    const pending = requestSidePanelOpen(9);
    await vi.waitFor(() => {
      expect(sendTabMessage).toHaveBeenCalledTimes(1);
    });

    answerLatestNonce(tabSender(9));

    await expect(pending).resolves.toBe(false);
  });

  it("does nothing on a browser without the side panel API", async () => {
    vi.stubGlobal("chrome", undefined);

    await expect(requestSidePanelOpen(9)).resolves.toBe(false);
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  describe("nonce and sender validation", () => {
    let pending: Promise<boolean>;

    afterEach(async () => {
      resetSidePanelOpenerForTests();
      await pending;
    });

    beforeEach(async () => {
      pending = requestSidePanelOpen(9);
      await vi.waitFor(() => {
        expect(sendTabMessage).toHaveBeenCalledTimes(1);
      });
    });

    it("rejects an unknown nonce", () => {
      expect(
        handleSidePanelOpenMessage(
          { name: EXTENSION_MESSAGES.OPEN_SIDE_PANEL, nonce: "guessed" },
          tabSender(9),
        ),
      ).toBe(false);
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("rejects a nonce replayed from a different tab", () => {
      expect(answerLatestNonce(tabSender(11))).toBe(false);
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("rejects a sender from another extension", () => {
      expect(answerLatestNonce(tabSender(9, "other-extension"))).toBe(false);
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("rejects a sender that is not a tab", () => {
      expect(answerLatestNonce({ id: "mock-id" })).toBe(false);
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("rejects a message of another shape", () => {
      expect(answerLatestNonce(tabSender(9), "SOMETHING_ELSE")).toBe(false);
      expect(
        handleSidePanelOpenMessage(
          { name: EXTENSION_MESSAGES.OPEN_SIDE_PANEL, nonce: 7 },
          tabSender(9),
        ),
      ).toBe(false);
      expect(handleSidePanelOpenMessage(null, tabSender(9))).toBe(false);
      const request: unknown = sendTabMessage.mock.calls[0]?.[1];
      if (!isRecord(request)) throw new Error("Expected a panel request");
      expect(
        handleSidePanelOpenMessage(
          Object.assign([], {
            name: EXTENSION_MESSAGES.OPEN_SIDE_PANEL,
            nonce: request.nonce,
          }),
          tabSender(9),
        ),
      ).toBe(false);
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("spends a nonce only once", () => {
      expect(answerLatestNonce(tabSender(9))).toBe(true);
      expect(answerLatestNonce(tabSender(9))).toBe(false);
      expect(sidePanelOpen).toHaveBeenCalledTimes(1);
    });
  });
});
