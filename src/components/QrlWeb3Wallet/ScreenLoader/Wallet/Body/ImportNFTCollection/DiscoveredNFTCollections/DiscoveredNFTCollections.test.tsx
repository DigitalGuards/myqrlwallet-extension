import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverNftCollections } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveredNFTCollections from "./DiscoveredNFTCollections";

const CONTRACT_ADDRESS = `Q${"fedcba9876543210".repeat(8)}`;
const FINGERPRINT = "Qfedcba98...3210fedc...76543210";

vi.mock("@/services/assetDiscovery", () => ({
  discoverNftCollections: vi.fn(),
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getNFTCollectionsList: vi.fn().mockResolvedValue([]),
    setNFTCollectionsList: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("DiscoveredNFTCollections", () => {
  beforeEach(() => {
    vi.mocked(discoverNftCollections).mockResolvedValue([
      {
        address: CONTRACT_ADDRESS,
        name: "Test Collection",
        symbol: "NFT",
        standard: "ZRC721",
        tokenCount: 1,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the compact fingerprint for a discovered QIP-55 collection", async () => {
    render(
      <StoreProvider value={mockedStore()}>
        <MemoryRouter>
          <DiscoveredNFTCollections />
        </MemoryRouter>
      </StoreProvider>,
    );

    expect(await screen.findByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText(CONTRACT_ADDRESS)).toHaveClass("sr-only");
  });
});
