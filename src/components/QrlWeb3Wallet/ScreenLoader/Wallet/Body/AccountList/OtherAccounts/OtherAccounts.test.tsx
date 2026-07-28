import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import OtherAccounts from "./OtherAccounts";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountId/AccountId",
  () => ({ default: () => <div>Mocked Account Id</div> }),
);

describe("OtherAccounts", () => {
  afterEach(cleanup);

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

  const twoAccountStore = (overrides: Record<string, any> = {}) =>
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
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Switch" }),
      );
    });
    expect(mockedSetActiveAccount).toBeCalledTimes(1);
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
    expect(mockedWriteText).toBeCalledTimes(1);
    expect(mockedWriteText).toBeCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
  });

  const storeWithLabel = (overrides: Record<string, any> = {}) => {
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
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rename" }),
    );

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
    const setLabel = vi.fn<any>(() => Promise.resolve());
    renderComponent(storeWithLabel({ setLabel }));

    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rename" }),
    );

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.clear(input);
    await userEvent.type(input, "Savings");

    await userEvent.click(
      screen.getByRole("button", { name: "Save label" }),
    );

    expect(setLabel).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
      "Savings",
    );
  });

  it("should hide edit input on cancel", async () => {
    renderComponent(storeWithLabel());

    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rename" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Edit account label" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel edit" }),
    );

    expect(
      screen.queryByRole("textbox", { name: "Edit account label" }),
    ).not.toBeInTheDocument();
  });

  it("should save on Enter key", async () => {
    const setLabel = vi.fn<any>(() => Promise.resolve());
    renderComponent(storeWithLabel({ setLabel }));

    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rename" }),
    );

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
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rename" }),
    );

    const input = screen.getByRole("textbox", { name: "Edit account label" });
    await userEvent.type(input, "{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Edit account label" }),
    ).not.toBeInTheDocument();
  });

  it("should show Hide menu item", async () => {
    renderComponent(twoAccountStore());

    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Hide" }),
    ).toBeInTheDocument();
  });

  it("should call hideAccount when Hide is clicked", async () => {
    const hideAccount = vi.fn<any>(() => Promise.resolve());
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
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Hide" }),
    );

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
    const removeAccount = vi.fn<any>(() => Promise.resolve());
    const removeAccountKey = vi.fn<any>(() => Promise.resolve());
    const removeLabel = vi.fn<any>(() => Promise.resolve());
    const unhideAccount = vi.fn<any>(() => Promise.resolve());
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
    const removeAccount = vi.fn<any>(() => Promise.resolve());
    renderComponent(twoAccountStore({ removeAccount }));

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(removeAccount).not.toHaveBeenCalled();
    expect(screen.queryByText("Remove account")).not.toBeInTheDocument();
  });

  it("should not show hidden accounts in the list", () => {
    const hidden: Record<string, boolean> = {
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
          isHidden: (addr: string) => !!hidden[addr],
        },
      }),
    );

    expect(
      screen.queryByText("Other accounts in the wallet"),
    ).not.toBeInTheDocument();
  });
});
