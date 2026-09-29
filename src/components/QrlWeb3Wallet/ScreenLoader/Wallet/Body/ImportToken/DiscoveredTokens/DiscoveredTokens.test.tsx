import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverTokens } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveredTokens from "./DiscoveredTokens";

const CONTRACT_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;
const DISCOVERED = {
  address: CONTRACT_ADDRESS,
  name: "Test Token",
  symbol: "TEST",
  decimals: 18,
};

vi.mock("@/services/assetDiscovery", () => ({
  discoverTokens: vi.fn(),
  MAX_DISCOVERED_TOKENS: 50,
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getTokenContractsList: vi.fn().mockResolvedValue([]),
    setTokenContractsList: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("DiscoveredTokens", () => {
  const onReview = vi.fn().mockResolvedValue(undefined);

  const renderComponent = () =>
    render(
      <StoreProvider value={mockedStore()}>
        <MemoryRouter>
          <DiscoveredTokens onReview={onReview} />
        </MemoryRouter>
      </StoreProvider>,
    );

  beforeEach(() => {
    vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED]);
    vi.mocked(StorageUtil.getTokenContractsList).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists a discovered token with its contract address", async () => {
    renderComponent();

    expect(await screen.findByText(CONTRACT_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("Test Token")).toBeInTheDocument();
  });

  it("hands a picked token to the review screen instead of storing it directly", async () => {
    renderComponent();

    await userEvent.click(
      await screen.findByRole("button", { name: "Review Test Token" }),
    );

    await waitFor(() => expect(onReview).toHaveBeenCalledWith(DISCOVERED));
    expect(StorageUtil.setTokenContractsList).not.toHaveBeenCalled();
  });

  it("hides tokens the account already imported", async () => {
    vi.mocked(StorageUtil.getTokenContractsList).mockResolvedValue([
      {
        address: CONTRACT_ADDRESS.toUpperCase(),
        symbol: "TEST",
        decimals: 18,
        image: "",
      },
    ]);

    const { container } = renderComponent();

    await waitFor(() => expect(discoverTokens).toHaveBeenCalled());
    await waitFor(() =>
      expect(StorageUtil.getTokenContractsList).toHaveBeenCalled(),
    );
    expect(screen.queryByText(CONTRACT_ADDRESS)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
  it("says the list is capped when the explorer filled it", async () => {
    // A capped response means the account holds more than the picker can
    // show; a list that simply ends looks complete.
    vi.mocked(discoverTokens).mockResolvedValue(
      Array.from({ length: 50 }, (_unused, index) => ({
        ...DISCOVERED,
        address: `Q${index.toString(16).padStart(128, "0")}`,
        name: `Token ${index}`,
      })),
    );
    renderComponent();

    expect(
      await screen.findByText("Showing the first 50 found."),
    ).toBeInTheDocument();
  });

  it("says nothing about a cap for a short list", async () => {
    renderComponent();

    expect(await screen.findByText("Test Token")).toBeInTheDocument();
    expect(
      screen.queryByText("Showing the first 50 found."),
    ).not.toBeInTheDocument();
  });
});
