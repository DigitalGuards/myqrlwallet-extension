import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NFTCollections from "./NFTCollections";

const { mockGetNFTCollectionsList } = vi.hoisted(() => ({
  mockGetNFTCollectionsList: vi.fn<any>().mockResolvedValue([]),
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getNFTCollectionsList: (...args: any[]) =>
      mockGetNFTCollectionsList(...args),
  },
}));

vi.mock("./NFTCollectionItem/NFTCollectionItem", () => {
  const MockItem = ({ contractAddress }: { contractAddress: string }) => (
    <div data-testid={`collection-${contractAddress}`}>{contractAddress}</div>
  );
  MockItem.displayName = "MockNFTCollectionItem";
  return { __esModule: true, default: MockItem };
});

describe("NFTCollections", () => {
  afterEach(() => {
    cleanup();
    mockGetNFTCollectionsList.mockReset();
  });

  const renderComponent = (
    shouldDisplayAllCollections = false,
    onCountChange?: (count: number) => void,
  ) =>
    render(
      <StoreProvider value={mockedStore()}>
        <MemoryRouter>
          <NFTCollections
            shouldDisplayAllCollections={shouldDisplayAllCollections}
            onCountChange={onCountChange}
          />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render nothing when no collections stored", async () => {
    mockGetNFTCollectionsList.mockResolvedValue([]);
    const { container } = renderComponent();

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid^='collection-']"),
      ).toHaveLength(0);
    });
  });

  it("should render collection items", async () => {
    mockGetNFTCollectionsList.mockResolvedValue([
      {
        address: "0xABC",
        name: "Col1",
        symbol: "C1",
        standard: "ZRC721",
        image: "",
      },
      {
        address: "0xDEF",
        name: "Col2",
        symbol: "C2",
        standard: "ZRC721",
        image: "",
      },
    ]);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("collection-0xABC")).toBeInTheDocument();
      expect(screen.getByTestId("collection-0xDEF")).toBeInTheDocument();
    });
  });

  it("should respect the display limit of 4", async () => {
    const collections = Array.from({ length: 6 }, (_, i) => ({
      address: `0x${i}`,
      name: `Col${i}`,
      symbol: `C${i}`,
      standard: "ZRC721" as const,
      image: "",
    }));
    mockGetNFTCollectionsList.mockResolvedValue(collections);

    const { container } = renderComponent();

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid^='collection-']"),
      ).toHaveLength(4);
    });
  });

  it("should display every collection when shouldDisplayAllCollections is set", async () => {
    const collections = Array.from({ length: 6 }, (_, i) => ({
      address: `0x${i}`,
      name: `Col${i}`,
      symbol: `C${i}`,
      standard: "ZRC721" as const,
      image: "",
    }));
    mockGetNFTCollectionsList.mockResolvedValue(collections);

    const { container } = renderComponent(true);

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-testid^='collection-']"),
      ).toHaveLength(6);
    });
  });

  it("should show an empty state on the all-collections view when none are stored", async () => {
    mockGetNFTCollectionsList.mockResolvedValue([]);

    renderComponent(true);

    expect(
      await screen.findByText("There are no NFT collections."),
    ).toBeInTheDocument();
  });

  it("should not show the empty state before the storage read resolves", async () => {
    let resolveStorage: (value: unknown[]) => void = () => {};
    mockGetNFTCollectionsList.mockReturnValue(
      new Promise((resolve) => {
        resolveStorage = resolve;
      }),
    );

    renderComponent(true);

    expect(
      screen.queryByText("There are no NFT collections."),
    ).not.toBeInTheDocument();

    resolveStorage([]);
    expect(
      await screen.findByText("There are no NFT collections."),
    ).toBeInTheDocument();
  });

  it("should report the stored collection count after each fetch", async () => {
    const onCountChange = vi.fn();
    mockGetNFTCollectionsList.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        address: `0x${i}`,
        name: `Col${i}`,
        symbol: `C${i}`,
        standard: "ZRC721" as const,
        image: "",
      })),
    );

    renderComponent(false, onCountChange);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(6);
    });
  });
});
