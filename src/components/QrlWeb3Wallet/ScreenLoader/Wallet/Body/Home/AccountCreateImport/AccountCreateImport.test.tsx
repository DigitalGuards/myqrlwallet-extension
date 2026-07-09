import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import AccountCreateImport from "./AccountCreateImport";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    getTokenContractsList: vi.fn(async () => [
      "Qd180388b9a863728fdc2e865d5fea87ce100eb2f",
    ]),
    getNFTCollectionsList: vi.fn(async () => []),
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay",
  () => ({ default: () => <div>Mocked Active Account Display</div> }),
);

describe("AccountCreateImport", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <AccountCreateImport />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account create and import component when there are no active account", () => {
    renderComponent(
      mockedStore({ qrlStore: { activeAccount: { accountAddress: "" } } }),
    );

    expect(screen.queryByText("Active account")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Add accounts",
    );
    expect(screen.getByRole("paragraph")).toHaveTextContent(
      "Create a new account or import an existing account.",
    );
    const createNewButton = screen.getByRole("button", {
      name: "Create a new account",
    });
    const importButton = screen.getByRole("button", {
      name: "Import an existing account",
    });
    const connectLedgerButton = screen.getByRole("button", {
      name: "Connect Ledger",
    });
    expect(createNewButton).toBeInTheDocument();
    expect(createNewButton).toBeEnabled();
    expect(importButton).toBeInTheDocument();
    expect(importButton).toBeEnabled();
    expect(connectLedgerButton).toBeInTheDocument();
    expect(connectLedgerButton).toBeEnabled();
  });

  it("should render the active account component and the account create and import component when there is an active account", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
        },
      }),
    );

    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "Active account",
    );
    expect(
      screen.getByText("Mocked Active Account Display"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })[1]).toHaveTextContent(
      "Tokens",
    );
    expect(
      screen.getByRole("button", { name: "Import token" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })[2]).toHaveTextContent(
      "NFT Collections",
    );
    expect(screen.getAllByRole("heading", { level: 3 })[3]).toHaveTextContent(
      "Add accounts",
    );
    expect(screen.getByRole("paragraph")).toHaveTextContent(
      "Create a new account or import an existing account.",
    );
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send",
    });
    const createNewButton = screen.getByRole("button", {
      name: "Create a new account",
    });
    const importButton = screen.getByRole("button", {
      name: "Import an existing account",
    });
    const connectLedgerButton = screen.getByRole("button", {
      name: "Connect Ledger",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeEnabled();
    expect(createNewButton).toBeInTheDocument();
    expect(createNewButton).toBeEnabled();
    expect(importButton).toBeInTheDocument();
    expect(importButton).toBeEnabled();
    expect(connectLedgerButton).toBeInTheDocument();
    expect(connectLedgerButton).toBeEnabled();
  });

  it("should have the connect ledger button link to the import ledger route", () => {
    renderComponent(
      mockedStore({ qrlStore: { activeAccount: { accountAddress: "" } } }),
    );

    const connectLedgerLink = screen.getByRole("link", {
      name: "Connect Ledger",
    });
    expect(connectLedgerLink).toHaveAttribute("href", "/import-ledger");
  });

  it("should show Transaction History button when active account exists", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
        },
      }),
    );

    const historyButton = screen.getByRole("button", {
      name: "History",
    });
    expect(historyButton).toBeInTheDocument();
    expect(historyButton).toBeEnabled();

    const historyLink = screen.getByRole("link", {
      name: "History",
    });
    expect(historyLink).toHaveAttribute("href", "/transaction-history");
  });

  it("should not show Transaction History button when no active account", () => {
    renderComponent(
      mockedStore({ qrlStore: { activeAccount: { accountAddress: "" } } }),
    );

    expect(
      screen.queryByRole("button", { name: "History" }),
    ).not.toBeInTheDocument();
  });
});
