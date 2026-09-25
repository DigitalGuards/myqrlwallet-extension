import { profileStorageKey } from "@/utilities/profileStorage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  applyEarlySidePanelToolbarBehavior,
  applySidePanelToolbarBehavior,
  handleSidePanelInstalled,
  handleSidePanelOpenMessage,
  requestSidePanelOpen,
  resetSidePanelOpenerForTests,
} from "./sidePanelSurface";

const SETTINGS_KEY = profileStorageKey("SETTINGS");

const setSettings = (settings: object) => {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) =>
    key === SETTINGS_KEY ? { [SETTINGS_KEY]: settings } : {},
  );
};

const sidePanelOpen = vi.fn(async () => undefined);
const setPanelBehavior = vi.fn(async () => undefined);
const setOptions = vi.fn(async () => undefined);

const installSidePanelApi = () => {
  (globalThis as Record<string, unknown>).chrome = {
    sidePanel: { open: sidePanelOpen, setPanelBehavior, setOptions },
  };
};

const tabSender = (tabId: number, id = "mock-id") =>
  ({ id, tab: { id: tabId } }) as browser.Runtime.MessageSender;

describe("side panel toolbar behavior", () => {
  beforeEach(() => {
    sidePanelOpen.mockClear();
    setPanelBehavior.mockClear();
    setOptions.mockClear();
    setSettings({});
    installSidePanelApi();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
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
    delete (globalThis as Record<string, unknown>).chrome;

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
});

describe("handleSidePanelInstalled", () => {
  beforeEach(() => {
    setSettings({});
    vi.mocked(browser.storage.local.set).mockClear();
  });

  it("arms the notice for an existing install", async () => {
    await handleSidePanelInstalled("update");

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [SETTINGS_KEY]: { sidePanelNoticePending: true },
    });
  });

  it("never shows the notice on a fresh install", async () => {
    await handleSidePanelInstalled("install");

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("skips users who already chose a surface", async () => {
    setSettings({ sidePanelSurface: "popup" });

    await handleSidePanelInstalled("update");

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("does not re-arm a notice that was already seen", async () => {
    setSettings({ sidePanelNoticeSeen: true });

    await handleSidePanelInstalled("update");

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("side panel gesture roundtrip", () => {
  beforeEach(() => {
    resetSidePanelOpenerForTests();
    sidePanelOpen.mockClear();
    sidePanelOpen.mockResolvedValue(undefined);
    installSidePanelApi();
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSidePanelOpenerForTests();
    delete (globalThis as Record<string, unknown>).chrome;
    vi.useRealTimers();
  });

  const answerLatestNonce = (
    sender: browser.Runtime.MessageSender,
    name: string = EXTENSION_MESSAGES.OPEN_SIDE_PANEL,
  ) => {
    const calls = vi.mocked(browser.tabs.sendMessage).mock.calls;
    const request = calls[calls.length - 1]?.[1] as { nonce: string };
    return handleSidePanelOpenMessage({ name, nonce: request.nonce }, sender);
  };

  it("opens the panel for the tab that forwarded the gesture", async () => {
    const pending = requestSidePanelOpen(9);
    await vi.waitFor(() =>
      expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1),
    );

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
    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(
      new Error("no receiving end"),
    );

    await expect(requestSidePanelOpen(9)).resolves.toBe(false);
    expect(sidePanelOpen).not.toHaveBeenCalled();
  });

  it("resolves false when chrome refuses to open the panel", async () => {
    sidePanelOpen.mockRejectedValue(new Error("no user gesture"));
    const pending = requestSidePanelOpen(9);
    await vi.waitFor(() =>
      expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1),
    );

    answerLatestNonce(tabSender(9));

    await expect(pending).resolves.toBe(false);
  });

  it("does nothing on a browser without the side panel API", async () => {
    delete (globalThis as Record<string, unknown>).chrome;

    await expect(requestSidePanelOpen(9)).resolves.toBe(false);
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  describe("nonce and sender validation", () => {
    beforeEach(async () => {
      requestSidePanelOpen(9);
      await vi.waitFor(() =>
        expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1),
      );
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
      expect(
        answerLatestNonce({ id: "mock-id" } as browser.Runtime.MessageSender),
      ).toBe(false);
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
      expect(sidePanelOpen).not.toHaveBeenCalled();
    });

    it("spends a nonce only once", () => {
      expect(answerLatestNonce(tabSender(9))).toBe(true);
      expect(answerLatestNonce(tabSender(9))).toBe(false);
      expect(sidePanelOpen).toHaveBeenCalledTimes(1);
    });
  });
});
