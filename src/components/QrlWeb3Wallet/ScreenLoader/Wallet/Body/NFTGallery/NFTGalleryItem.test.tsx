import { mockedStore } from "@/__mocks__/mockedStore";
import { ROUTES } from "@/router/router";
import { StoreProvider } from "@/stores/store";
import { deferred } from "@/test-utils/deferred";
import { fetchMetadata } from "@/utilities/ipfsUtil";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NFTGalleryItem from "./NFTGalleryItem";

const { navigate } = vi.hoisted(() => ({
  navigate: vi.fn<NavigateFunction>(),
}));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));
vi.mock("@/utilities/ipfsUtil", async () => ({
  ...(await vi.importActual<typeof import("@/utilities/ipfsUtil")>(
    "@/utilities/ipfsUtil",
  )),
  fetchMetadata: vi.fn(),
}));

const contractAddress = `Q${"a".repeat(128)}`;
const props = { contractAddress, tokenId: "7", collectionName: "Collection" };
const renderItem = (store = mockedStore()) =>
  render(
    <StoreProvider value={store}>
      <MemoryRouter>
        <NFTGalleryItem {...props} standard="ZRC1155" balance="3" />
      </MemoryRouter>
    </StoreProvider>,
  );

describe("NFTGalleryItem", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(fetchMetadata).mockReset();
    navigate.mockReset();
  });

  it("preserves metadata, substitutes the 1155 image ID and tries gateways in order", async () => {
    const metadata = {
      name: "Token",
      description: "Description",
      image: "ipfs://images/{id}.png",
      attributes: [{ trait_type: "Level", value: 7 }],
    };
    vi.mocked(fetchMetadata).mockResolvedValue(metadata);
    const getNftTokenUri = vi.fn().mockResolvedValue("ipfs://metadata");
    renderItem(mockedStore({ qrlStore: { getNftTokenUri } }));

    const image = await screen.findByRole("img", { name: "Token" });
    const path = `images/${"7".padStart(64, "0")}.png`;
    expect(image).toHaveAttribute(
      "src",
      `https://qrlwallet.com/api/ipfs/${path}`,
    );
    expect(getNftTokenUri).toHaveBeenCalledWith(
      contractAddress,
      "7",
      "ZRC1155",
    );
    expect(fetchMetadata).toHaveBeenCalledWith("ipfs://metadata");
    expect(screen.getByText("×3")).toBeInTheDocument();
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `https://ipfs.io/ipfs/${path}`);
    fireEvent.click(screen.getByText("Token"));
    expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_DETAIL, {
      state: {
        ...props,
        standard: "ZRC1155",
        balance: "3",
        metadata: { ...metadata, image: `ipfs://${path}` },
        imageUrl: `https://ipfs.io/ipfs/${path}`,
      },
    });
    fireEvent.error(image);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the token fallback when metadata has malformed display fields", async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({
      name: { text: "Token" },
      image: 7,
    });
    const view = renderItem(
      mockedStore({
        qrlStore: {
          getNftTokenUri: vi.fn().mockResolvedValue("ipfs://metadata"),
        },
      }),
    );
    await waitFor(() => {
      expect(
        view.container.querySelector(".animate-pulse"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("#7"));
    expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_DETAIL, {
      state: {
        ...props,
        standard: "ZRC1155",
        balance: "3",
        metadata: null,
        imageUrl: "",
      },
    });
  });

  it("finishes loading when the token URI request rejects", async () => {
    const view = renderItem(
      mockedStore({
        qrlStore: {
          getNftTokenUri: vi.fn().mockRejectedValue(new Error("unavailable")),
        },
      }),
    );
    await waitFor(() => {
      expect(
        view.container.querySelector(".animate-pulse"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it("skips metadata fetching after unmount during the token URI request", async () => {
    const uri = deferred<string>();
    const view = renderItem(
      mockedStore({
        qrlStore: { getNftTokenUri: vi.fn().mockReturnValue(uri.promise) },
      }),
    );
    view.unmount();
    await act(async () => {
      uri.resolve("ipfs://old");
      await uri.promise;
    });
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it("ignores stale metadata after the token changes", async () => {
    const metadata = deferred<Record<string, unknown> | null>();
    vi.mocked(fetchMetadata)
      .mockReturnValueOnce(metadata.promise)
      .mockResolvedValueOnce({ name: "Current" });
    const store = mockedStore({
      qrlStore: {
        getNftTokenUri: vi.fn().mockResolvedValue("ipfs://metadata"),
      },
    });
    const view = renderItem(store);
    await waitFor(() => {
      expect(fetchMetadata).toHaveBeenCalledTimes(1);
    });
    view.rerender(
      <StoreProvider value={store}>
        <MemoryRouter>
          <NFTGalleryItem
            {...props}
            tokenId="8"
            standard="ZRC1155"
            balance="3"
          />
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(await screen.findByText("Current")).toBeInTheDocument();
    await act(async () => {
      metadata.resolve({ name: "Old" });
      await metadata.promise;
    });
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("reports rejected detail navigation", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    navigate.mockRejectedValueOnce(error);
    renderItem();
    fireEvent.click(screen.getByText("#7"));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to open NFT details:", error);
    });
  });
});
