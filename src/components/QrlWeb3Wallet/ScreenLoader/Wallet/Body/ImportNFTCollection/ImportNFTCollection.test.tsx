import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportNFTCollection from "./ImportNFTCollection";

const CONTRACT_ADDRESS = `Q${"b".repeat(128)}`;
vi.mock("@/services/assetDiscovery", () => ({
  discoverNftCollections: vi.fn().mockResolvedValue([]),
  MAX_DISCOVERED_COLLECTIONS: 50,
}));
vi.mock("@/utilities/storageUtil", () => ({
  default: { getNFTCollectionsList: vi.fn().mockResolvedValue([]) },
}));

describe("ImportNFTCollection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    getNftCollectionDetails: ReturnType<
      typeof mockedStore
    >["qrlStore"]["getNftCollectionDetails"],
  ) =>
    render(
      <StoreProvider
        value={mockedStore({ qrlStore: { getNftCollectionDetails } })}
      >
        <MemoryRouter>
          <ImportNFTCollection />
        </MemoryRouter>
      </StoreProvider>,
    );

  const submitAddress = async () => {
    await userEvent.type(
      screen.getByRole("textbox", { name: "contractAddress" }),
      CONTRACT_ADDRESS,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Detect collection" }),
    );
  };

  it("opens the review screen after a successful lookup", async () => {
    const lookup = vi
      .fn<
        ReturnType<typeof mockedStore>["qrlStore"]["getNftCollectionDetails"]
      >()
      .mockResolvedValue({
        collection: {
          name: "Test Collection",
          symbol: "NFT",
          standard: "ZRC721",
          balance: 2,
        },
        error: "",
      });
    renderComponent(lookup);
    await submitAddress();
    expect(lookup).toHaveBeenCalledWith(CONTRACT_ADDRESS);
    expect(await screen.findByText("Test Collection")).toBeInTheDocument();
    expect(screen.getByText("ZRC-721")).toBeInTheDocument();
  });

  it("keeps the lookup error on the contract address field", async () => {
    const lookup = vi
      .fn<
        ReturnType<typeof mockedStore>["qrlStore"]["getNftCollectionDetails"]
      >()
      .mockResolvedValue({ error: "Invalid collection" });
    renderComponent(lookup);
    await submitAddress();
    expect(await screen.findByText("Invalid collection")).toBeInTheDocument();
  });

  it("reports a rejected lookup and releases the submit state", async () => {
    const error = new Error("Lookup failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const lookup = vi
      .fn<
        ReturnType<typeof mockedStore>["qrlStore"]["getNftCollectionDetails"]
      >()
      .mockRejectedValueOnce(error);
    renderComponent(lookup);
    await submitAddress();
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "[ImportNFTCollection] Failed to fetch collection details:",
        error,
      );
    });
    expect(
      screen.getByRole("button", { name: "Detect collection" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });
});
