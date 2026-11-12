import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import {
  SIDE_PANEL_PROBE_TIMEOUT_MS,
  handleSidePanelVisibilityMessage,
  isPanelHiddenInWindow,
  probeSidePanels,
  registerSidePanelVisibilityResponder,
  resetSidePanelVisibilityForTests,
} from "./sidePanelVisibility";

const sendMessage = vi.spyOn(browser.runtime, "sendMessage");
const getCurrent = vi.spyOn(browser.windows, "getCurrent");

const panelSender: browser.Runtime.MessageSender = {
  id: "mock-id",
  url: "chrome-extension://mock-id/index.html?sidepanel=true",
};

const aTab: browser.Tabs.Tab = {
  id: 3,
  index: 0,
  active: true,
  highlighted: true,
  pinned: false,
  incognito: false,
};

const sentNonce = (): string => {
  const sent: unknown = sendMessage.mock.calls[0]?.[0];
  if (
    typeof sent !== "object" ||
    sent === null ||
    !("nonce" in sent) ||
    typeof sent.nonce !== "string"
  ) {
    throw new Error("Expected a probe with a nonce.");
  }
  return sent.nonce;
};

const report = (nonce: string, visible: boolean, windowId = 9) => ({
  name: EXTENSION_MESSAGES.SIDE_PANEL_VISIBILITY,
  nonce,
  visible,
  windowId,
});

describe("probeSidePanels", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSidePanelVisibilityForTests();
    vi.useRealTimers();
  });

  it("resolves with the report as soon as every panel has answered", async () => {
    const pending = probeSidePanels(1);
    expect(
      handleSidePanelVisibilityMessage(report(sentNonce(), false), panelSender),
    ).toBe(true);

    await expect(pending).resolves.toEqual([{ visible: false, windowId: 9 }]);
  });

  it("resolves with what arrived when a panel stays silent", async () => {
    vi.useFakeTimers();
    const pending = probeSidePanels(2);
    handleSidePanelVisibilityMessage(report(sentNonce(), true), panelSender);
    await vi.advanceTimersByTimeAsync(SIDE_PANEL_PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toHaveLength(1);
  });

  it("stops waiting when no page can receive the probe", async () => {
    sendMessage.mockRejectedValue(new Error("no receiver"));

    await expect(probeSidePanels(1)).resolves.toEqual([]);
  });

  it("asks nothing when no panel is live", async () => {
    await expect(probeSidePanels(0)).resolves.toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each<[string, browser.Runtime.MessageSender]>([
    ["a content script", { id: "mock-id", url: panelSender.url, tab: aTab }],
    ["a foreign extension", { id: "other", url: panelSender.url }],
    [
      "another wallet surface",
      { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
    ],
  ])("ignores a report from %s", async (_label, sender) => {
    vi.useFakeTimers();
    const pending = probeSidePanels(1);
    const nonce = sentNonce();

    expect(handleSidePanelVisibilityMessage(report(nonce, false), sender)).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(SIDE_PANEL_PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual([]);
  });

  it("ignores a report with an unknown nonce", () => {
    expect(
      handleSidePanelVisibilityMessage(report("unknown", false), panelSender),
    ).toBe(false);
  });
});

describe("isPanelHiddenInWindow", () => {
  it("is true for a hidden panel in the requesting window", () => {
    expect(isPanelHiddenInWindow([{ visible: false, windowId: 9 }], 1, 9)).toBe(
      true,
    );
  });

  it("is false for a visible panel", () => {
    expect(isPanelHiddenInWindow([{ visible: true, windowId: 9 }], 1, 9)).toBe(
      false,
    );
  });

  it("is false when a live panel stayed silent", () => {
    expect(isPanelHiddenInWindow([{ visible: false, windowId: 9 }], 2, 9)).toBe(
      false,
    );
    expect(isPanelHiddenInWindow([], 1, 9)).toBe(false);
  });

  it("is false for a hidden panel in another window", () => {
    expect(isPanelHiddenInWindow([{ visible: false, windowId: 4 }], 1, 9)).toBe(
      false,
    );
  });

  it("is false without a requesting window", () => {
    expect(
      isPanelHiddenInWindow([{ visible: false, windowId: 9 }], 1, undefined),
    ).toBe(false);
  });
});

describe("registerSidePanelVisibilityResponder", () => {
  const addListener = vi.spyOn(browser.runtime.onMessage, "addListener");

  const listener = () => {
    registerSidePanelVisibilityResponder();
    const registered = addListener.mock.calls.at(-1)?.[0];
    if (registered === undefined) {
      throw new Error("Expected a message listener.");
    }
    return (message: unknown, sender: browser.Runtime.MessageSender): unknown =>
      registered(message, sender, () => undefined);
  };

  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    getCurrent.mockResolvedValue({
      id: 9,
      focused: true,
      incognito: false,
      alwaysOnTop: false,
    });
  });

  const probe = { name: EXTENSION_MESSAGES.PROBE_SIDE_PANEL, nonce: "n1" };
  const workerSender = {
    id: "mock-id",
    url: "chrome-extension://mock-id/src/scripts/serviceWorker.js",
  };

  it("answers the worker with its visibility and window", async () => {
    const result = listener()(probe, workerSender);

    expect(result).toBeUndefined();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        name: EXTENSION_MESSAGES.SIDE_PANEL_VISIBILITY,
        nonce: "n1",
        visible: document.visibilityState === "visible",
        windowId: 9,
      });
    });
  });

  it("stays silent for a probe from a tab", async () => {
    void listener()(probe, { ...workerSender, tab: aTab });
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stays silent for a probe from a foreign extension", async () => {
    void listener()(probe, { ...workerSender, id: "other" });
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
