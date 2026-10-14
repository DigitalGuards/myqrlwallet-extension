import { mockedStore } from "@/__mocks__/mockedStore";
import { ROUTES } from "@/router/router";
import { StoreProvider, type StoreType } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NFTDetail from "../NFTDetail/NFTDetail";
import NFTTransfer from "../NFTTransfer/NFTTransfer";
import NFTGallery from "./NFTGallery";

const contractAddress = `Q${"a".repeat(128)}`;
const receiver = toChecksumAddress(`Q${"b".repeat(128)}`);
const captureDetailState = vi.fn<(state: unknown) => void>();

const DetailRoute = () => {
  const state: unknown = useLocation().state;
  captureDetailState(state);
  return <NFTDetail />;
};

const metadataCases = [
  { label: "omitted traits", attributes: undefined },
  { label: "empty traits", attributes: [] },
  {
    label: "labeled string traits",
    attributes: [{ trait_type: "Mood", value: "Happy" }],
  },
  { label: "generic string traits", attributes: [{ value: "Happy" }] },
  { label: "generic numeric traits", attributes: [{ value: 42 }] },
  {
    label: "mixed traits with display hints",
    attributes: [
      { trait_type: "Color", value: "red" },
      { value: "Happy" },
      { value: 0 },
      {
        display_type: "number",
        trait_type: "Generation",
        value: 2,
        max_value: 10,
      },
      { display_type: "date", trait_type: "Birthday", value: 1546360800 },
      { display_type: "boost_number", trait_type: "Power", value: 3 },
      { display_type: "boost_percentage", trait_type: "Stamina", value: 2.5 },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  captureDetailState.mockClear();
});

describe.each(["ZRC721", "ZRC1155"] as const)(
  "%s metadata compatibility",
  (standard) => {
    it.each(metadataCases)(
      "preserves $label through gallery, detail, transfer and history",
      async ({ attributes }) => {
        const metadata = {
          name: "Named NFT",
          description: "A token with optional trait labels",
          image: "ipfs://images/{id}.png",
          attributes,
        };
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
        vi.stubGlobal("fetch", fetch);
        const getOwnedNftTokens = vi
          .fn<StoreType["qrlStore"]["getOwnedNftTokens"]>()
          .mockResolvedValue({
            tokens: [{ tokenId: "7", balance: "1" }],
            failed: false,
          });
        const getNftTokenUri = vi
          .fn<StoreType["qrlStore"]["getNftTokenUri"]>()
          .mockResolvedValue("https://nft.example/7.json");
        const signNftTransfer = vi
          .fn<StoreType["qrlStore"]["signNftTransfer"]>()
          .mockResolvedValue({
            transactionHash: "0xtxhash",
            rawTransaction: "0xraw",
            error: "",
          });
        const addTransaction = vi
          .fn<StoreType["transactionHistoryStore"]["addTransaction"]>()
          .mockResolvedValue(undefined);
        const store = mockedStore({
          qrlStore: { getOwnedNftTokens, getNftTokenUri, signNftTransfer },
          transactionHistoryStore: { addTransaction },
        });
        render(
          <StoreProvider value={store}>
            <MemoryRouter
              initialEntries={[
                {
                  pathname: ROUTES.NFT_GALLERY,
                  state: {
                    contractAddress,
                    collectionName: "Collection",
                    standard,
                  },
                },
              ]}
            >
              <Routes>
                <Route path={ROUTES.NFT_GALLERY} element={<NFTGallery />} />
                <Route path={ROUTES.NFT_DETAIL} element={<DetailRoute />} />
                <Route path={ROUTES.NFT_TRANSFER} element={<NFTTransfer />} />
                <Route
                  path={ROUTES.TRANSACTION_HISTORY}
                  element={<div>History</div>}
                />
              </Routes>
            </MemoryRouter>
          </StoreProvider>,
        );

        const imagePath =
          standard === "ZRC1155"
            ? `images/${"7".padStart(64, "0")}.png`
            : "images/{id}.png";
        const imageUrl = `https://qrlwallet.com/api/ipfs/${imagePath}`;
        expect(
          await screen.findByRole("img", { name: metadata.name }),
        ).toHaveAttribute("src", imageUrl);
        expect(getOwnedNftTokens).toHaveBeenCalledWith(
          contractAddress,
          standard,
        );
        expect(getNftTokenUri).toHaveBeenCalledWith(
          contractAddress,
          "7",
          standard,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByText(metadata.name));

        expect(screen.getByText(metadata.name)).toBeInTheDocument();
        expect(
          screen.getByRole("img", { name: metadata.name }),
        ).toHaveAttribute("src", imageUrl);
        expect(screen.getByText(metadata.description)).toBeInTheDocument();
        for (const attribute of attributes ?? []) {
          expect(screen.getByText(String(attribute.value))).toBeInTheDocument();
        }
        expect(captureDetailState).toHaveBeenLastCalledWith({
          contractAddress,
          tokenId: "7",
          collectionName: "Collection",
          standard,
          balance: "1",
          imageUrl,
          metadata: { ...metadata, image: `ipfs://${imagePath}` },
        });

        await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
        expect(screen.getByText(metadata.name)).toBeInTheDocument();
        expect(
          screen.getByRole("img", { name: metadata.name }),
        ).toHaveAttribute("src", imageUrl);
        await userEvent.click(
          screen.getByRole("textbox", { name: "receiverAddress" }),
        );
        await userEvent.paste(receiver);
        await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));

        await waitFor(() => {
          expect(addTransaction).toHaveBeenCalledExactlyOnceWith(
            store.qrlStore.activeAccount.accountAddress,
            expect.objectContaining({
              tokenName: "Named NFT #7",
              tokenSymbol: "Collection",
              tokenContractAddress: contractAddress,
              pendingStatus: "pending",
            }),
          );
        });
        expect(signNftTransfer).toHaveBeenCalledExactlyOnceWith(
          store.qrlStore.activeAccount.accountAddress,
          receiver,
          "7",
          expect.any(String),
          contractAddress,
          standard,
          "1",
        );
        expect(await screen.findByText("History")).toBeInTheDocument();
      },
    );
  },
);
