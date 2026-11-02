import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverTokens } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type StorageUtil from "@/utilities/storageUtil";
import ImportToken from "./ImportToken";

const DISCOVERED_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;

vi.mock("@/services/assetDiscovery", () => ({
  discoverTokens: vi.fn(),
  MAX_DISCOVERED_TOKENS: 50,
}));

const { setTokenContractsList } = vi.hoisted(() => ({
  setTokenContractsList: vi.fn<typeof StorageUtil.setTokenContractsList>(),
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getTokenContractsList: vi.fn().mockResolvedValue([]),
    setTokenContractsList,
  },
}));

describe("ImportToken", () => {
  beforeEach(() => {
    vi.mocked(discoverTokens).mockResolvedValue([]);
    setTokenContractsList.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
    const inputField = screen.getByRole("textbox", {
      name: "Token contract address",
    });
    expect(inputField).toBeInTheDocument();
    const fetchTokenButton = screen.getByRole("button", {
      name: "Fetch token details",
    });
    expect(fetchTokenButton).toBeInTheDocument();
    expect(fetchTokenButton).toBeDisabled();
  });

  it("should enable the fetch token button in the component after entering token contract address", async () => {
    renderComponent();

    const inputField = screen.getByRole("textbox", {
      name: "Token contract address",
    });
    const fetchTokenButton = screen.getByRole("button", {
      name: "Fetch token details",
    });
    await userEvent.type(
      inputField,
      "0x0db3981cb93db985e4e3a62ff695f7a1b242dd7c",
    );
    expect(fetchTokenButton).toBeEnabled();
  });

  it("shows discovered tokens and the manual import in one panel", async () => {
    vi.mocked(discoverTokens).mockResolvedValue([
      {
        address: DISCOVERED_ADDRESS,
        name: "Discovered Token",
        symbol: "DSC",
        decimals: 18,
      },
    ]);
    renderComponent();

    const checkbox = await screen.findByRole("checkbox", {
      name: /Discovered Token/,
    });
    const panel = checkbox.closest<HTMLElement>(".surface-glass");
    if (!panel) throw new Error("import panel missing");
    expect(
      within(panel).getByRole("heading", { name: "Import token" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Add selected (0)" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("textbox", { name: "Token contract address" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Token contract address"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Fetch token details" }),
    ).toBeDisabled();
    expect(
      screen.getAllByRole("heading", { name: "Import token" }),
    ).toHaveLength(1);
  });

  it("adds a picked discovered token without submitting the manual form", async () => {
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
        balanceBaseUnits: "42",
        image: "",
      },
      error: "",
    });
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));

    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Discovered Token/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add selected (1)" }),
    );

    await waitFor(() => {
      expect(setTokenContractsList).toHaveBeenCalledWith(expect.any(String), {
        address: DISCOVERED_ADDRESS,
        symbol: "DSC",
        decimals: 18,
        image: "",
      });
    });
    expect(getZrc20TokenDetails).toHaveBeenCalledTimes(1);
    expect(getZrc20TokenDetails).toHaveBeenCalledWith(DISCOVERED_ADDRESS);
    // The validation message of the empty manual field never shows: the
    // pick does not submit the form.
    expect(
      screen.queryByText("Contract address is required"),
    ).not.toBeInTheDocument();
  });

  it("reviews a manually entered address before importing it", async () => {
    const getZrc20TokenDetails = vi.fn().mockResolvedValue({
      token: {
        name: "Manual Token",
        symbol: "MAN",
        decimals: BigInt(18),
        totalSupply: 1000,
        balance: 42,
        balanceBaseUnits: "42",
        image: "",
      },
      error: "",
    });
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));

    await userEvent.type(
      screen.getByRole("textbox", { name: "Token contract address" }),
      DISCOVERED_ADDRESS,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Fetch token details" }),
    );

    expect(
      await screen.findByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42.0 MAN")).toBeInTheDocument();
    expect(setTokenContractsList).not.toHaveBeenCalled();

    // Cancel returns to the form without importing anything.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByRole("textbox", { name: "Token contract address" }),
    ).toHaveValue("");
    expect(setTokenContractsList).not.toHaveBeenCalled();
  });

  it("shows a failed chain read for a manual address on the field", async () => {
    const getZrc20TokenDetails = vi.fn().mockResolvedValue({
      token: undefined,
      error: "Contract does not look like a ZRC-20 token",
    });
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));

    await userEvent.type(
      screen.getByRole("textbox", { name: "Token contract address" }),
      DISCOVERED_ADDRESS,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Fetch token details" }),
    );

    expect(
      await screen.findByText("Contract does not look like a ZRC-20 token"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("reports a rejected manual lookup and releases the submit state", async () => {
    const error = new Error("Lookup failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const getZrc20TokenDetails = vi
      .fn<ReturnType<typeof mockedStore>["qrlStore"]["getZrc20TokenDetails"]>()
      .mockRejectedValueOnce(error);
    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Token contract address" }),
      DISCOVERED_ADDRESS,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Fetch token details" }),
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "[ImportToken] Failed to fetch token details:",
        error,
      );
    });
    expect(getZrc20TokenDetails).toHaveBeenCalledWith(DISCOVERED_ADDRESS);
    expect(
      screen.getByRole("button", { name: "Fetch token details" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });
});
