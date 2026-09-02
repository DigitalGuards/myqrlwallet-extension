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
});
