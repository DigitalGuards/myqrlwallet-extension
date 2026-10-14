import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import QrlWeb3WalletMoreOptions from "./QrlWeb3WalletMoreOptions";
import userEvent from "@testing-library/user-event";
import browser from "webextension-polyfill";

vi.setConfig({ testTimeout: 15000 });

const { createTab, getCurrentWindow, navigateMock } = vi.hoisted(() => ({
  createTab: vi.fn().mockResolvedValue({}),
  getCurrentWindow: vi.fn().mockResolvedValue({ id: 7 }),
  navigateMock: vi.fn<(to: string) => void | Promise<void>>(),
}));

vi.mock("webextension-polyfill", async (importOriginal) => {
  const originalModule = await importOriginal<{ default: typeof browser }>();
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      tabs: {
        ...originalModule.default.tabs,
        create: createTab,
      },
      windows: {
        ...originalModule.default.windows,
        getCurrent: getCurrentWindow,
      },
      runtime: {
        ...originalModule.default.runtime,
        getURL: vi.fn().mockReturnValue("chrome-extension://id/index.html"),
      },
    },
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return { ...original, useNavigate: () => navigateMock };
});

describe("QrlWeb3WalletMoreOptions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <QrlWeb3WalletMoreOptions />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("exposes the menu trigger as a named button", async () => {
    const user = userEvent.setup();
    renderComponent(
      mockedStore({
        lockStore: { lock: async () => {} },
        settingsStore: { isPopupWindow: true },
      }),
    );

    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger).toBe(screen.getByTestId("ellipsis-icon"));

    // The trigger used to be a bare svg: unreachable by keyboard.
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("menuitem", { name: "Lock Wallet" }),
    ).toBeInTheDocument();
  });

  it("should render the qrl web3 wallet more options component", async () => {
    renderComponent(
      mockedStore({
        lockStore: { lock: async () => {} },
        settingsStore: { isPopupWindow: true },
      }),
    );

    const moreButton = screen.getByTestId("ellipsis-icon");
    await userEvent.click(moreButton);
    const openInTabButton = screen.getByRole("menuitem", {
      name: "Open In Tab",
    });
    expect(openInTabButton).toBeInTheDocument();
    expect(openInTabButton).toBeEnabled();
    const lockWalletButton = screen.getByRole("menuitem", {
      name: "Lock Wallet",
    });
    expect(lockWalletButton).toBeInTheDocument();
    expect(lockWalletButton).toBeEnabled();
  });

  it("should hide the open in tab button if the extension is already in tab", async () => {
    renderComponent(
      mockedStore({
        lockStore: { lock: async () => {} },
        settingsStore: { isPopupWindow: false },
      }),
    );

    const moreButton = screen.getByTestId("ellipsis-icon");
    await userEvent.click(moreButton);
    const openInTabButton = screen.queryByRole("menuitem", {
      name: "Open In Tab",
    });
    expect(openInTabButton).not.toBeInTheDocument();
    const lockWalletButton = screen.getByRole("menuitem", {
      name: "Lock Wallet",
    });
    expect(lockWalletButton).toBeInTheDocument();
    expect(lockWalletButton).toBeEnabled();
  });

  it("should call the tabs.create function on clicking the open in tab button", async () => {
    renderComponent(
      mockedStore({
        lockStore: { lock: async () => {} },
        settingsStore: { isPopupWindow: true },
      }),
    );

    const moreButton = screen.getByTestId("ellipsis-icon");
    await userEvent.click(moreButton);
    const openInTabButton = screen.getByRole("menuitem", {
      name: "Open In Tab",
    });
    expect(openInTabButton).toBeInTheDocument();
    expect(openInTabButton).toBeEnabled();
    await userEvent.click(openInTabButton);
    expect(createTab).toHaveBeenCalledTimes(1);
  });

  it("should render the Contacts menu item", async () => {
    renderComponent(
      mockedStore({
        lockStore: { lock: async () => {} },
        settingsStore: { isPopupWindow: true },
      }),
    );

    const moreButton = screen.getByTestId("ellipsis-icon");
    await userEvent.click(moreButton);
    const contactsButton = screen.getByRole("menuitem", { name: "Contacts" });
    expect(contactsButton).toBeInTheDocument();
    expect(contactsButton).toBeEnabled();
  });

  it("should call the lock function on clicking the lock button", async () => {
    const mockedLock = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        lockStore: { lock: mockedLock },
        settingsStore: { isPopupWindow: true },
      }),
    );

    const moreButton = screen.getByTestId("ellipsis-icon");
    await userEvent.click(moreButton);
    const lockWalletButton = screen.getByRole("menuitem", {
      name: "Lock Wallet",
    });
    expect(lockWalletButton).toBeInTheDocument();
    expect(lockWalletButton).toBeEnabled();
    await userEvent.click(lockWalletButton);
    expect(mockedLock).toHaveBeenCalledTimes(1);
  });
  it.each(["Open In Tab", "Lock Wallet", "Contacts", "Settings"])(
    "reports a rejected %s action",
    async (action) => {
      const failure = new Error("Action unavailable");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const lock = vi.fn().mockRejectedValue(failure);
      if (action === "Open In Tab") createTab.mockRejectedValueOnce(failure);
      if (action === "Contacts" || action === "Settings")
        navigateMock.mockRejectedValueOnce(failure);
      renderComponent(mockedStore({ lockStore: { lock } }));
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await userEvent.click(screen.getByRole("menuitem", { name: action }));
      expect(report).toHaveBeenCalledWith(
        action === "Open In Tab"
          ? "Failed to open wallet tab:"
          : action === "Lock Wallet"
            ? "Failed to lock wallet:"
            : "Failed to navigate wallet:",
        failure,
      );
    },
  );

  it.each([undefined, {}, { sidePanel: {} }])(
    "hides side-panel actions when the API is absent",
    async (chromeApi) => {
      vi.stubGlobal("chrome", chromeApi);
      renderComponent();
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      expect(
        screen.queryByRole("menuitem", { name: "Open as Side Panel" }),
      ).not.toBeInTheDocument();
    },
  );

  it("awaits the side-panel preference before configuring and opening the current window", async () => {
    const events: string[] = [];
    const setSidePanelPreferred = vi.fn(() => {
      events.push("preference");
      return Promise.resolve();
    });
    const setOptions = vi.fn(() => {
      events.push("options");
      return Promise.resolve();
    });
    const open = vi.fn(() => {
      events.push("open");
      return Promise.resolve();
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {
      events.push("close");
    });
    vi.stubGlobal("chrome", { sidePanel: { open, setOptions } });
    renderComponent(mockedStore({ settingsStore: { setSidePanelPreferred } }));
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Open as Side Panel" }),
    );
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    expect(setSidePanelPreferred).toHaveBeenCalledWith(true);
    expect(setOptions).toHaveBeenCalledWith({
      path: "index.html?sidepanel=true",
    });
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    expect(events).toEqual(["preference", "options", "open", "close"]);
  });

  it("keeps the window open when opening the side panel fails", async () => {
    const open = vi.fn().mockRejectedValue(new Error("Panel unavailable"));
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    vi.stubGlobal("chrome", {
      sidePanel: { open, setOptions: vi.fn().mockResolvedValue(undefined) },
    });
    renderComponent();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Open as Side Panel" }),
    );
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    expect(close).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "switches from the side panel with preference failure %s",
    async (fails) => {
      const setSidePanelPreferred = vi.fn(() =>
        fails
          ? Promise.reject(new Error("Storage unavailable"))
          : Promise.resolve(),
      );
      const close = vi.spyOn(window, "close").mockImplementation(() => {});
      vi.stubGlobal("chrome", { sidePanel: { open: vi.fn() } });
      renderComponent(
        mockedStore({
          settingsStore: {
            isPopupWindow: false,
            isSidePanel: true,
            setSidePanelPreferred,
          },
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Switch to Popup" }),
      );
      expect(setSidePanelPreferred).toHaveBeenCalledWith(false);
      expect(close).toHaveBeenCalledTimes(fails ? 0 : 1);
    },
  );
});
