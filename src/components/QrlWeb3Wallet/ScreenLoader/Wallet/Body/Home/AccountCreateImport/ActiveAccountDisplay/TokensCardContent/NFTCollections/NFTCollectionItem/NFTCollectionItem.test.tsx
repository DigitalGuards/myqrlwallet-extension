import type StorageUtil from "@/utilities/storageUtil";
import type QrlStore from "@/stores/qrlStore";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import NFTCollectionItem from "./NFTCollectionItem";

const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const CONTRACT_ADDRESS = `Q${"c".repeat(128)}`;

const { mockClearFromNFTCollectionsList } = vi.hoisted(() => ({
  mockClearFromNFTCollectionsList: vi
    .fn<typeof StorageUtil.clearFromNFTCollectionsList>()
    .mockResolvedValue(undefined),
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    clearFromNFTCollectionsList: mockClearFromNFTCollectionsList,
  },
}));

describe("NFTCollectionItem", () => {
  beforeAll(() => {
    // Radix menus focus items via scrollIntoView, which jsdom lacks.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockClearFromNFTCollectionsList.mockClear();
  });

  const contractAddress = CONTRACT_ADDRESS;

  const storeWithCollection = () =>
    mockedStore({
      qrlStore: {
        getNftCollectionDetails: () =>
          Promise.resolve({
            collection: {
              name: "Test Collection",
              symbol: "TST",
              standard: "ZRC721" as const,
              balance: 3,
            },
            error: "",
          }),
      },
    });

  const renderComponent = (triggerReRender = vi.fn()) => {
    render(
      <StoreProvider value={storeWithCollection()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={
                <NFTCollectionItem
                  contractAddress={contractAddress}
                  storedStandard="ZRC721"
                  triggerReRender={triggerReRender}
                />
              }
            />
            <Route path="/nft-gallery" element={<div>Gallery route</div>} />
          </Routes>
        </MemoryRouter>
      </StoreProvider>,
    );
    return { triggerReRender };
  };

  it("should navigate to the gallery when the row is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(await screen.findByText("Test Collection"));

    expect(await screen.findByText("Gallery route")).toBeInTheDocument();
  });

  it("pluralises the owned-NFT count", async () => {
    renderComponent();

    expect(await screen.findByText("3 NFTs")).toBeInTheDocument();
  });

  it("uses the singular owned-NFT form for a single NFT", async () => {
    render(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            getNftCollectionDetails: () =>
              Promise.resolve({
                collection: {
                  name: "Test Collection",
                  symbol: "TST",
                  standard: "ZRC721" as const,
                  balance: 1,
                },
                error: "",
              }),
          },
        })}
      >
        <MemoryRouter>
          <NFTCollectionItem contractAddress={contractAddress} />
        </MemoryRouter>
      </StoreProvider>,
    );

    expect(await screen.findByText("1 NFT")).toBeInTheDocument();
  });

  it("uses the shared fingerprint for a nameless collection row", async () => {
    render(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            getNftCollectionDetails: () =>
              Promise.resolve({
                collection: {
                  name: "",
                  symbol: "",
                  standard: "ZRC721" as const,
                  balance: 1,
                },
                error: "",
              }),
          },
        })}
      >
        <MemoryRouter>
          <NFTCollectionItem contractAddress={contractAddress} />
        </MemoryRouter>
      </StoreProvider>,
    );

    expect(
      await screen.findByText(formatQrlAddressFingerprint(contractAddress)),
    ).toBeInTheDocument();
  });

  it("should open the hide confirmation instead of navigating when Hide Collection is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Test Collection");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Hide Collection" }),
    );

    // Regression: the menu click used to bubble to the card's onClick and
    // navigate into the gallery, unmounting the confirm dialog.
    expect(screen.queryByText("Gallery route")).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        "Do you want to hide the 'Test Collection' collection from wallet?",
      ),
    ).toBeInTheDocument();
  });

  it("should hide the collection when the action is confirmed", async () => {
    const user = userEvent.setup();
    const { triggerReRender } = renderComponent();

    await screen.findByText("Test Collection");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Hide Collection" }),
    );
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    expect(mockClearFromNFTCollectionsList).toHaveBeenCalledWith(
      ACTIVE_ACCOUNT,
      contractAddress,
    );
    expect(triggerReRender).toHaveBeenCalled();
    expect(screen.queryByText("Gallery route")).not.toBeInTheDocument();
  });

  it("reports a rejected collection hide without refreshing the list", async () => {
    const error = new Error("Collection storage unavailable");
    mockClearFromNFTCollectionsList.mockRejectedValueOnce(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const { triggerReRender } = renderComponent();
    await screen.findByText("Test Collection");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Hide Collection" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to hide NFT collection:",
        error,
      );
    });
    expect(triggerReRender).not.toHaveBeenCalled();
  });

  it("reports an unexpected collection details rejection", async () => {
    const error = new Error("Collection lookup failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const getNftCollectionDetails = vi
      .fn<QrlStore["getNftCollectionDetails"]>()
      .mockRejectedValue(error);
    render(
      <StoreProvider
        value={mockedStore({ qrlStore: { getNftCollectionDetails } })}
      >
        <MemoryRouter>
          <NFTCollectionItem contractAddress={contractAddress} />
        </MemoryRouter>
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to load NFT collection:",
        error,
      );
    });
  });

  it("ignores a previous account's delayed collection details", async () => {
    type Details = Awaited<ReturnType<QrlStore["getNftCollectionDetails"]>>;
    let finish: ((details: Details) => void) | undefined;
    const pending = new Promise<Details>((resolve) => {
      finish = resolve;
    });
    const getNftCollectionDetails = vi
      .fn<QrlStore["getNftCollectionDetails"]>()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({
        collection: {
          name: "Current collection",
          symbol: "CUR",
          balance: 1,
          standard: "ZRC721",
        },
        error: "",
      });
    const viewFor = (address: string) => (
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            activeAccount: { accountAddress: address },
            getNftCollectionDetails,
          },
        })}
      >
        <MemoryRouter>
          <NFTCollectionItem contractAddress={contractAddress} />
        </MemoryRouter>
      </StoreProvider>
    );
    const view = render(viewFor(ACTIVE_ACCOUNT));
    view.rerender(viewFor(`Q${"b".repeat(128)}`));
    await screen.findByText("Current collection");
    await act(async () => {
      finish?.({
        collection: {
          name: "Old collection",
          symbol: "OLD",
          balance: 9,
          standard: "ZRC721",
        },
        error: "",
      });
      await pending;
    });
    expect(screen.getByText("Current collection")).toBeInTheDocument();
    expect(screen.queryByText("Old collection")).not.toBeInTheDocument();
  });

  it("ignores a previous account's delayed ZRC1155 ownership count", async () => {
    type Owned = Awaited<ReturnType<QrlStore["getOwnedNftTokens"]>>;
    let finish: ((owned: Owned) => void) | undefined;
    const pending = new Promise<Owned>((resolve) => {
      finish = resolve;
    });
    const getNftCollectionDetails = vi
      .fn<QrlStore["getNftCollectionDetails"]>()
      .mockResolvedValue({
        collection: { name: "Collection", symbol: "COL", standard: "ZRC1155" },
        error: "",
      });
    const getOwnedNftTokens = vi
      .fn<QrlStore["getOwnedNftTokens"]>()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ tokens: [{ tokenId: "1" }], failed: false });
    const viewFor = (address: string) => (
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            qrlConnection: { blockchain: { chainId: "0x301825" } },
            activeAccount: { accountAddress: address },
            getNftCollectionDetails,
            getOwnedNftTokens,
          },
        })}
      >
        <MemoryRouter>
          <NFTCollectionItem contractAddress={contractAddress} />
        </MemoryRouter>
      </StoreProvider>
    );
    const view = render(viewFor(ACTIVE_ACCOUNT));
    await waitFor(() => {
      expect(getOwnedNftTokens).toHaveBeenCalledTimes(1);
    });
    view.rerender(viewFor(`Q${"b".repeat(128)}`));
    await screen.findByText("1 NFT");
    await act(async () => {
      finish?.({ tokens: [{ tokenId: "2" }, { tokenId: "3" }], failed: false });
      await pending;
    });
    expect(screen.getByText("1 NFT")).toBeInTheDocument();
    expect(screen.queryByText("2 NFTs")).not.toBeInTheDocument();
  });
});
