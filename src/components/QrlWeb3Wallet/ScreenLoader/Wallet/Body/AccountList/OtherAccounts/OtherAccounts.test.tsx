import { mockedStore } from "@/__mocks__/mockedStore";
import type { StoreType } from "@/stores/store";
import type { PartialDeep } from "type-fest";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import OtherAccounts from "./OtherAccounts";
import StorageUtil from "@/utilities/storageUtil";

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

describe("OtherAccounts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <OtherAccounts />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  const twoAccountStore = (
    overrides: PartialDeep<StoreType["qrlStore"]> = {},
  ) =>
    mockedStore({
      qrlStore: {
        activeAccount: {
          accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        },
        qrlAccounts: {
          isLoading: false,
          accounts: [
            {
              accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
              accountBalance: "2.4568 QRL",
            },
            {
              accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
              accountBalance: "0.3695 QRL",
            },
          ],
        },
        ...overrides,
      },
    });

  const openMenu = async () => {
    const trigger = screen.getByTestId("account-menu");
    await userEvent.click(trigger);
  };

  it("exposes the account menu trigger as a named button", () => {
    renderComponent(twoAccountStore());

    expect(screen.getByRole("button", { name: "More" })).toBe(
      screen.getByTestId("account-menu"),
    );
  });

  it("should render the other accounts component", async () => {
    renderComponent(twoAccountStore());

    expect(
      screen.getByText("Other accounts in the wallet"),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked Account Id")).toBeInTheDocument();

    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Switch" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy Address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
  });

  it("should call the setActiveAccount function on click of switch", async () => {
    const mockedSetActiveAccount = vi.fn(async (_activeAccount: string) => {});
    renderComponent(
      twoAccountStore({ setActiveAccount: mockedSetActiveAccount }),
    );

    await openMenu();
    await act(async () => {
      await userEvent.click(screen.getByRole("menuitem", { name: "Switch" }));
    });
    expect(mockedSetActiveAccount).toHaveBeenCalledTimes(1);
  });

  it("should call the copyAccount function on clicking the copy item", async () => {
    renderComponent(twoAccountStore());

    const mockedWriteText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mockedWriteText,
      },
      writable: true,
    });

    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Copy Address" }),
    );
    expect(mockedWriteText).toHaveBeenCalledTimes(1);
    expect(mockedWriteText).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
  });

  const storeWithLabel = (
    overrides: PartialDeep<StoreType["accountLabelsStore"]> = {},
  ) => {
    const labels: Record<string, string> = {
      Q20fB08fF1f1376A14C055E9F56df80563E16722b: "Account 2",
    };
    return mockedStore({
      qrlStore: {
        activeAccount: {
          accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        },
        qrlAccounts: {
          isLoading: false,
          accounts: [
            {
              accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
              accountBalance: "2.4568 QRL",
            },
            {
              accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
              accountBalance: "0.3695 QRL",
            },
          ],
        },
      },
      accountLabelsStore: {
        labels,
        getLabel: (addr: string) => labels[addr] ?? "",
        ...overrides,
      },
    });
  };

  it.each(["button", "Enter"])(
    "retains the edited label when saving by %s fails",
    async (action) => {
      const error = new Error("label storage failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const setLabel = vi.fn().mockRejectedValue(error);
      renderComponent(storeWithLabel({ setLabel }));
      await openMenu();
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      const input = screen.getByRole("textbox", { name: "Edit account label" });
      await userEvent.clear(input);
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

  it.each(["clear", "activate"])(
    "reports a failed %s while switching accounts",
    async (step) => {
      const error = new Error("account storage failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const clear = vi
        .spyOn(StorageUtil, "clearTransactionValues")
        .mockResolvedValue(undefined);
      const setActiveAccount = vi.fn().mockResolvedValue(undefined);
      if (step === "clear") clear.mockRejectedValue(error);
      else setActiveAccount.mockRejectedValue(error);
      renderComponent(twoAccountStore({ setActiveAccount }));
      await openMenu();
      await userEvent.click(screen.getByRole("menuitem", { name: "Switch" }));

      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Failed to switch the active account:",
          error,
        );
      });
      if (step === "clear") expect(setActiveAccount).not.toHaveBeenCalled();
      else expect(setActiveAccount).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a failed hide and retains the account", async () => {
    const error = new Error("account storage failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = twoAccountStore();
    const hideAccount = vi.fn().mockRejectedValue(error);
    store.hiddenAccountsStore.hideAccount = hideAccount;
    renderComponent(store);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Hide" }));

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to hide the account:", error);
    });
    expect(hideAccount).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
    expect(screen.getByText("Mocked Account Id")).toBeInTheDocument();
  });

  it("should show rename item in dropdown menu", async () => {
    renderComponent(storeWithLabel());

    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
  });

  it("should show edit input when rename is clicked", async () => {
    renderComponent(storeWithLabel());

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Account 2");
    expect(
      screen.getByRole("button", { name: "Save label" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel edit" }),
    ).toBeInTheDocument();
  });

  it("should call setLabel on save", async () => {
    const setLabel = vi.fn(() => Promise.resolve());
    renderComponent(storeWithLabel({ setLabel }));

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.clear(input);
    await userEvent.type(input, "Savings");

    await userEvent.click(screen.getByRole("button", { name: "Save label" }));

    expect(setLabel).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
      "Savings",
    );
  });

  it("should hide edit input on cancel", async () => {
    renderComponent(storeWithLabel());

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
    renderComponent(storeWithLabel({ setLabel }));

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.clear(input);
    await userEvent.type(input, "New Label{Enter}");

    await waitFor(() => {
      expect(setLabel).toHaveBeenCalledWith(
        "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        "New Label",
      );
    });
  });

  it("should cancel on Escape key", async () => {
    renderComponent(storeWithLabel());

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.type(input, "{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Edit account label" }),
    ).not.toBeInTheDocument();
  });

  it("should show Hide menu item", async () => {
    renderComponent(twoAccountStore());

    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Hide" })).toBeInTheDocument();
  });

  it("should call hideAccount when Hide is clicked", async () => {
    const hideAccount = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
                accountBalance: "2.4568 QRL",
              },
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "0.3695 QRL",
              },
            ],
          },
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
  });

  it("should show Remove menu item", async () => {
    renderComponent(twoAccountStore());

    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Remove" }),
    ).toBeInTheDocument();
  });

  it("should remove the account only after confirming the dialog", async () => {
    const removeAccount = vi.fn(() => Promise.resolve());
    const removeAccountKey = vi.fn(() => Promise.resolve());
    const removeLabel = vi.fn(() => Promise.resolve());
    const unhideAccount = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
                accountBalance: "2.4568 QRL",
              },
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "0.3695 QRL",
              },
            ],
          },
          removeAccount,
        },
        lockStore: { removeAccountKey },
        accountLabelsStore: { removeLabel },
        hiddenAccountsStore: { unhideAccount },
      }),
    );

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));

    // The menu item only opens the confirm dialog.
    expect(removeAccount).not.toHaveBeenCalled();
    expect(screen.getByText("Remove account")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    const removedAddress = "Q20fB08fF1f1376A14C055E9F56df80563E16722b";
    expect(removeAccount).toHaveBeenCalledWith(removedAddress);
    expect(removeAccountKey).toHaveBeenCalledWith(removedAddress);
    expect(removeLabel).toHaveBeenCalledWith(removedAddress);
    expect(unhideAccount).toHaveBeenCalledWith(removedAddress);
  });

  it("should not remove the account when the dialog is cancelled", async () => {
    const removeAccount = vi.fn(() => Promise.resolve());
    renderComponent(twoAccountStore({ removeAccount }));

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(removeAccount).not.toHaveBeenCalled();
    expect(screen.queryByText("Remove account")).not.toBeInTheDocument();
  });

  it("should not show hidden accounts in the list", () => {
    const hidden: Partial<Record<string, boolean>> = {
      Q20fB08fF1f1376A14C055E9F56df80563E16722b: true,
    };
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
                accountBalance: "2.4568 QRL",
              },
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "0.3695 QRL",
              },
            ],
          },
        },
        hiddenAccountsStore: {
          hiddenAccounts: hidden,
          hiddenAddresses: ["Q20fB08fF1f1376A14C055E9F56df80563E16722b"],
          loadHiddenAccounts: async () => {},
          hideAccount: async () => {},
          unhideAccount: async () => {},
          isHidden: (addr: string) => hidden[addr] ?? false,
        },
      }),
    );

    expect(
      screen.queryByText("Other accounts in the wallet"),
    ).not.toBeInTheDocument();
  });
  it("reports a rejected receive navigation", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    navigate.mockRejectedValueOnce(error);
    renderComponent(twoAccountStore());
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Receive" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to open account receive:",
        error,
      );
    });
  });

  it("reports a rejected home navigation while preserving the account switch order", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    vi.spyOn(StorageUtil, "clearTransactionValues").mockImplementation(() => {
      calls.push("clear");
      return Promise.resolve();
    });
    navigate.mockImplementationOnce(() => {
      calls.push("navigate");
      return Promise.reject(error);
    });
    const setActiveAccount = vi.fn(() => {
      calls.push("activate");
      return Promise.resolve();
    });
    renderComponent(twoAccountStore({ setActiveAccount }));
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Switch" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to open the home page:",
        error,
      );
    });
    expect(calls).toEqual(["clear", "navigate", "activate"]);
    expect(setActiveAccount).toHaveBeenCalledTimes(1);
  });
});
