import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NFTGallery from "./NFTGallery";
import { deferred } from "@/test-utils/deferred";
import userEvent from "@testing-library/user-event";

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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    overrides: Parameters<typeof mockedStore>[0] = {},
    routeState: unknown = state,
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
        getOwnedNftTokens: vi
          .fn()
          .mockResolvedValue({ tokens: [], failed: false }),
      },
    });

    expect(
      await screen.findByText(
        "No NFTs found in this collection for this account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("TestCollection")).toBeInTheDocument();
  });

  it("should show empty state when no tokens owned", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi
          .fn()
          .mockResolvedValue({ tokens: [], failed: false }),
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("No NFTs found in this collection for this account."),
      ).toBeInTheDocument();
    });
  });

  it("should render gallery items for owned tokens", async () => {
    renderComponent({
      qrlStore: {
        getOwnedNftTokens: vi.fn().mockResolvedValue({
          tokens: [{ tokenId: "1" }, { tokenId: "2" }, { tokenId: "3" }],
          failed: false,
        }),
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("gallery-item-1")).toBeInTheDocument();
      expect(screen.getByTestId("gallery-item-2")).toBeInTheDocument();
      expect(screen.getByTestId("gallery-item-3")).toBeInTheDocument();
    });
  });

  it("should pass the route standard to the store and balances to items", async () => {
    const getOwnedNftTokens = vi.fn().mockResolvedValue({
      tokens: [{ tokenId: "42", balance: "3" }],
      failed: false,
    });
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
        getOwnedNftTokens: vi
          .fn()
          .mockResolvedValue({ tokens: [], failed: false }),
      },
    });

    expect(
      await screen.findByText(
        "No NFTs found in this collection for this account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });

  it.each([
    null,
    [],
    { ...state, contractAddress: 7 },
    { ...state, standard: "ZRC20" },
  ])(
    "rejects malformed route state %j before loading tokens",
    async (routeState) => {
      const getOwnedNftTokens = vi.fn();
      renderComponent({ qrlStore: { getOwnedNftTokens } }, routeState);

      expect(
        await screen.findByRole("button", { name: "Retry" }),
      ).toBeInTheDocument();
      expect(getOwnedNftTokens).not.toHaveBeenCalled();
    },
  );

  it("shows the load failure and retries after a rejected token request", async () => {
    const error = new Error("RPC unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const getOwnedNftTokens = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ tokens: [{ tokenId: "42" }], failed: false });
    renderComponent({ qrlStore: { getOwnedNftTokens } });

    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("gallery-item-42")).toBeInTheDocument();
    expect(getOwnedNftTokens).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith("Failed to load NFT gallery:", error);
  });

  it("ignores a token response after the active account changes", async () => {
    const pending = deferred<{
      tokens: { tokenId: string }[];
      failed: boolean;
    }>();
    const getOwnedNftTokens = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({
        tokens: [{ tokenId: "current" }],
        failed: false,
      });
    const view = renderComponent({ qrlStore: { getOwnedNftTokens } });
    view.rerender(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            getOwnedNftTokens,
            activeAccount: { accountAddress: `Q${"b".repeat(128)}` },
          },
        })}
      >
        <MemoryRouter initialEntries={[{ pathname: "/nft-gallery", state }]}>
          <NFTGallery />
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(
      await screen.findByTestId("gallery-item-current"),
    ).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ tokens: [{ tokenId: "old" }], failed: false });
      await pending.promise;
    });
    expect(screen.queryByTestId("gallery-item-old")).not.toBeInTheDocument();
    expect(screen.getByTestId("gallery-item-current")).toBeInTheDocument();
  });
});
