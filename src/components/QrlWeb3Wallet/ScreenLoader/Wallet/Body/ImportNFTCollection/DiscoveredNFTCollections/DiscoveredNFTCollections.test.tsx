import { mockedStore } from "@/__mocks__/mockedStore";
import {
  discoverNftCollections,
  type DiscoveredNFTCollection,
} from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import type StorageUtil from "@/utilities/storageUtil";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveredNFTCollections from "./DiscoveredNFTCollections";

const CONTRACT_ADDRESS = `Q${"fedcba9876543210".repeat(8)}`;
const FINGERPRINT = "Qfedcba98...3210fedc...76543210";
const DISCOVERED: DiscoveredNFTCollection = {
  address: CONTRACT_ADDRESS,
  name: "Test Collection",
  symbol: "NFT",
  standard: "ZRC721",
  tokenCount: 1,
};

const { navigate, getNFTCollectionsList, setNFTCollectionsList } = vi.hoisted(
  () => ({
    navigate: vi.fn<NavigateFunction>(),
    getNFTCollectionsList: vi.fn<typeof StorageUtil.getNFTCollectionsList>(),
    setNFTCollectionsList: vi.fn<typeof StorageUtil.setNFTCollectionsList>(),
  }),
);
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));

vi.mock("@/services/assetDiscovery", () => ({
  discoverNftCollections: vi.fn(),
  MAX_DISCOVERED_COLLECTIONS: 50,
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getNFTCollectionsList,
    setNFTCollectionsList,
  },
}));

describe("DiscoveredNFTCollections", () => {
  beforeEach(() => {
    vi.mocked(discoverNftCollections)
      .mockReset()
      .mockResolvedValue([DISCOVERED]);
    getNFTCollectionsList.mockReset().mockResolvedValue([]);
    setNFTCollectionsList.mockReset().mockResolvedValue(undefined);
    navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const component = (accountAddress = `Q${"a".repeat(128)}`) => (
    <StoreProvider
      value={mockedStore({ qrlStore: { activeAccount: { accountAddress } } })}
    >
      <MemoryRouter>
        <DiscoveredNFTCollections />
      </MemoryRouter>
    </StoreProvider>
  );

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

  it.each(["discovery", "storage"])(
    "reports a rejected %s read",
    async (source) => {
      const error = new Error("Read failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (source === "discovery")
        vi.mocked(discoverNftCollections).mockRejectedValueOnce(error);
      else getNFTCollectionsList.mockRejectedValueOnce(error);
      const { container } = render(component());
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[DiscoveredNFTCollections] Failed to load collections:",
          error,
        );
      });
      expect(container).toBeEmptyDOMElement();
      expect(setNFTCollectionsList).not.toHaveBeenCalled();
    },
  );

  it.each(["storage", "navigation"])(
    "reports a rejected %s operation and releases the selection",
    async (operation) => {
      const error = new Error("Import failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (operation === "storage")
        setNFTCollectionsList.mockRejectedValueOnce(error);
      else navigate.mockRejectedValueOnce(error);
      render(component());
      await userEvent.click(await screen.findByRole("checkbox"));
      await userEvent.click(
        screen.getByRole("button", { name: "Add selected (1)" }),
      );
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[DiscoveredNFTCollections] Failed to import collections:",
          error,
        );
      });
      expect(screen.getByRole("checkbox")).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Add selected (1)" }),
      ).toBeEnabled();
      expect(setNFTCollectionsList).toHaveBeenCalledTimes(1);
      if (operation === "storage") expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("stores selected collections in display order before navigating", async () => {
    const second = {
      ...DISCOVERED,
      address: `Q${"b".repeat(128)}`,
      name: "Second",
    };
    vi.mocked(discoverNftCollections).mockResolvedValueOnce([
      DISCOVERED,
      second,
    ]);
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setNFTCollectionsList.mockReturnValueOnce(pending);
    render(component());
    const checkboxes = await screen.findAllByRole("checkbox");
    await userEvent.click(checkboxes[1]);
    await userEvent.click(checkboxes[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Add selected (2)" }),
    );
    expect(setNFTCollectionsList).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(setNFTCollectionsList).toHaveBeenNthCalledWith(
      1,
      `Q${"a".repeat(128)}`,
      {
        address: CONTRACT_ADDRESS,
        name: "Test Collection",
        symbol: "NFT",
        standard: "ZRC721",
        image: "",
      },
    );
    expect(setNFTCollectionsList).toHaveBeenNthCalledWith(
      2,
      `Q${"a".repeat(128)}`,
      {
        address: second.address,
        name: "Second",
        symbol: "NFT",
        standard: "ZRC721",
        image: "",
      },
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("ignores a late response for the previous account", async () => {
    let finish = (_collections: DiscoveredNFTCollection[]) => {};
    const pending = new Promise<DiscoveredNFTCollection[]>((resolve) => {
      finish = resolve;
    });
    vi.mocked(discoverNftCollections)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce([
        {
          ...DISCOVERED,
          name: "Current Collection",
          address: `Q${"b".repeat(128)}`,
        },
      ]);
    const { rerender } = render(component());
    rerender(component(`Q${"c".repeat(128)}`));
    expect(await screen.findByText("Current Collection")).toBeInTheDocument();
    await act(async () => {
      finish([DISCOVERED]);
      await pending;
    });
    expect(screen.getByText("Current Collection")).toBeInTheDocument();
    expect(screen.queryByText("Test Collection")).not.toBeInTheDocument();
  });
});
