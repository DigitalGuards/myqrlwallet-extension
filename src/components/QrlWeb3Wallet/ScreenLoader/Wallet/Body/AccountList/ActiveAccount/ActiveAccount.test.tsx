import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import ActiveAccount from "./ActiveAccount";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountId/AccountId",
  () => ({ default: () => <div>Mocked Account Id</div> }),
);

describe("ActiveAccount", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <ActiveAccount />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  const openMenu = async () => {
    const trigger = screen.getByTestId("account-menu");
    await userEvent.click(trigger);
  };

  it.each(["button", "Enter"])(
    "retains the edited label when saving by %s fails",
    async (action) => {
      const error = new Error("label storage failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const setLabel = vi.fn().mockRejectedValue(error);
      renderComponent(mockedStore({ accountLabelsStore: { setLabel } }));
      await openMenu();
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      const input = screen.getByRole("textbox", { name: "Edit account label" });
      await userEvent.type(input, "Savings");
      if (action === "Enter") await userEvent.keyboard("{Enter}");
      else
        await userEvent.click(
          screen.getByRole("button", { name: "Save label" }),
        );

      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Failed to save the account label:",
          error,
        );
      });
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(input).toHaveValue("Savings");
    },
  );

  it.each(["hide", "activate"])(
    "reports a failed %s while hiding the active account",
    async (step) => {
      const error = new Error("account storage failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const hideAccount = vi.fn().mockResolvedValue(undefined);
      const setActiveAccount = vi.fn().mockResolvedValue(undefined);
      if (step === "hide") hideAccount.mockRejectedValue(error);
      else setActiveAccount.mockRejectedValue(error);
      renderComponent(
        mockedStore({
          qrlStore: {
            activeAccount: { accountAddress: "QActive" },
            qrlAccounts: {
              accounts: [
                { accountAddress: "QNext", accountBalance: "0.0 Quanta" },
              ],
            },
            setActiveAccount,
          },
          hiddenAccountsStore: { hideAccount },
        }),
      );
      await openMenu();
      await userEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Failed to hide the active account:",
          error,
        );
      });
      expect(hideAccount).toHaveBeenCalledWith("QActive");
      if (step === "hide") expect(setActiveAccount).not.toHaveBeenCalled();
      else expect(setActiveAccount).toHaveBeenCalledWith("QNext");
    },
  );

  it("exposes the account menu trigger as a named button", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
      }),
    );

    expect(screen.getByRole("button", { name: "More" })).toBe(
      screen.getByTestId("account-menu"),
    );
  });

  it("should render the active account component", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
      }),
    );

    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.getByText("Mocked Account Id")).toBeInTheDocument();

    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Send Quanta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy Address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
  });

  it("should call the copyAccount function on clicking the copy button", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
      }),
    );

    const mockedWriteText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mockedWriteText,
      },
      writable: true,
    });

    await openMenu();
    const copyItem = screen.getByRole("menuitem", { name: "Copy Address" });
    await userEvent.click(copyItem);
    expect(mockedWriteText).toHaveBeenCalledTimes(1);
    expect(mockedWriteText).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
  });

  it("should show edit input when rename is clicked", async () => {
    const labels: Record<string, string> = {
      Q20fB08fF1f1376A14C055E9F56df80563E16722b: "My Main Wallet",
    };
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
        accountLabelsStore: {
          labels,
          getLabel: (addr: string) => labels[addr] ?? "",
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("My Main Wallet");
    expect(
      screen.getByRole("button", { name: "Save label" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel edit" }),
    ).toBeInTheDocument();
  });

  it("should call setLabel on save", async () => {
    const setLabel = vi.fn(() => Promise.resolve());
    const labels: Record<string, string> = {
      Q20fB08fF1f1376A14C055E9F56df80563E16722b: "Old Name",
    };
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
        accountLabelsStore: {
          labels,
          getLabel: (addr: string) => labels[addr] ?? "",
          setLabel,
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");

    await userEvent.click(screen.getByRole("button", { name: "Save label" }));

    expect(setLabel).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
      "New Name",
    );
  });

  it("should hide edit input on cancel", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(
      screen.getByRole("textbox", { name: "Edit account label" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel edit" }));

    expect(
      screen.queryByRole("textbox", { name: "Edit account label" }),
    ).not.toBeInTheDocument();
  });

  it("should save on Enter key", async () => {
    const setLabel = vi.fn(() => Promise.resolve());
    const labels: Record<string, string> = {
      Q20fB08fF1f1376A14C055E9F56df80563E16722b: "Old Name",
    };
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
        accountLabelsStore: {
          labels,
          getLabel: (addr: string) => labels[addr] ?? "",
          setLabel,
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.clear(input);
    await userEvent.type(input, "Enter Name{Enter}");

    await waitFor(() => {
      expect(setLabel).toHaveBeenCalledWith(
        "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        "Enter Name",
      );
    });
  });

  it("should cancel on Escape key", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.type(input, "{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Edit account label" }),
    ).not.toBeInTheDocument();
  });

  it("should show Hide menu item when other visible accounts exist", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "1.0 QRL",
              },
              {
                accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
                accountBalance: "2.0 QRL",
              },
            ],
          },
        },
      }),
    );

    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Hide" })).toBeInTheDocument();
  });

  it("should not show Hide when it is the only visible account", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "1.0 QRL",
              },
            ],
          },
        },
      }),
    );

    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Hide" }),
    ).not.toBeInTheDocument();
  });

  it("should call hideAccount and setActiveAccount when Hide is clicked", async () => {
    const hideAccount = vi.fn(() => Promise.resolve());
    const setActiveAccount = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "1.0 QRL",
              },
              {
                accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
                accountBalance: "2.0 QRL",
              },
            ],
          },
          setActiveAccount,
        },
        hiddenAccountsStore: {
          hiddenAccounts: {},
          hiddenAddresses: [],
          loadHiddenAccounts: async () => {},
          hideAccount,
          unhideAccount: async () => {},
          isHidden: () => false,
        },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    expect(hideAccount).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
    expect(setActiveAccount).toHaveBeenCalledWith(
      "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
    );
  });
  it.each([
    ["Send Quanta", "Failed to open token transfer:"],
    ["Receive", "Failed to open account receive:"],
  ])("reports a rejected %s navigation", async (menuItem, message) => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    navigate.mockRejectedValueOnce(error);
    renderComponent();
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: menuItem }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(message, error);
    });
  });
});
