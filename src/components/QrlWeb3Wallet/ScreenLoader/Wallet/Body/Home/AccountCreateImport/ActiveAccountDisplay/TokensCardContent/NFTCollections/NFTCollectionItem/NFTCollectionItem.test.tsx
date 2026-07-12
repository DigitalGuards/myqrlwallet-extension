import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import NFTCollectionItem from "./NFTCollectionItem";

const { mockClearFromNFTCollectionsList } = vi.hoisted(() => ({
  mockClearFromNFTCollectionsList: vi.fn<any>().mockResolvedValue(undefined),
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    clearFromNFTCollectionsList: (...args: any[]) =>
      mockClearFromNFTCollectionsList(...args),
  },
}));

describe("NFTCollectionItem", () => {
  beforeAll(() => {
    // Radix menus focus items via scrollIntoView, which jsdom lacks.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    mockClearFromNFTCollectionsList.mockClear();
  });

  const contractAddress = "Q705046e6A6E159eD6ACedE46A36CAD6D449C80A1";

  const storeWithCollection = () =>
    mockedStore({
      qrlStore: {
        getNftCollectionDetails: (async () => ({
          collection: {
            name: "Test Collection",
            symbol: "TST",
            standard: "ZRC721",
            balance: 3,
          },
          error: "",
        })) as any,
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

  it("should open the remove confirmation instead of navigating when Remove Collection is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Test Collection");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove Collection" }),
    );

    // Regression: the menu click used to bubble to the card's onClick and
    // navigate into the gallery, unmounting the confirm dialog.
    expect(screen.queryByText("Gallery route")).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        "Remove 'Test Collection' collection from wallet?",
      ),
    ).toBeInTheDocument();
  });

  it("should remove the collection when the removal is confirmed", async () => {
    const user = userEvent.setup();
    const { triggerReRender } = renderComponent();

    await screen.findByText("Test Collection");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove Collection" }),
    );
    await user.click(await screen.findByRole("button", { name: "Yes" }));

    expect(mockClearFromNFTCollectionsList).toHaveBeenCalledWith(
      "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
      contractAddress,
    );
    expect(triggerReRender).toHaveBeenCalled();
    expect(screen.queryByText("Gallery route")).not.toBeInTheDocument();
  });
});
