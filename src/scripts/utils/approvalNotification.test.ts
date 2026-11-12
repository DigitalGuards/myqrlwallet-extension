import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { profileStorageKey } from "@/utilities/profileStorage";
import {
  clearAnnouncedApprovalNotification,
  clearApprovalWaitingNotifications,
  handleApprovalNotificationClicked,
  resetApprovalNotificationForTests,
  showApprovalWaitingNotification,
} from "./approvalNotification";

const create = vi.spyOn(browser.notifications, "create");
const clear = vi.spyOn(browser.notifications, "clear");
const getLocal = vi.spyOn(browser.storage.local, "get");
const open = vi.fn<(options: { windowId: number }) => Promise<void>>();

const setSettings = (settings: object) => {
  getLocal.mockImplementation((key) =>
    Promise.resolve(
      key === profileStorageKey("SETTINGS")
        ? { [profileStorageKey("SETTINGS")]: settings }
        : {},
    ),
  );
};

const opts = { type: "basic" as const, iconUrl: "i", title: "t", message: "m" };

describe("showApprovalWaitingNotification", () => {
  beforeEach(() => {
    create.mockClear();
    create.mockResolvedValue("id");
    resetApprovalNotificationForTests();
    setSettings({});
  });

  it("posts one notification per window id", async () => {
    await showApprovalWaitingNotification(9);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      "approval-waiting-9-1",
      expect.objectContaining({ type: "basic", title: "Approval waiting" }),
    );
  });

  it("clears exactly the notification this approval posted", async () => {
    clear.mockClear();
    clear.mockResolvedValue(true);
    await showApprovalWaitingNotification(9);
    clearAnnouncedApprovalNotification();
    await showApprovalWaitingNotification(9);
    clearAnnouncedApprovalNotification();

    expect(clear.mock.calls).toEqual([
      ["approval-waiting-9-1"],
      ["approval-waiting-9-2"],
    ]);
  });

  it("clears nothing for an approval that posted nothing", () => {
    clear.mockClear();

    clearAnnouncedApprovalNotification();

    expect(clear).not.toHaveBeenCalled();
  });

  it("clears an id once", async () => {
    clear.mockClear();
    clear.mockResolvedValue(true);
    await showApprovalWaitingNotification(9);
    clearAnnouncedApprovalNotification();
    clearAnnouncedApprovalNotification();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the user turned notifications off", async () => {
    setSettings({ notificationsEnabled: false });

    await showApprovalWaitingNotification(9);

    expect(create).not.toHaveBeenCalled();
  });

  it("never throws when Chrome refuses the notification", async () => {
    create.mockRejectedValue(new Error("refused"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(showApprovalWaitingNotification(9)).resolves.toBeUndefined();

    warn.mockRestore();
  });
});

describe("clearApprovalWaitingNotifications", () => {
  const getAll = vi.spyOn(browser.notifications, "getAll");

  beforeEach(() => {
    clear.mockClear();
    clear.mockResolvedValue(true);
  });

  it("clears only the approval notifications", async () => {
    getAll.mockResolvedValue({
      "approval-waiting-9-1": opts,
      "tx-0xabc": opts,
    });

    await clearApprovalWaitingNotifications();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith("approval-waiting-9-1");
  });

  it("never throws", async () => {
    getAll.mockRejectedValue(new Error("x"));

    await expect(clearApprovalWaitingNotifications()).resolves.toBeUndefined();
  });
});

describe("handleApprovalNotificationClicked", () => {
  beforeEach(() => {
    open.mockReset();
    open.mockResolvedValue(undefined);
    clear.mockClear();
    clear.mockResolvedValue(true);
    vi.stubGlobal("chrome", { sidePanel: { open } });
  });

  it("opens the panel for the window in the id and clears the notification", async () => {
    handleApprovalNotificationClicked("approval-waiting-9");

    expect(open).toHaveBeenCalledWith({ windowId: 9 });
    await vi.waitFor(() => {
      expect(clear).toHaveBeenCalledWith("approval-waiting-9");
    });
  });

  it("reads the window from an id with a counter", () => {
    handleApprovalNotificationClicked("approval-waiting-12-3");

    expect(open).toHaveBeenCalledWith({ windowId: 12 });
  });

  it("ignores other notifications", () => {
    handleApprovalNotificationClicked("tx-0xabc");

    expect(open).not.toHaveBeenCalled();
  });

  it("ignores an id without a window number", () => {
    handleApprovalNotificationClicked("approval-waiting-x");

    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing without the side panel API", () => {
    vi.stubGlobal("chrome", {});

    handleApprovalNotificationClicked("approval-waiting-9");

    expect(open).not.toHaveBeenCalled();
  });
});
