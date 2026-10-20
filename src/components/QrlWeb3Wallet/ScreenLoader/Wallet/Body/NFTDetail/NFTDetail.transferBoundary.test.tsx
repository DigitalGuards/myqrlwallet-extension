import { mockedStore } from "@/__mocks__/mockedStore";
import { ROUTES } from "@/router/router";
import QrlStore from "@/stores/qrlStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import {
  invalidNftTransferFields,
  validNftTokenIds,
} from "@/test-utils/nftTransferCases";
import type { NFTStandard } from "@/types/nft";
import { isRecord } from "@/utilities/storageGuards";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Web3 from "@theqrl/web3";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { Router, type NavigateOptions, type To } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NFTTransfer from "../NFTTransfer/NFTTransfer";
import NFTDetail from "./NFTDetail";

const { navigate, safeTransferFrom, signTransaction } = vi.hoisted(() => ({
  navigate: vi.fn<(to: To | number, options?: NavigateOptions) => void>(),
  safeTransferFrom: vi.fn<
    (...args: unknown[]) => {
      estimateGas: () => Promise<bigint>;
      encodeABI: () => string;
    }
  >(),
  signTransaction: vi.fn<
    (
      transaction: unknown,
      seed: string,
    ) => Promise<{
      transactionHash: string;
      rawTransaction: string;
    }>
  >(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));
vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  class Contract {
    methods = { safeTransferFrom };
  }
  return {
    ...actual,
    default: class {
      qrl = {
        Contract,
        getTransactionCount: () => Promise.resolve(7n),
        accounts: { signTransaction },
      };
    },
  };
});

const details = {
  contractAddress: `Q${"a".repeat(128)}`,
  tokenId: "42",
  collectionName: "Collection",
  imageUrl: "https://example.test/nft.png",
  metadata: { name: "NFT #42" },
  balance: "2",
};
const receiver = toChecksumAddress(`Q${"c".repeat(128)}`);
const optionalFields = [
  ...["collectionName", "imageUrl"].flatMap((field) =>
    [undefined, null, ""].map((value) => ({ field, value })),
  ),
  ...[undefined, null].map((value) => ({ field: "standard", value })),
  ...[undefined, "", "0", "2"].map((value) => ({ field: "balance", value })),
];

const renderState = (
  state: unknown,
  store: StoreType,
  component = <NFTDetail />,
) =>
  render(
    <StoreProvider value={store}>
      <Router
        location={{ pathname: "/nft-detail", state }}
        navigator={{
          createHref: () => "/nft-detail",
          go: vi.fn(),
          push: vi.fn(),
          replace: vi.fn(),
        }}
      >
        {component}
      </Router>
    </StoreProvider>,
  );

const signingHarness = () => {
  const signingStore = new QrlStore();
  signingStore.qrlInstance = new Web3().qrl;
  const signNftTransfer = vi.fn<StoreType["qrlStore"]["signNftTransfer"]>(
    (...args) => signingStore.signNftTransfer(...args),
  );
  const sendRawTransaction = vi
    .fn<StoreType["qrlStore"]["sendRawTransaction"]>()
    .mockResolvedValue(undefined);
  const getErc1155TokenBalance = vi
    .fn<StoreType["qrlStore"]["getErc1155TokenBalance"]>()
    .mockResolvedValue(undefined);
  const getMnemonicPhrases = vi
    .fn<StoreType["lockStore"]["getMnemonicPhrases"]>()
    .mockResolvedValue("test mnemonic");
  const addTransaction = vi
    .fn<StoreType["transactionHistoryStore"]["addTransaction"]>()
    .mockResolvedValue(undefined);
  const store = mockedStore({
    qrlStore: { signNftTransfer, sendRawTransaction, getErc1155TokenBalance },
    lockStore: { getMnemonicPhrases },
    transactionHistoryStore: { addTransaction },
  });
  return {
    store,
    signNftTransfer,
    sendRawTransaction,
    getErc1155TokenBalance,
    getMnemonicPhrases,
    addTransaction,
  };
};

