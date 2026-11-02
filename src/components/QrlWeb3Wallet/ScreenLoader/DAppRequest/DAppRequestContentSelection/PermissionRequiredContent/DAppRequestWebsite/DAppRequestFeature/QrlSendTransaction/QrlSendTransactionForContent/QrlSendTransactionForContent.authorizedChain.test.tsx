const { TEST_MAINNET } = vi.hoisted(() => ({
  // A stand-in for the launch-day pin. No build ships these values.
  TEST_MAINNET: {
    chainId: "0x1b3a7",
    genesisHash: `0x${"ab".repeat(32)}`,
    rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
    explorer: null,
  },
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  MAINNET: TEST_MAINNET,
}));
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: vi.fn(() => "0xhexseed"),
}));
// Revalidation reads the stored active chain, which is the authorized one
// in every case here: it passes. What is under test is the chain this
// surface holds in memory.
vi.mock(
  "@/scripts/utils/restrictedMethodsMiddlewareUtils",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/scripts/utils/restrictedMethodsMiddlewareUtils")
    >()),
    revalidateAuthorizedDAppRequest: vi.fn(() =>
      Promise.resolve({ canProceed: true, proceedError: undefined }),
    ),
  }),
);

import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_MAINNET_BLOCKCHAIN,
  type BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import { V3_CHAIN_ID } from "@/configuration/releaseProfile";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import Web3 from "@theqrl/web3";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_TRANSACTION_TYPES } from "../QrlSendTransaction";
import QrlSendTransactionForContent from "./QrlSendTransactionForContent";

/**
 * Finding 1 of the dormant-mainnet review: revalidation proves the stored
 * active chain is the authorized one, while this surface signs for the
 * chain it holds in memory. A popup opened on mainnet, approved after the
 * user switched back to the authorized testnet, must sign nothing.
 */

const SENDER_ADDRESS = `Q${"a".repeat(128)}`;
const RECIPIENT_ADDRESS = `Q${"b".repeat(128)}`;
const EXTENDED_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

type QrlInstance = NonNullable<StoreType["qrlStore"]["qrlInstance"]>;
type SignTransaction = QrlInstance["accounts"]["signTransaction"];
type SendRequest = QrlInstance["requestManager"]["send"];

const objectContaining = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);

const requireMainnet = (): BlockchainDataType => {
  if (QRL_MAINNET_BLOCKCHAIN === null) {
    throw new Error("The pinned test build has no mainnet built-in");
  }
  return QRL_MAINNET_BLOCKCHAIN;
};

const createQrlInstance = () => {
  const instance = new Web3().qrl;
  vi.spyOn(instance, "getGasPrice").mockResolvedValue(1000n);
  vi.spyOn(instance, "getTransactionCount").mockResolvedValue(0n);
  const estimateGas = vi
    .spyOn(instance, "estimateGas")
    .mockResolvedValue(21000n);
  vi.spyOn(instance, "call").mockResolvedValue("0x");
  const send = vi.fn<SendRequest>().mockResolvedValue("0xtxhash");
  vi.spyOn(instance.requestManager, "send").mockImplementation(send);
  const account = instance.accounts.seedToAccount(EXTENDED_SEED);
  vi.spyOn(instance.accounts, "seedToAccount").mockImplementation(() => ({
    ...account,
    address: SENDER_ADDRESS,
  }));
  const signTransaction = vi.fn<SignTransaction>().mockResolvedValue({
    messageHash: "0xmessagehash",
    signature: "0xsignature",
    rawTransaction: "0xsignedraw",
    transactionHash: "0xsignedrawhash",
  });
  vi.spyOn(instance.accounts, "signTransaction").mockImplementation(
    signTransaction,
  );
  return { instance, estimateGas, send, signTransaction };
};

const approveOn = async (
  blockchain: BlockchainDataType,
  authorizedChainId: string | undefined,
) => {
  const { instance, estimateGas, send, signTransaction } = createQrlInstance();
  const record = vi.fn<ResponseRecorder>();
  let approve: (() => Promise<void>) | undefined;
  const store = mockedStore({
    qrlStore: {
      qrlConnection: { isConnected: true, blockchain },
      getGasFeeData: () =>
        Promise.resolve({
          baseFeePerGas: 100n,
          maxFeePerGas: 200n,
          maxPriorityFeePerGas: 100n,
        }),
    },
    dAppRequestStore: {
      dAppRequestData: {
        method: "qrl_sendTransaction",
        params: [
          {
            chainId: blockchain.chainId,
            from: SENDER_ADDRESS,
            to: RECIPIENT_ADDRESS,
            value: "0x30",
            gas: "0x5208",
            type: "0x2",
          },
        ],
        authorizedChainId,
      },
      setOnPermissionCallBack: (callback) => {
        approve = () => callback(true, record);
      },
      addToResponseData: record,
    },
    lockStore: {
      getMnemonicPhrases: () => Promise.resolve("test mnemonic phrases"),
    },
    ledgerStore: { isLedgerAccount: () => false },
  });
  // Kept out of the fixture's plain-data merge, which would copy it.
  store.qrlStore.qrlInstance = instance;
  render(
    <StoreProvider value={store}>
      <MemoryRouter>
        <TooltipProvider>
          <QrlSendTransactionForContent
            transactionType={SEND_TRANSACTION_TYPES.QRL_TRANSFER}
          />
        </TooltipProvider>
      </MemoryRouter>
    </StoreProvider>,
  );
  await waitFor(() => {
    expect(approve).toBeDefined();
  });
  // The approval waits for the fee read the screen shows.
  await waitFor(() => {
    expect(estimateGas).toHaveBeenCalled();
  });
  await act(async () => {
    await approve?.();
  });
  return { record, send, signTransaction };
};

describe("QrlSendTransactionForContent signs only for the authorized chain", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("signs nothing when the popup holds mainnet and the request was authorized on testnet", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { record, send, signTransaction } = await approveOn(
      requireMainnet(),
      V3_CHAIN_ID,
    );

    expect(signTransaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      error: objectContaining({
        message: "The network changed. Review the request again.",
      }),
    });
    consoleError.mockRestore();
  });

  it("signs nothing when the popup holds testnet and the request was authorized on mainnet", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { record, send, signTransaction } = await approveOn(
      DEFAULT_BLOCKCHAIN,
      TEST_MAINNET.chainId,
    );

    expect(signTransaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      error: objectContaining({
        message: "The network changed. Review the request again.",
      }),
    });
    consoleError.mockRestore();
  });

  it("signs nothing when the request carries no authorized chain", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { record, send, signTransaction } = await approveOn(
      DEFAULT_BLOCKCHAIN,
      undefined,
    );

    expect(signTransaction).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      error: objectContaining({
        message: "The network changed. Review the request again.",
      }),
    });
    consoleError.mockRestore();
  });

  it("signs with the pinned mainnet chain ID when mainnet was authorized", async () => {
    const { record, send, signTransaction } = await approveOn(
      requireMainnet(),
      TEST_MAINNET.chainId,
    );

    expect(signTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ chainId: TEST_MAINNET.chainId }),
      "0xhexseed",
    );
    expect(send).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({ transactionHash: "0xtxhash" });
  });

  it("signs with the testnet chain ID when testnet was authorized", async () => {
    const { signTransaction } = await approveOn(
      DEFAULT_BLOCKCHAIN,
      V3_CHAIN_ID,
    );

    expect(signTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ chainId: V3_CHAIN_ID }),
      "0xhexseed",
    );
  });
});
