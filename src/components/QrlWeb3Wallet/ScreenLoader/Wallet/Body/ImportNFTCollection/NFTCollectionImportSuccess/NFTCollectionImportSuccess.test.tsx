import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import type StorageUtil from "@/utilities/storageUtil";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NFTCollectionImportSuccess from "./NFTCollectionImportSuccess";

const CONTRACT_ADDRESS = `Q${"a".repeat(128)}`;
const { navigate, setNFTCollectionsList } = vi.hoisted(() => ({
  navigate: vi.fn<NavigateFunction>(),
  setNFTCollectionsList: vi
    .fn<typeof StorageUtil.setNFTCollectionsList>()
    .mockResolvedValue(undefined),
}));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));
vi.mock("@/utilities/storageUtil", () => ({
  default: { setNFTCollectionsList },
}));

describe("NFTCollectionImportSuccess", () => {
  const renderComponent = (store = mockedStore()) =>
    render(
      <StoreProvider value={store}>
        <MemoryRouter>
          <NFTCollectionImportSuccess
            contractAddress={CONTRACT_ADDRESS}
            onCancelImport={() => {}}
            collection={{
              name: "Collection",
              symbol: "NFT",
              standard: "ZRC1155",
            }}
          />
        </MemoryRouter>
      </StoreProvider>,
    );

  afterEach(() => {
    cleanup();
    navigate.mockReset();
    setNFTCollectionsList.mockReset().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("stores the same collection values before navigating home", async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setNFTCollectionsList.mockReturnValueOnce(pending);
    const store = mockedStore();
    renderComponent(store);
    expect(screen.getByText("ZRC-1155")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(setNFTCollectionsList).toHaveBeenCalledExactlyOnceWith(
      store.qrlStore.activeAccount.accountAddress,
      {
        address: CONTRACT_ADDRESS,
        name: "Collection",
        symbol: "NFT",
        standard: "ZRC1155",
        image: "",
      },
    );
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["storage", "navigation"])(
    "reports a rejected %s operation",
    async (operation) => {
      const error = new Error("Import failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (operation === "storage")
        setNFTCollectionsList.mockRejectedValueOnce(error);
      else navigate.mockRejectedValueOnce(error);
      renderComponent();
      await userEvent.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[NFTCollectionImportSuccess] Failed to import collection:",
          error,
        );
      });
      expect(setNFTCollectionsList).toHaveBeenCalledTimes(1);
      if (operation === "storage") expect(navigate).not.toHaveBeenCalled();
    },
  );
});