describe("NFT transaction fields stay separate from display defaults", () => {
  beforeEach(() => {
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(
      undefined,
    );
    vi.spyOn(QrlStore.prototype, "getGasFeeData").mockResolvedValue({
      baseFeePerGas: 1n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 2n,
    });
    safeTransferFrom.mockReturnValue({
      estimateGas: () => Promise.resolve(90000n),
      encodeABI: () => "0xencoded",
    });
    signTransaction.mockResolvedValue({
      transactionHash: "0xtest",
      rawTransaction: "0xraw",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe.each<NFTStandard>(["ZRC721", "ZRC1155"])("%s", (standard) => {
    it.each(invalidNftTransferFields)(
      "blocks detail navigation and direct transfer submission for $label",
      async ({ field, value }) => {
        const state = { ...details, standard, [field]: value };
        const original = structuredClone(state);
        const harness = signingHarness();
        renderState(state, harness.store);
        expect(
          screen.getByRole("heading", { name: details.metadata.name }),
        ).toBeInTheDocument();
        const detailSend = screen.getByRole("button", { name: "Send NFT" });
        expect(detailSend).toBeDisabled();
        fireEvent.click(detailSend);
        expect(navigate).not.toHaveBeenCalled();

        cleanup();
        renderState(
          { ...state, nftName: details.metadata.name },
          harness.store,
          <NFTTransfer />,
        );
        const send = screen.getByRole("button", { name: "Send NFT" });
        const form = send.closest("form");
        if (!form) throw new Error("Expected the NFT transfer form");
        await act(() => {
          fireEvent.change(
            screen.getByRole("textbox", { name: "receiverAddress" }),
            { target: { value: receiver } },
          );
          fireEvent.submit(form);
          return Promise.resolve();
        });
        expect(send).toBeDisabled();
        expect(harness.getMnemonicPhrases).not.toHaveBeenCalled();
        expect(harness.getErc1155TokenBalance).not.toHaveBeenCalled();
        expect(harness.signNftTransfer).not.toHaveBeenCalled();
        expect(safeTransferFrom).not.toHaveBeenCalled();
        expect(signTransaction).not.toHaveBeenCalled();
        expect(harness.sendRawTransaction).not.toHaveBeenCalled();
        expect(harness.addTransaction).not.toHaveBeenCalled();
        expect(state).toStrictEqual(original);
      },
    );

    it.each(validNftTokenIds)(
      "preserves token ID %s through navigation, signing and history",
      async (tokenId) => {
        const state = { ...details, standard, tokenId };
        const original = structuredClone(state);
        const harness = signingHarness();
        renderState(state, harness.store);
        const detailSend = screen.getByRole("button", { name: "Send NFT" });
        expect(detailSend).toBeEnabled();
        fireEvent.click(detailSend);
        // origin/dev forwards these strings verbatim, then signs BigInt(tokenId).
        const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
        expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_TRANSFER, {
          state: {
            contractAddress: details.contractAddress,
            tokenId,
            standard,
            balance: details.balance,
            collectionName: details.collectionName,
            imageUrl: details.imageUrl,
            nftName: details.metadata.name,
          },
        });
        if (!isRecord(transferState))
          throw new Error("Expected transfer state");
        expect(transferState.tokenId).toBe(tokenId);
        cleanup();
        await act(() => {
          renderState(transferState, harness.store, <NFTTransfer />);
          return Promise.resolve();
        });
        fireEvent.change(
          screen.getByRole("textbox", { name: "receiverAddress" }),
          { target: { value: receiver } },
        );
        const send = screen.getByRole("button", { name: "Send NFT" });
        await waitFor(() => {
          expect(send).toBeEnabled();
        });
        fireEvent.click(send);
        await waitFor(() => {
          expect(harness.sendRawTransaction).toHaveBeenCalledExactlyOnceWith(
            "0xraw",
          );
        });
        expect(harness.signNftTransfer).toHaveBeenCalledExactlyOnceWith(
          harness.store.qrlStore.activeAccount.accountAddress,
          receiver,
          tokenId,
          "test mnemonic",
          details.contractAddress,
          standard,
          "1",
        );
        const expectedArgs: unknown[] = [
          harness.store.qrlStore.activeAccount.accountAddress,
          receiver,
          BigInt(tokenId),
        ];
        if (standard === "ZRC1155") expectedArgs.push(1n, "0x");
        expect(safeTransferFrom).toHaveBeenCalledExactlyOnceWith(
          ...expectedArgs,
        );
        expect(signTransaction).toHaveBeenCalledTimes(1);
        expect(harness.addTransaction).toHaveBeenCalledExactlyOnceWith(
          harness.store.qrlStore.activeAccount.accountAddress,
          expect.objectContaining({
            tokenName: `${details.metadata.name} #${tokenId}`,
            tokenContractAddress: details.contractAddress,
          }),
        );
        expect(state).toStrictEqual(original);
      },
    );

    it.each(optionalFields)(
      "preserves the legacy default for $field = $value",
      ({ field, value }) => {
        const state: Record<string, unknown> = {
          ...details,
          standard,
          [field]: value,
        };
        const original = structuredClone(state);
        renderState(state, mockedStore());
        const send = screen.getByRole("button", { name: "Send NFT" });
        expect(send).toBeEnabled();
        fireEvent.click(send);
        expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_TRANSFER, {
          state: {
            contractAddress: state.contractAddress,
            tokenId: state.tokenId,
            collectionName: state.collectionName ?? "",
            imageUrl: state.imageUrl ?? "",
            standard: state.standard ?? "ZRC721",
            balance: state.balance,
            nftName: details.metadata.name,
          },
        });
        expect(state).toStrictEqual(original);
      },
    );
  });
});
