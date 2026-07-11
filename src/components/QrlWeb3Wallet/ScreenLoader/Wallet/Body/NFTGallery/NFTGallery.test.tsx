import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NFTGallery from "./NFTGallery";

vi.mock("./NFTGalleryItem", () => {
  const MockNFTGalleryItem = ({
    tokenId,
    balance,
  }: {
    tokenId: string;
    balance?: string;
  }) => (
    <div data-testid={`gallery-item-${tokenId}`}>
      Token #{tokenId}
      {balance ? ` x${balance}` : ""}
    </div>
  );
  MockNFTGalleryItem.displayName = "MockNFTGalleryItem";
  return { __esModule: true, default: MockNFTGalleryItem };
});

const state = {
  contractAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
  collectionName: "TestCollection",
};

describe("NFTGallery", () => {
  afterEach(cleanup);

  const renderComponent = (
    overrides = {},
    routeState: Record<string, unknown> = state,
  ) =>
    render(
      <StoreProvider value={mockedStore(overrides)}>
        <MemoryRouter
          initialEntries={[{ pathname: "/nft-gallery", state: routeState }]}
        >
          <NFTGallery />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render collection name as title", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi.fn<any>().mockResolvedValue([]),
      },
    });

    expect(screen.getByText("TestCollection")).toBeInTheDocument();
  });

  it("should show empty state when no tokens owned", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi.fn<any>().mockResolvedValue([]),
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "No NFTs found in this collection for this account.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("should render gallery items for owned tokens", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi
          .fn<any>()
          .mockResolvedValue([
            { tokenId: "1" },
            { tokenId: "2" },
            { tokenId: "3" },
          ]),
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("gallery-item-1")).toBeInTheDocument();
      expect(screen.getByTestId("gallery-item-2")).toBeInTheDocument();
      expect(screen.getByTestId("gallery-item-3")).toBeInTheDocument();
    });
  });

  it("should pass the route standard to the store and balances to items", async () => {
    const getOwnedNftTokens = vi
      .fn<any>()
      .mockResolvedValue([{ tokenId: "42", balance: "3" }]);
    renderComponent(
      { qrlStore: { getOwnedNftTokens } },
      { ...state, standard: "ZRC1155" },
    );

    await waitFor(() => {
      expect(screen.getByTestId("gallery-item-42")).toHaveTextContent("x3");
    });
    expect(getOwnedNftTokens).toHaveBeenCalledWith(
      state.contractAddress,
      "ZRC1155",
    );
  });

  it("should have a back button", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi.fn<any>().mockResolvedValue([]),
      },
    });

    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });
});
