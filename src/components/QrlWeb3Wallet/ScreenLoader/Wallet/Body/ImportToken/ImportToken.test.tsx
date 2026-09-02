import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverTokens } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ImportToken from "./ImportToken";

const DISCOVERED_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;

vi.mock("@/services/assetDiscovery", () => ({
  discoverTokens: vi.fn(),
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getTokenContractsList: vi.fn().mockResolvedValue([]),
    setTokenContractsList: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ImportToken", () => {
  beforeEach(() => {
    vi.mocked(discoverTokens).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ImportToken />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the import token component", () => {
    renderComponent();

    expect(screen.getByText("Import token")).toBeInTheDocument();
    expect(
      screen.getByText("Paste the token's contract address"),
    ).toBeInTheDocument();
    const inputField = screen.getByRole("textbox", { name: "contractAddress" });
    expect(inputField).toBeInTheDocument();
    const fetchTokenButton = screen.getByRole("button", {
      name: "Fetch token details",
    });
    expect(fetchTokenButton).toBeInTheDocument();
    expect(fetchTokenButton).toBeDisabled();
  });

  it("should enable the fetch token button in the component after entering token contract address", async () => {
    renderComponent();

    const inputField = screen.getByRole("textbox", { name: "contractAddress" });
    const fetchTokenButton = screen.getByRole("button", {
      name: "Fetch token details",
    });
    await userEvent.type(
      inputField,
      "0x0db3981cb93db985e4e3a62ff695f7a1b242dd7c",
    );
    expect(fetchTokenButton).toBeEnabled();
  });

  it("opens the same review screen for a discovered token as for a manual import", async () => {
    vi.mocked(discoverTokens).mockResolvedValue([
      {
        address: DISCOVERED_ADDRESS,
        name: "Discovered Token",
        symbol: "DSC",
        decimals: 18,
      },
    ]);
    const getZrc20TokenDetails = vi.fn().mockResolvedValue({
      token: {
        name: "Discovered Token",
        symbol: "DSC",
        decimals: BigInt(18),
        totalSupply: 1000,
        balance: 42,
        image: "",
      },
      error: "",
    });
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Review Discovered Token" }),
    );

    expect(getZrc20TokenDetails).toHaveBeenCalledWith(DISCOVERED_ADDRESS);
    expect(
      await screen.findByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    // The picker stays mounted but hidden behind the review card.
    expect(
      screen.getByText("Discovered Token", { ignore: "[hidden] *" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42.0 DSC")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "contractAddress" }),
    ).not.toBeInTheDocument();

    // Cancel returns to the picker without importing anything.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByRole("button", { name: "Review Discovered Token" }),
    ).toBeInTheDocument();
  });

  it("surfaces a failed chain read for a discovered token on the manual field", async () => {
    vi.mocked(discoverTokens).mockResolvedValue([
      {
        address: DISCOVERED_ADDRESS,
        name: "Broken Token",
        symbol: "BRK",
        decimals: 18,
      },
    ]);
    const getZrc20TokenDetails = vi.fn().mockResolvedValue({
      token: undefined,
      error: "Contract does not look like a ZRC-20 token",
    });
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Review Broken Token" }),
    );

    expect(
      await screen.findByText("Contract does not look like a ZRC-20 token"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "contractAddress" }),
    ).toHaveValue(DISCOVERED_ADDRESS);
    // The prefilled address is valid input, so a retry is one click away.
    expect(
      screen.getByRole("button", { name: "Fetch token details" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });
});
