import { mockedStore } from "@/__mocks__/mockedStore";
import * as releaseProfile from "@/configuration/releaseProfile";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import { StoreProvider } from "@/stores/store";
import type { StoreType } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { malformed } from "@/test-utils/malformed";
import Web3 from "@theqrl/web3";
import { providerErrors } from "@theqrl/qrl-wallet-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import StringUtil from "@/utilities/stringUtil";
import StorageUtil from "@/utilities/storageUtil";
import { ContractExecutionError } from "@theqrl/web3-errors";
import {
  FeeMarketEIP1559Transaction,
  TransactionFactory,
  signTransaction,
} from "@theqrl/web3-qrl-accounts";
import { bytesToHex, hexToBytes, sha3Raw } from "@theqrl/web3-utils";
import QrlSendTransactionForContent from "./QrlSendTransactionForContent";
import QrlSendTransaction, {
  SEND_TRANSACTION_TYPES,
} from "../QrlSendTransaction";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const SENDER_ADDRESS = `Q${"a".repeat(128)}`;
const RECIPIENT_ADDRESS = `Q${"b".repeat(128)}`;
const CONTRACT_ADDRESS = `Q${"c".repeat(128)}`;
const EXTENDED_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

type QrlInstance = NonNullable<StoreType["qrlStore"]["qrlInstance"]>;
type SendRequest = QrlInstance["requestManager"]["send"];
type AddTransaction = StoreType["transactionHistoryStore"]["addTransaction"];
type SignTransaction = QrlInstance["accounts"]["signTransaction"];
type SignedTransaction = Awaited<ReturnType<SignTransaction>>;
type SignAndSerializeTransaction =
  StoreType["ledgerStore"]["signAndSerializeTransaction"];
type MockedStoreOverrides = NonNullable<Parameters<typeof mockedStore>[0]>;
type ApprovalStoreOverrides = Omit<MockedStoreOverrides, "qrlStore"> & {
  qrlStore?: Omit<
    NonNullable<MockedStoreOverrides["qrlStore"]>,
    "qrlInstance"
  > &
    Pick<StoreType["qrlStore"], "qrlInstance">;
};
type StoreOverrides = ApprovalStoreOverrides & {
  requestParams?: Record<string, unknown>;
  addToResponseData?: ResponseRecorder;
};

const createApprovalStore = (overrides: ApprovalStoreOverrides = {}) => {
  const { qrlInstance, ...qrlStore } = overrides.qrlStore ?? {};
  const store = mockedStore({ ...overrides, qrlStore });
  // Preserve the Web3 instance across the shared fixture's plain-data merge.
  store.qrlStore.qrlInstance = qrlInstance;
  return store;
};
type QrlOverrides = {
  [Method in
    | "getGasPrice"
    | "getTransactionCount"
    | "getChainId"
    | "estimateGas"
    | "call"]?: (
    ...args: Parameters<QrlInstance[Method]>
  ) => ReturnType<QrlInstance[Method]>;
} & {
  accounts?: {
    seedToAccount: () => Pick<
      ReturnType<QrlInstance["accounts"]["seedToAccount"]>,
      "address"
    >;
    signTransaction: SignTransaction;
  };
  requestManager?: {
    send: (...args: Parameters<SendRequest>) => Promise<unknown>;
  };
};

const createQrlInstance = (overrides: QrlOverrides) => {
  const instance = new Web3().qrl;
  const unavailable = () => Promise.reject(new Error("Unexpected RPC call"));
  vi.spyOn(instance, "getGasPrice").mockImplementation(
    overrides.getGasPrice ?? unavailable,
  );
  vi.spyOn(instance, "getTransactionCount").mockImplementation(
    overrides.getTransactionCount ?? unavailable,
  );
  vi.spyOn(instance, "getChainId").mockImplementation(
    overrides.getChainId ?? unavailable,
  );
  vi.spyOn(instance, "estimateGas").mockImplementation(
    overrides.estimateGas ?? unavailable,
  );
  vi.spyOn(instance, "call").mockImplementation(overrides.call ?? unavailable);
  vi.spyOn(instance.requestManager, "send").mockImplementation(
    overrides.requestManager?.send ?? unavailable,
  );
  const account = instance.accounts.seedToAccount(EXTENDED_SEED);
  vi.spyOn(instance.accounts, "seedToAccount").mockImplementation(() => ({
    ...account,
    ...overrides.accounts?.seedToAccount(),
  }));
  vi.spyOn(instance.accounts, "signTransaction").mockImplementation(
    overrides.accounts?.signTransaction ?? unavailable,
  );
  return instance;
};

const signedTransaction = (
  rawTransaction: string,
  transactionHash: string,
): SignedTransaction => ({
  messageHash: "0xmessagehash",
  signature: "0xsignature",
  rawTransaction,
  transactionHash,
});

const objectContaining = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
const stringContaining = (value: string): unknown =>
  expect.stringContaining(value);

const getDisplayAddress = (address: string) => {
  const { prefix, addressSplit } = StringUtil.getSplitAddress(address);
  return `${prefix} ${addressSplit.join(" ")}`;
};

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: vi.fn(() => "0xhexseed"),
}));

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn(() =>
    Promise.resolve({
      canProceed: true,
      proceedError: undefined,
    }),
  ),
}));

// No mocking here: this checks a real crypto invariant the Ledger-signing
// path in QrlSendTransactionForContent relies on (F2). The mnemonic path
// gets its precomputed hash straight from signTransaction's own result; the
// Ledger path only gets raw signed bytes back and has to derive the same
// hash itself with sha3Raw. Same seed fixture as
// src/functions/qip55Web3Composition.test.ts.
describe("hash parity between signTransaction's own hash and sha3Raw(rawTransaction)", () => {
  it("matches for a mnemonic-signed transaction, so the Ledger path can reuse it for raw bytes", async () => {
    const unsigned = FeeMarketEIP1559Transaction.fromTxData({
      chainId: 1,
      nonce: 0,
      maxPriorityFeePerGas: 1,
      maxFeePerGas: 2,
      gasLimit: 21_000,
      to: `Q${"0".repeat(128)}`,
      value: 1,
      data: "0x",
      accessList: [],
    });
    const signed = await signTransaction(unsigned, EXTENDED_SEED);

    expect(sha3Raw(signed.rawTransaction)).toBe(signed.transactionHash);
  });
});

describe("QrlSendTransactionForContent", () => {
  afterEach(cleanup);

  let capturedPermissionCallback:
    | ((hasApproved: boolean) => Promise<void>)
    | null = null;

  const invokePermissionCallback = (hasApproved: boolean) => {
    if (!capturedPermissionCallback) {
      throw new Error("The approval callback was never set");
    }
    return capturedPermissionCallback(hasApproved);
  };

  const renderComponent = (
    mockedStoreValues = createApprovalStore(),
    mockedProps: ComponentProps<typeof QrlSendTransactionForContent> = {
      transactionType: SEND_TRANSACTION_TYPES.UNKNOWN,
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransactionForContent {...mockedProps} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  const zndTransferRequest = {
    chainId: "0x301825",
    from: SENDER_ADDRESS,
    to: RECIPIENT_ADDRESS,
    value: "0x30",
    gas: "0x1cb55",
    type: "0x2",
  };

  const contractDeploymentRequest = {
    chainId: "0x301825",
    data: "0x608060405234",
    from: SENDER_ADDRESS,
    gas: "0x1cbb3",
    type: "0x2",
    value: "0x0",
  };

  const contractInteractionRequest = {
    chainId: "0x301825",
    from: SENDER_ADDRESS,
    to: CONTRACT_ADDRESS,
    data: "0x608060405234",
    value: "0x0",
    gas: "0x1cbb3",
    type: "0x2",
  };

  const createStoreWithCallback = (overrides: StoreOverrides = {}) => {
    capturedPermissionCallback = null;
    const responseRecorder =
      overrides.dAppRequestStore?.addToResponseData ||
      overrides.addToResponseData ||
      vi.fn<ResponseRecorder>();
    return createApprovalStore({
      qrlStore: {
        qrlConnection: { isConnected: true },
        qrlInstance: createQrlInstance({
          getGasPrice: () => Promise.resolve(BigInt(1000)),
          getTransactionCount: () => Promise.resolve(0),
          getChainId: () => Promise.resolve(1),
          accounts: {
            // seedToAccount backs the sender-derivation guard in the signing path.
            seedToAccount: () => ({
              address: SENDER_ADDRESS,
            }),
            signTransaction: () =>
              Promise.resolve(
                signedTransaction("0xsignedraw", "0xsignedrawhash"),
              ),
          },
          call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
          requestManager: {
            send: vi.fn<SendRequest>().mockResolvedValue("0xtxhash"),
          },
        }),
        getGasFeeData: () =>
          Promise.resolve({
            baseFeePerGas: BigInt(100),
            maxFeePerGas: BigInt(200),
            maxPriorityFeePerGas: BigInt(100),
          }),
        ...overrides.qrlStore,
      },
      dAppRequestStore: {
        dAppRequestData: {
          params: [overrides.requestParams || zndTransferRequest],
        },
        setOnPermissionCallBack: (cb) => {
          // The store hands every permission callback a recorder bound to
          // the request that was on screen when the user clicked. The
          // suite keeps asserting on the same mock it supplies here.
          capturedPermissionCallback = (hasApproved: boolean) =>
            cb(hasApproved, responseRecorder);
        },
        addToResponseData: responseRecorder,
        ...overrides.dAppRequestStore,
      },
      lockStore: {
        getMnemonicPhrases: () => Promise.resolve("test mnemonic phrases"),
        ...overrides.lockStore,
      },
      ledgerStore: {
        isLedgerAccount: () => false,
        signAndSerializeTransaction: () => Promise.resolve("0xdeadbeef1111"),
        ...overrides.ledgerStore,
      },
      transactionHistoryStore: { ...overrides.transactionHistoryStore },
    });
  };

  it("still registers its approval callback while the node is unreachable", async () => {
    // Approve was enabled whatever the connection was doing, so a callback
    // registered only while connected left the store's no-op default to
    // answer the dApp with an empty success during an outage. A send that
    // cannot reach the node has to fail with a real error instead.
    const addToResponseData = vi.fn<ResponseRecorder>();
    const storeValues = createStoreWithCallback({
      qrlStore: {
        qrlConnection: { isConnected: false, isLoading: false },
      },
      dAppRequestStore: { addToResponseData },
    });
    renderComponent(storeValues, {
      transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
    });

    await waitFor(() => {
      expect(capturedPermissionCallback).not.toBeNull();
    });
    await act(async () => {
      await invokePermissionCallback(true);
    });

    expect(addToResponseData).toHaveBeenCalled();
    expect(
      Object.keys(addToResponseData.mock.calls[0]?.[0] ?? {}),
    ).not.toHaveLength(0);
  });

  it.each([
    [SEND_TRANSACTION_TYPES.QRL_TRANSFER, zndTransferRequest],
    [SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION, contractInteractionRequest],
  ])(
    "pins signing chain and stops broadcast if final identity check fails (%s)",
    async (transactionType, requestParams) => {
      const signTransaction = vi
        .fn<SignTransaction>()
        .mockResolvedValue(signedTransaction("0xsignedraw", "0xsignedrawhash"));
      const sendRawTransaction = vi.fn<SendRequest>();
      const addToResponseData = vi.fn<ResponseRecorder>();
      const authorization = vi.mocked(revalidateAuthorizedDAppRequest);
      const authorized = {
        canProceed: true,
        proceedError: undefined,
        authorizedChainId: "0x301825",
      };
      authorization
        .mockResolvedValueOnce(authorized)
        .mockResolvedValueOnce(authorized)
        .mockResolvedValueOnce(authorized)
        .mockResolvedValueOnce({
          canProceed: false,
          proceedError: providerErrors.disconnected({
            message: "Pinned network identity changed",
          }),
        });
      renderComponent(
        createStoreWithCallback({
          requestParams,
          addToResponseData,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(1000n),
              getTransactionCount: () => Promise.resolve(0),
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction,
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: sendRawTransaction },
            }),
          },
        }),
        { transactionType },
      );
      await act(async () => invokePermissionCallback(true));
      expect(signTransaction).toHaveBeenCalledWith(
        objectContaining({ chainId: "0x301825" }),
        "0xhexseed",
      );
      expect(sendRawTransaction).not.toHaveBeenCalled();
      expect(addToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: "Pinned network identity changed",
        }),
      });
    },
  );

  it("should render the qrl send transaction component for contract deployment", async () => {
    const requestForContractDeployment = {
      data: "0x6080604052348015600e575f5ffd5b506101298061001c5f395ff3fe6080604052348015600e575f5ffd5b50600436106030575f3560e01c8063271f88b4146034578063d321fe2914604c575b5f5ffd5b604a60048036038101906046919060a9565b6066565b005b6052606f565b604051605d919060dc565b60405180910390f35b805f8190555050565b5f5f54905090565b5f5ffd5b5f819050919050565b608b81607b565b81146094575f5ffd5b50565b5f8135905060a3816084565b92915050565b5f6020828403121560bb5760ba6077565b5b5f60c6848285016097565b91505092915050565b60d681607b565b82525050565b5f60208201905060ed5f83018460cf565b9291505056fea26469706673582212203f5c1f328bda9fceed794ae68885d6664554bf4d7dbb1df839cc372d276837ab64736f6c634300081b0033",
      from: SENDER_ADDRESS,
      gas: "0x1cbb3",
      type: "0x2",
      value: "0x0",
    };
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [requestForContractDeployment],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
    );

    const detailsTab = screen.getByRole("tab", { name: "Details" });
    const dataTab = screen.getByRole("tab", { name: "Data" });
    expect(detailsTab).toBeInTheDocument();
    expect(dataTab).toBeInTheDocument();
    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText(getDisplayAddress(SENDER_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("Gas Limit")).toBeInTheDocument();
    expect(screen.getByText("117683")).toBeInTheDocument();
    await userEvent.click(dataTab);
    expect(
      screen.getByText(
        "0x6080604052348015600e575f5ffd5b506101298061001c5f395ff3fe6080604052348015600e575f5ffd5b50600436106030575f3560e01c8063271f88b4146034578063d321fe2914604c575b5f5ffd5b604a60048036038101906046919060a9565b6066565b005b6052606f565b604051605d919060dc565b60405180910390f35b805f8190555050565b5f5f54905090565b5f5ffd5b5f819050919050565b608b81607b565b81146094575f5ffd5b50565b5f8135905060a3816084565b92915050565b5f6020828403121560bb5760ba6077565b5b5f60c6848285016097565b91505092915050565b60d681607b565b82525050565b5f60208201905060ed5f83018460cf565b9291505056fea26469706673582212203f5c1f328bda9fceed794ae68885d6664554bf4d7dbb1df839cc372d276837ab64736f6c634300081b0033",
      ),
    ).toBeInTheDocument();
  });

  it("should render the qrl send transaction component for contract interaction", async () => {
    const requestForContractInteraction = {
      from: SENDER_ADDRESS,
      to: CONTRACT_ADDRESS,
      data: "0x6080604052348015600e575f5ffd5b506101298061001c5f395ff3fe6080604052348015600e575f5ffd5b50600436106030575f3560e01c8063271f88b4146034578063d321fe2914604c575b5f5ffd5b604a60048036038101906046919060a9565b6066565b005b6052606f565b604051605d919060dc565b60405180910390f35b805f8190555050565b5f5f54905090565b5f5ffd5b5f819050919050565b608b81607b565b81146094575f5ffd5b50565b5f8135905060a3816084565b92915050565b5f6020828403121560bb5760ba6077565b5b5f60c6848285016097565b91505092915050565b60d681607b565b82525050565b5f60208201905060ed5f83018460cf565b9291505056fea26469706673582212203f5c1f328bda9fceed794ae68885d6664554bf4d7dbb1df839cc372d276837ab64736f6c634300081b0033",
      value: "0x0",
      gas: "0x1cbb3",
      type: "0x2",
    };
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [requestForContractInteraction],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
    );

    const detailsTab = screen.getByRole("tab", { name: "Details" });
    const dataTab = screen.getByRole("tab", { name: "Data" });
    expect(detailsTab).toBeInTheDocument();
    expect(dataTab).toBeInTheDocument();
    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText(getDisplayAddress(SENDER_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("Gas Limit")).toBeInTheDocument();
    expect(screen.getByText("117683")).toBeInTheDocument();
    await userEvent.click(dataTab);
    expect(
      screen.getByText(
        "0x6080604052348015600e575f5ffd5b506101298061001c5f395ff3fe6080604052348015600e575f5ffd5b50600436106030575f3560e01c8063271f88b4146034578063d321fe2914604c575b5f5ffd5b604a60048036038101906046919060a9565b6066565b005b6052606f565b604051605d919060dc565b60405180910390f35b805f8190555050565b5f5f54905090565b5f5ffd5b5f819050919050565b608b81607b565b81146094575f5ffd5b50565b5f8135905060a3816084565b92915050565b5f6020828403121560bb5760ba6077565b5b5f60c6848285016097565b91505092915050565b60d681607b565b82525050565b5f60208201905060ed5f83018460cf565b9291505056fea26469706673582212203f5c1f328bda9fceed794ae68885d6664554bf4d7dbb1df839cc372d276837ab64736f6c634300081b0033",
      ),
    ).toBeInTheDocument();
  });

  it("should render the Value row for contract interaction when value is non-zero", () => {
    const requestForInteractionWithValue = {
      from: SENDER_ADDRESS,
      to: CONTRACT_ADDRESS,
      data: "0x608060405234",
      value: "0x30",
      gas: "0x1cbb3",
      type: "0x2",
    };
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [requestForInteractionWithValue],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
    );

    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("0.000000000000000048 Quanta")).toBeInTheDocument();
  });

  it("should not render the Value row for contract interaction when value is zero", () => {
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [contractInteractionRequest],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
    );

    expect(screen.queryByText("Value")).not.toBeInTheDocument();
  });

  it("should render the Value row for contract deployment when value is non-zero (payable constructor)", () => {
    const requestForDeploymentWithValue = {
      ...contractDeploymentRequest,
      value: "0x30",
    };
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [requestForDeploymentWithValue],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
    );

    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("0.000000000000000048 Quanta")).toBeInTheDocument();
  });

  it("should sign contract interaction with the value shown in the UI", async () => {
    const mockSignTransaction = vi
      .fn<SignTransaction>()
      .mockResolvedValue(
        signedTransaction("0xsignedinteract", "0xsignedinteracthash"),
      );
    const mockSendRawTransaction = vi
      .fn<SendRequest>()
      .mockResolvedValue("0xinteracttxhash");
    const interactionWithValue = {
      ...contractInteractionRequest,
      value: "0x30",
    };

    renderComponent(
      createStoreWithCallback({
        requestParams: interactionWithValue,
        qrlStore: {
          qrlInstance: createQrlInstance({
            getGasPrice: () => Promise.resolve(BigInt(1000)),
            getTransactionCount: () => Promise.resolve(0),
            getChainId: () => Promise.resolve(1),
            accounts: {
              // seedToAccount backs the sender-derivation guard in the signing path.
              seedToAccount: () => ({
                address: SENDER_ADDRESS,
              }),
              signTransaction: mockSignTransaction,
            },
            call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
            requestManager: { send: mockSendRawTransaction },
          }),
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
    );

    // UI must show the value that will be signed.
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("0.000000000000000048 Quanta")).toBeInTheDocument();

    await act(async () => {
      await invokePermissionCallback(true);
    });

    // And the signed transaction must carry that same value.
    const signedTx = mockSignTransaction.mock.calls[0][0];
    expect(signedTx.value).toBe("0x30");
  });

  it("should render the qrl send transaction component for QRL transfer", () => {
    const requestForZndTransfer = {
      from: SENDER_ADDRESS,
      to: RECIPIENT_ADDRESS,
      value: "0x30",
      gas: "0x1cb55",
      type: "0x2",
    };
    renderComponent(
      createApprovalStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [requestForZndTransfer],
          },
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
    );

    const detailsTab = screen.getByRole("tab", { name: "Details" });
    const dataTab = screen.queryByRole("tab", { name: "Data" });
    expect(detailsTab).toBeInTheDocument();
    expect(dataTab).not.toBeInTheDocument();
    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText(getDisplayAddress(SENDER_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("To Address")).toBeInTheDocument();
    expect(
      screen.getByText(getDisplayAddress(RECIPIENT_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("0.000000000000000048 Quanta")).toBeInTheDocument();
    expect(screen.getByText("Gas Limit")).toBeInTheDocument();
    expect(screen.getByText("117589")).toBeInTheDocument();
  });

  describe("sendZndTransfer", () => {
    it("should send QRL transfer via regular account (mnemonic)", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xtxhash");
      const mockAddToResponseData = vi.fn<ResponseRecorder>();

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsignedraw", "0xsignedrawhash"),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      expect(capturedPermissionCallback).not.toBeNull();
      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xsignedraw"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xtxhash",
      });
    });

    it("should send QRL transfer via Ledger account", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xledgertxhash");
      const mockAddToResponseData = vi.fn<ResponseRecorder>();
      const mockSignAndSerialize = vi
        .fn<SignAndSerializeTransaction>()
        .mockResolvedValue("0xdeadbeef1111");

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          addToResponseData: mockAddToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: mockSignAndSerialize,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockSignAndSerialize).toHaveBeenCalled();
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xdeadbeef1111"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xledgertxhash",
      });
    });

    it("derives the hash from the raw signed bytes for a Ledger account, and still records it if the broadcast times out", async () => {
      vi.useFakeTimers();
      try {
        const send = vi.fn<SendRequest>(() => new Promise<never>(() => {}));
        const addToResponseData = vi.fn<ResponseRecorder>();
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const signAndSerializeTransaction = vi
          .fn<SignAndSerializeTransaction>()
          .mockResolvedValue("0xdeadbeef1111");

        renderComponent(
          createStoreWithCallback({
            qrlStore: {
              qrlInstance: createQrlInstance({
                getGasPrice: () => Promise.resolve(BigInt(1000)),
                getTransactionCount: () => Promise.resolve(0),
                getChainId: () => Promise.resolve(1),
                call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
                requestManager: { send },
              }),
            },
            addToResponseData,
            ledgerStore: {
              isLedgerAccount: () => true,
              signAndSerializeTransaction,
            },
            transactionHistoryStore: { addTransaction },
          }),
          { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
        );

        const settled = invokePermissionCallback(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await act(async () => {
          await settled;
        });

        const expectedHash = sha3Raw("0xdeadbeef1111");
        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: stringContaining(expectedHash),
          }),
        });
        expect(addTransaction).toHaveBeenCalledWith(
          SENDER_ADDRESS,
          objectContaining({ transactionHash: expectedHash }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("fails closed when the Ledger returns a malformed (non-hex) blob", async () => {
      // sha3Raw falls back to hashing a string's UTF-8 bytes for anything
      // that is not strict hex, which would produce a hash for a
      // "transaction" that was never actually signed. isHexStrict must
      // reject it before that happens.
      const send = vi.fn<SendRequest>();
      const addToResponseData = vi.fn<ResponseRecorder>();
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);
      const signAndSerializeTransaction = vi
        .fn<SignAndSerializeTransaction>()
        .mockResolvedValue("not-a-valid-hex-blob");

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send },
            }),
          },
          addToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction,
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(send).not.toHaveBeenCalled();
      expect(addTransaction).not.toHaveBeenCalled();
      expect(addToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: "The signed transaction is not valid hex",
        }),
      });
    });

    it("should send QRL transfer with legacy gas pricing (non-0x2)", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xtxhash");
      const legacyRequest = { ...zndTransferRequest, type: "0x0" };

      renderComponent(
        createStoreWithCallback({
          requestParams: legacyRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsignedlegacy", "0xsignedlegacyhash"),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xsignedlegacy"],
      });
    });

    it("records a large transfer amount losslessly, for Speed Up to rebuild exactly", async () => {
      // Number(fromPlanck(...)) (the previous behaviour) truncates to
      // float precision; the exact decimal string is what
      // signAndSendReplacementTransaction (qrlStore.ts) later feeds back
      // into toPlanck() to rebuild this value for Speed Up/cancel, and
      // what TokenTransfer.tsx already stores for a wallet-initiated send.
      const EXACT_QUANTA_AMOUNT = "123456789.123456789123456789";
      const largeValuePlanckHex = "0x661efdf2e3b19f7c045f15";
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);
      const largeTransferRequest = {
        ...zndTransferRequest,
        value: largeValuePlanckHex,
      };

      renderComponent(
        createStoreWithCallback({
          requestParams: largeTransferRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsignedraw", "0xsignedrawhash"),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: {
                send: vi.fn<SendRequest>().mockResolvedValue("0xlargetxhash"),
              },
            }),
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        objectContaining({ amount: EXACT_QUANTA_AMOUNT }),
      );
    });

    it("should handle error when from is missing", async () => {
      const mockAddToResponseData = vi.fn<ResponseRecorder>();
      const missingFromRequest = { ...zndTransferRequest, from: "" };

      renderComponent(
        createStoreWithCallback({
          requestParams: missingFromRequest,
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: stringContaining("from"),
        }),
      });
    });

    it("should handle error when Ledger signing fails", async () => {
      const mockAddToResponseData = vi.fn<ResponseRecorder>();

      renderComponent(
        createStoreWithCallback({
          addToResponseData: mockAddToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: () => {
              return Promise.reject(new Error("User rejected on device"));
            },
          },
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
            }),
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: "User rejected on device",
        }),
      });
    });
  });

  describe("broadcast", () => {
    const renderTransfer = (
      send: NonNullable<QrlOverrides["requestManager"]>["send"],
      history: StoreOverrides["transactionHistoryStore"],
      addToResponseData: ResponseRecorder,
      call: NonNullable<QrlOverrides["call"]> = vi
        .fn<QrlInstance["call"]>()
        .mockResolvedValue("0x"),
    ) =>
      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsignedraw", "0xsignedrawhash"),
                  ),
              },
              call,
              requestManager: { send },
            }),
          },
          transactionHistoryStore: history,
          addToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

    it("simulates the transaction before broadcasting, and records nonce/fee fields for speed-up/cancel", async () => {
      const call = vi.fn<QrlInstance["call"]>().mockResolvedValue("0x");
      const send = vi.fn<SendRequest>().mockResolvedValue("0xbroadcasthash");
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);
      const addToResponseData = vi.fn<ResponseRecorder>();
      renderTransfer(send, { addTransaction }, addToResponseData, call);

      await act(async () => {
        await invokePermissionCallback(true);
      });

      // The simulation runs, and runs before the broadcast, against the
      // "pending" block so a transaction depending on one still in the
      // mempool (an approve ahead of the swap it authorizes) is not
      // rejected for state that is already about to change.
      expect(call).toHaveBeenCalledWith(
        objectContaining({
          from: SENDER_ADDRESS,
          to: RECIPIENT_ADDRESS,
        }),
        "pending",
      );
      expect(call.mock.invocationCallOrder[0]).toBeLessThan(
        send.mock.invocationCallOrder[0],
      );

      expect(addToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xbroadcasthash",
      });
      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        objectContaining({
          transactionHash: "0xbroadcasthash",
          pendingStatus: "pending",
          blockNumber: "",
          nonce: 0,
          // The signed ceiling carries fee-market headroom: the base fee
          // (100) doubled plus the tip (100).
          maxFeePerGas: "300",
          maxPriorityFeePerGas: "100",
          gasLimit: 117589,
        }),
      );
    });

    it("returns a node rejection to the dApp and records nothing", async () => {
      const rejection = new Error("insufficient funds for gas * price + value");
      const send = vi.fn<SendRequest>().mockRejectedValue(rejection);
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);
      const addToResponseData = vi.fn<ResponseRecorder>();
      renderTransfer(send, { addTransaction }, addToResponseData);

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(addToResponseData).toHaveBeenCalledWith({ error: rejection });
      expect(addToResponseData).not.toHaveBeenCalledWith(
        objectContaining({ transactionHash: expect.anything() }),
      );
      expect(addTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ["an empty string", ""],
      ["a non-string value", 12345],
    ])(
      "fails before recording history when the node's response is %s",
      async (_label, nodeResponse) => {
        const send = vi.fn<SendRequest>().mockResolvedValue(nodeResponse);
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData);

        await act(async () => {
          await invokePermissionCallback(true);
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: "The node did not return a transaction hash",
          }),
        });
        expect(addTransaction).not.toHaveBeenCalled();
      },
    );

    describe("revert simulation", () => {
      it("fails with a revert error and never broadcasts when the simulation reverts", async () => {
        // Mirrors the shape @theqrl/web3-core's request manager throws for a
        // node response whose error message contains "revert": a
        // ContractExecutionError wrapping an Eip838ExecutionError carrying the
        // ABI-encoded revert reason in `data`.
        const revertError = new ContractExecutionError({
          message: "execution reverted: Insufficient balance",
          code: 3,
          data: "0x08c379a00000000000000000000000000000000000000000000000000000000000000020",
        });
        const call = vi
          .fn<QrlInstance["call"]>()
          .mockRejectedValue(revertError);
        const send = vi.fn<SendRequest>();
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        await act(async () => {
          await invokePermissionCallback(true);
        });

        expect(send).not.toHaveBeenCalled();
        expect(addTransaction).not.toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: "Transaction has been reverted by the QRVM",
            reason: "execution reverted: Insufficient balance",
            signature: "0x08c379a0",
          }),
        });
      });

      it("forwards a non-revert simulation error unchanged", async () => {
        const networkError = new Error("The v3 network is unavailable.");
        const call = vi
          .fn<QrlInstance["call"]>()
          .mockRejectedValue(networkError);
        const send = vi.fn<SendRequest>();
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        await act(async () => {
          await invokePermissionCallback(true);
        });

        expect(send).not.toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({ error: networkError });
      });
    });

    describe("timeouts", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("fails once the simulation's own 15 s cap elapses, without ever reaching the broadcast", async () => {
        // N1: a simulation that hangs must never be allowed to eat most of
        // the shared 30 s budget and leave the broadcast a near-zero
        // window. It is capped at 15 s (half the total), independent of
        // how much of the shared deadline is left.
        const call = vi.fn<QrlInstance["call"]>(
          () => new Promise<never>(() => {}),
        );
        const send = vi.fn<SendRequest>();
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = invokePermissionCallback(true);
        await vi.advanceTimersByTimeAsync(15_000);
        await act(async () => {
          await settled;
        });

        expect(send).not.toHaveBeenCalled();
        expect(addTransaction).not.toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: "Simulating the transaction timed out after 15000ms",
          }),
        });
      });

      it("still records a pending entry and registers for a watch when the broadcast times out", async () => {
        // A broadcast timeout does not mean the node rejected the
        // transaction: requestManager.send() gives no signal either way, so
        // qrl_sendRawTransaction is not safely retryable. The locally
        // precomputed hash (0xsignedrawhash, from the mocked
        // signTransaction) is recorded as pending and surfaced to the dApp
        // so it, and the service-worker watch the middleware registers
        // from the error's `data`, can find out what actually happened.
        const call = vi.fn<QrlInstance["call"]>().mockResolvedValue("0x");
        const send = vi.fn<SendRequest>(() => new Promise<never>(() => {}));
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = invokePermissionCallback(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await act(async () => {
          await settled;
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: stringContaining("0xsignedrawhash"),
            data: { transactionHash: "0xsignedrawhash", pending: true },
          }),
        });
        expect(addTransaction).toHaveBeenCalledWith(
          SENDER_ADDRESS,
          objectContaining({
            transactionHash: "0xsignedrawhash",
            pendingStatus: "pending",
            nonce: 0,
            maxFeePerGas: "300",
            maxPriorityFeePerGas: "100",
            gasLimit: 117589,
          }),
        );
      });

      it("gives the broadcast only the remaining budget after a successful simulation", async () => {
        // The simulation takes 10 s of the shared 30 s budget (under its
        // own 15 s cap, so it succeeds without timing out); only the
        // remaining 20 s must be given to the broadcast.
        const call = vi.fn<QrlInstance["call"]>().mockImplementation(
          () =>
            new Promise<string>((resolve) => {
              setTimeout(() => {
                resolve("0x");
              }, 10_000);
            }),
        );
        const send = vi.fn<SendRequest>(() => new Promise<never>(() => {}));
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = invokePermissionCallback(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(addToResponseData).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20_000);
        await act(async () => {
          await settled;
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            message: stringContaining("0xsignedrawhash"),
          }),
        });
      });
    });

    it("surfaces the same shaped 'network changed' error a stale qrlInstance would give elsewhere", async () => {
      // A Ledger account is used here because its signing path never reads
      // qrlInstance, so this isolates broadcastTransaction's own guard: a
      // bare `qrlInstance!.call(...)` would throw an unrelated TypeError
      // ("Cannot read properties of undefined") here, where the same
      // "network changed" message ensureSigningContext already gives for a
      // changed/disconnected network is expected.
      const addToResponseData = vi.fn<ResponseRecorder>();
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);
      const send = vi.fn<SendRequest>();

      renderComponent(
        createStoreWithCallback({
          qrlStore: { qrlInstance: undefined },
          addToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: vi
              .fn<SignAndSerializeTransaction>()
              .mockResolvedValue("0xdeadbeef1111"),
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(send).not.toHaveBeenCalled();
      expect(addTransaction).not.toHaveBeenCalled();
      expect(addToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: "The network changed. Review the request again.",
        }),
      });
    });
  });

  describe("deployContractOrInteract", () => {
    it("should deploy contract via regular account (mnemonic)", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xdeploytxhash");
      const mockAddToResponseData = vi.fn<ResponseRecorder>();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsigneddeploy", "0xsigneddeployhash"),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xsigneddeploy"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xdeploytxhash",
      });
    });

    it("records the pending entry with data, but withholds nonce/fee/gasLimit, for a contract deployment", async () => {
      // F1: signAndSendReplacementTransaction (qrlStore.ts) decides whether
      // an entry it is speeding up/cancelling is a contract call solely
      // from `tokenContractAddress`, which every dApp entry leaves empty.
      // Recording a nonce here would make Speed Up available
      // (TransactionDetail.tsx's canReplace) and have that replacement
      // logic sign a fresh transaction to an empty `to` (no `to` is ever
      // recorded for a deployment). The entry must carry no nonce so
      // canReplace stays false.
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(5),
              getChainId: () => Promise.resolve(1),
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction("0xsigneddeploy", "0xsigneddeployhash"),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: {
                send: vi.fn<SendRequest>().mockResolvedValue("0xdeploytxhash"),
              },
            }),
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        objectContaining({
          transactionHash: "0xdeploytxhash",
          data: contractDeploymentRequest.data,
          pendingStatus: "pending",
          nonce: undefined,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
          gasLimit: undefined,
        }),
      );
    });

    it("also withholds nonce/fee/gasLimit for a contract interaction, even though it carries a `to`", async () => {
      const addTransaction = vi
        .fn<AddTransaction>()
        .mockResolvedValue(undefined);

      renderComponent(
        createStoreWithCallback({
          requestParams: contractInteractionRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(7),
              getChainId: () => Promise.resolve(1),
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: () =>
                  Promise.resolve(
                    signedTransaction(
                      "0xsignedinteracttx",
                      "0xsignedinteracttxhash",
                    ),
                  ),
              },
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: {
                send: vi
                  .fn<SendRequest>()
                  .mockResolvedValue("0xinteracttxhash2"),
              },
            }),
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        objectContaining({
          transactionHash: "0xinteracttxhash2",
          to: contractInteractionRequest.to,
          nonce: undefined,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
          gasLimit: undefined,
        }),
      );
    });

    it("should deploy contract via Ledger account", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xdeadbeef2222hash");
      const mockAddToResponseData = vi.fn<ResponseRecorder>();
      const mockSignAndSerialize = vi
        .fn<SignAndSerializeTransaction>()
        .mockResolvedValue("0xdeadbeef2222");

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          addToResponseData: mockAddToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: mockSignAndSerialize,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockSignAndSerialize).toHaveBeenCalled();
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xdeadbeef2222"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xdeadbeef2222hash",
      });
    });

    it("should interact with contract via Ledger account (with to address)", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xdeadbeef3333hash");
      const mockAddToResponseData = vi.fn<ResponseRecorder>();
      const mockSignAndSerialize = vi
        .fn<SignAndSerializeTransaction>()
        .mockResolvedValue("0xdeadbeef3333");

      renderComponent(
        createStoreWithCallback({
          requestParams: contractInteractionRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          addToResponseData: mockAddToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: mockSignAndSerialize,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      // Verify txData includes 'to' for contract interaction
      const txDataArg = mockSignAndSerialize.mock.calls[0][1];
      expect(txDataArg.to).toBe(contractInteractionRequest.to);
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xdeadbeef3333"],
      });
    });

    it("should use legacy gasPrice for non-0x2 contract deployment via Ledger", async () => {
      const mockSendRawTransaction = vi
        .fn<SendRequest>()
        .mockResolvedValue("0xhash");
      const mockSignAndSerialize = vi
        .fn<SignAndSerializeTransaction>()
        .mockResolvedValue("0xsigned");
      const legacyDeployRequest = { ...contractDeploymentRequest, type: "0x0" };

      renderComponent(
        createStoreWithCallback({
          requestParams: legacyDeployRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              getChainId: () => Promise.resolve(1),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: mockSignAndSerialize,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      // Verify the legacy transaction uses gasPrice.
      const txDataArg = mockSignAndSerialize.mock.calls[0][1];
      expect(txDataArg.gasPrice).toBeDefined();
      expect(txDataArg.maxFeePerGas).toBeUndefined();
    });

    it("should handle error when signing returns no rawTransaction", async () => {
      const mockAddToResponseData = vi.fn<ResponseRecorder>();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: () =>
                  Promise.resolve(
                    malformed<SignedTransaction>({
                      rawTransaction: undefined,
                    }),
                  ),
              },
            }),
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: objectContaining({
          message: "Transaction could not be signed",
        }),
      });
    });
  });

  describe("onPermissionCallBack", () => {
    it("should not execute transaction when hasApproved is false", async () => {
      const mockSendRawTransaction = vi.fn<SendRequest>();

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: createQrlInstance({
              getGasPrice: () => Promise.resolve(BigInt(1000)),
              getTransactionCount: () => Promise.resolve(0),
              call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            }),
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await invokePermissionCallback(false);
      });

      expect(mockSendRawTransaction).not.toHaveBeenCalled();
    });
  });

  describe("wallet-locked signing (L1)", () => {
    it.each([
      [SEND_TRANSACTION_TYPES.QRL_TRANSFER, zndTransferRequest],
      [SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION, contractInteractionRequest],
    ])(
      "shows a translated message, re-polls lock state, and sends a stable 4100 error to the dApp (%s)",
      async (transactionType, requestParams) => {
        const mockReadLockState = vi
          .fn<StoreType["lockStore"]["readLockState"]>()
          .mockResolvedValue(undefined);
        const addToResponseData = vi.fn<ResponseRecorder>();

        renderComponent(
          createStoreWithCallback({
            requestParams,
            addToResponseData,
            lockStore: {
              getMnemonicPhrases: vi
                .fn<StoreType["lockStore"]["getMnemonicPhrases"]>()
                .mockRejectedValue(new Error("MyQRLWallet is locked")),
              readLockState: mockReadLockState,
            },
          }),
          { transactionType },
        );

        await act(async () => invokePermissionCallback(true));

        expect(
          screen.getByText("The wallet is locked. Unlock it to continue."),
        ).toBeInTheDocument();
        expect(mockReadLockState).toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({
          error: objectContaining({
            code: 4100,
            message: "The wallet is locked",
          }),
        });
      },
    );
  });

  describe("approval boundaries", () => {
    it.each([
      undefined,
      null,
      "transaction",
      [],
      [null],
      [{ ...zndTransferRequest, from: 1 }],
      [{ ...zndTransferRequest, to: {} }],
      [{ ...zndTransferRequest, data: [] }],
      [{ ...zndTransferRequest, type: {} }],
      [{ ...zndTransferRequest, gas: "invalid" }],
      [{ ...zndTransferRequest, gas: -1 }],
      [{ ...zndTransferRequest, value: {} }],
      [{ ...zndTransferRequest, value: true }],
      [{ ...zndTransferRequest, value: [] }],
      [{ ...zndTransferRequest, value: 1.5 }],
      [{ ...zndTransferRequest, value: "1.5" }],
      [{ ...zndTransferRequest, value: "-1" }],
      [{ ...zndTransferRequest, value: "0b102" }],
      [{ ...zndTransferRequest, value: NaN }],
      [{ ...zndTransferRequest, value: Infinity }],
      [{ ...zndTransferRequest, value: -Infinity }],
    ])(
      "refuses malformed transaction parameters: %j",
      async (params: unknown) => {
        const record = vi.fn<ResponseRecorder>();
        const setCanProceed =
          vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
        const getMnemonicPhrases =
          vi.fn<StoreType["lockStore"]["getMnemonicPhrases"]>();
        const store = createStoreWithCallback({
          addToResponseData: record,
          dAppRequestStore: { setCanProceed },
          lockStore: { getMnemonicPhrases },
        });
        store.dAppRequestStore.dAppRequestData = {
          method: "qrl_sendTransaction",
          params,
        };
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });

        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(setCanProceed).toHaveBeenLastCalledWith(false);
        expect(record).toHaveBeenCalledWith({
          error: objectContaining({ code: -32602 }),
        });
        expect(getMnemonicPhrases).not.toHaveBeenCalled();
        expect(
          store.qrlStore.qrlInstance?.accounts.signTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it.each(["0x30", 48, 48n])(
      "preserves transaction quantities from indexed parameters: %s",
      async (value) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({ addToResponseData: record });
        store.dAppRequestStore.dAppRequestData = {
          method: "qrl_sendTransaction",
          params: { 0: { ...zndTransferRequest, value } },
        };
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });

        expect(
          store.qrlStore.qrlInstance?.accounts.signTransaction,
        ).toHaveBeenCalledWith(
          objectContaining({ value, gas: zndTransferRequest.gas }),
          "0xhexseed",
        );
        expect(record).toHaveBeenCalledWith({ transactionHash: "0xtxhash" });
      },
    );

    it.each([0, 2, 0n, 2n])(
      "preserves legacy pricing for a numeric transaction type: %s",
      async (type) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({
          requestParams: { ...zndTransferRequest, type },
          addToResponseData: record,
        });
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(
          store.qrlStore.qrlInstance?.accounts.signTransaction,
        ).toHaveBeenCalledWith(
          objectContaining({ gasPrice: 1000n }),
          "0xhexseed",
        );
        expect(record).toHaveBeenCalledWith({ transactionHash: "0xtxhash" });
      },
    );

    it.each([{ gas: undefined }, { value: undefined }])(
      "preserves omitted contract transaction fields: %j",
      async (optionalFields) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({
          requestParams: { ...contractDeploymentRequest, ...optionalFields },
          addToResponseData: record,
        });
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(
          store.qrlStore.qrlInstance?.accounts.signTransaction,
        ).toHaveBeenCalledWith(objectContaining(optionalFields), "0xhexseed");
        expect(record).toHaveBeenCalledWith({ transactionHash: "0xtxhash" });
      },
    );

    it.each([{ from: undefined }, { from: null }, { from: "" }])(
      "refuses invalid contract transaction fields before signing: %j",
      async (invalidFields) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({
          requestParams: { ...contractDeploymentRequest, ...invalidFields },
          addToResponseData: record,
        });
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(record).toHaveBeenCalledWith({
          error: objectContaining({ code: -32602 }),
        });
        expect(
          store.qrlStore.qrlInstance?.accounts.signTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    describe("Web3 transaction formatting", () => {
      beforeEach(async () => {
        const authorization = await vi.importActual<
          typeof import("@/scripts/utils/restrictedMethodsMiddlewareUtils")
        >("@/scripts/utils/restrictedMethodsMiddlewareUtils");
        vi.mocked(revalidateAuthorizedDAppRequest).mockImplementation(
          authorization.revalidateAuthorizedDAppRequest,
        );
        vi.mocked(getHexSeedFromMnemonic).mockReturnValue(EXTENDED_SEED);
        vi.spyOn(releaseProfile, "assertV3Network").mockResolvedValue(
          undefined,
        );
      });

      afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(getHexSeedFromMnemonic).mockReturnValue("0xhexseed");
        vi.mocked(revalidateAuthorizedDAppRequest).mockResolvedValue({
          canProceed: true,
          proceedError: undefined,
          authorizedChainId: "0x301825",
        });
      });

      it.each([
        {
          label: "interaction with explicit zero value",
          requestParams: contractInteractionRequest,
          expectedAmount: 0,
        },
        {
          label: "interaction with null value",
          requestParams: { ...contractInteractionRequest, value: null },
          expectedAmount: 0,
        },
        {
          label: "interaction with empty value",
          requestParams: { ...contractInteractionRequest, value: "" },
          expectedAmount: 0,
        },
        {
          label: "interaction with null gas",
          requestParams: { ...contractInteractionRequest, gas: null },
          expectedAmount: 0,
        },
        {
          label: "deployment with null value",
          requestParams: { ...contractDeploymentRequest, value: null },
          expectedAmount: 0,
        },
        {
          label: "deployment with empty value",
          requestParams: { ...contractDeploymentRequest, value: "" },
          expectedAmount: 0,
        },
        {
          label: "deployment with null gas",
          requestParams: { ...contractDeploymentRequest, gas: null },
          expectedAmount: 0,
        },
        {
          label: "transfer with null data",
          requestParams: { ...zndTransferRequest, data: null },
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "transfer with hexadecimal quantities",
          requestParams: zndTransferRequest,
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "transfer with binary gas",
          requestParams: {
            ...zndTransferRequest,
            gas: "0b11000011010100000",
          },
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "transfer with binary value",
          requestParams: { ...zndTransferRequest, value: "0b110000" },
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "transfer with negative zero value",
          requestParams: { ...zndTransferRequest, value: "-0" },
          expectedAmount: "0.",
        },
        {
          label: "transfer with a large exactly representable value",
          requestParams: {
            ...zndTransferRequest,
            value: 1_000_000_000_000_000_000,
          },
          expectedAmount: "1",
        },
        {
          label: "transfer with a value above the safe integer range",
          requestParams: {
            ...zndTransferRequest,
            value: Number.MAX_SAFE_INTEGER + 1,
          },
          expectedAmount: "0.009007199254740992",
        },
        {
          label: "transfer with uppercase binary quantities",
          requestParams: {
            ...zndTransferRequest,
            gas: "0B11000011010100000",
            value: "0B110000",
          },
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "transfer with leading zeroes in its value",
          requestParams: { ...zndTransferRequest, value: "0048" },
          expectedAmount: "0.000000000000000048",
        },
        {
          label: "plain call with empty value",
          requestParams: {
            ...contractInteractionRequest,
            data: undefined,
            value: "",
          },
          expectedAmount: 0,
        },
      ])(
        "authorizes, formats, signs and records $label",
        async ({ requestParams, expectedAmount }) => {
          const instance = new Web3().qrl;
          instance.defaultNetworkId = 3151909;
          const account = instance.accounts.seedToAccount(EXTENDED_SEED);
          const signer = vi.spyOn(instance.accounts, "signTransaction");
          const send = vi
            .spyOn(instance.requestManager, "send")
            .mockImplementation(({ method, params }) => {
              if (method === "qrl_call") return Promise.resolve("0x");
              if (method === "qrl_estimateGas")
                return Promise.resolve("0x186a0");
              if (method === "qrl_getTransactionCount")
                return Promise.resolve("0x0");
              if (method === "qrl_chainId") return Promise.resolve("0x301825");
              if (method === "net_version") return Promise.resolve("3151909");
              if (
                method === "qrl_sendRawTransaction" &&
                Array.isArray(params) &&
                typeof params[0] === "string"
              ) {
                return Promise.resolve(sha3Raw(params[0]));
              }
              throw new Error(`Unexpected RPC call: ${method}`);
            });
          vi.spyOn(instance, "getGasPrice").mockResolvedValue(1000n);
          const record = vi.fn<ResponseRecorder>();
          const setCanProceed =
            vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
          const addTransaction = vi
            .fn<AddTransaction>()
            .mockResolvedValue(undefined);
          const request = { ...requestParams, from: account.address };
          const originalRequest = { ...request };
          const store = createStoreWithCallback({
            addToResponseData: record,
            qrlStore: { qrlInstance: instance },
            dAppRequestStore: {
              dAppRequestData: {
                method: "qrl_sendTransaction",
                params: [request],
                authorizedChainId: "0x301825",
                requestData: {
                  senderData: { url: "https://dapp.example" },
                },
              },
              setCanProceed,
            },
            transactionHistoryStore: { addTransaction },
          });
          const chain = store.qrlStore.qrlConnection.blockchain;
          vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue(chain);
          vi.spyOn(
            StorageUtil,
            "getDAppsConnectedAccountsData",
          ).mockResolvedValue({
            accounts: [account.address],
            blockchains: [chain],
            permissions: [],
            urlOrigin: "https://dapp.example",
          });
          render(
            <StoreProvider value={store}>
              <MemoryRouter>
                <TooltipProvider>
                  <QrlSendTransaction />
                </TooltipProvider>
              </MemoryRouter>
            </StoreProvider>,
          );
          await waitFor(() => {
            expect(setCanProceed).toHaveBeenLastCalledWith(true);
          });
          await act(async () => invokePermissionCallback(true));

          expect(signer).toHaveBeenCalledTimes(1);
          expect(signer).toHaveBeenCalledWith(
            objectContaining({
              value: requestParams.value ?? undefined,
              gas: requestParams.gas ?? undefined,
            }),
            EXTENDED_SEED,
          );
          const simulations = send.mock.calls.filter(
            ([rpc]) => rpc.method === "qrl_call",
          );
          expect(simulations).toHaveLength(1);
          const expectedSimulation: Record<string, unknown> = {};
          if (requestParams.value != null) {
            expectedSimulation.value =
              requestParams.value === ""
                ? ""
                : `0x${BigInt(requestParams.value).toString(16)}`;
          }
          if (requestParams.gas != null) {
            expectedSimulation.gas = `0x${BigInt(requestParams.gas).toString(16)}`;
          }
          expect(simulations[0]?.[0].params).toEqual([
            objectContaining(expectedSimulation),
            "pending",
          ]);
          const broadcasts = send.mock.calls.filter(
            ([rpc]) => rpc.method === "qrl_sendRawTransaction",
          );
          expect(broadcasts).toHaveLength(1);
          const broadcastParams: unknown = broadcasts[0]?.[0].params;
          if (
            !Array.isArray(broadcastParams) ||
            typeof broadcastParams[0] !== "string"
          ) {
            throw new Error("Missing signed transaction");
          }
          const rawTransaction = broadcastParams[0];
          const decoded = TransactionFactory.fromSerializedData(
            hexToBytes(rawTransaction),
          );
          expect(decoded.verifySignature()).toBe(true);
          expect(decoded.gasLimit).toBe(BigInt(requestParams.gas ?? 100_000));
          expect(decoded.value).toBe(BigInt(requestParams.value ?? 0));
          expect(bytesToHex(decoded.data)).toBe(
            "data" in requestParams ? (requestParams.data ?? "0x") : "0x",
          );
          expect(record).toHaveBeenCalledExactlyOnceWith({
            transactionHash: sha3Raw(rawTransaction),
          });
          expect(addTransaction).toHaveBeenCalledExactlyOnceWith(
            account.address,
            objectContaining({
              transactionHash: sha3Raw(rawTransaction),
              pendingStatus: "pending",
              amount: expectedAmount,
            }),
          );
          expect(store.dAppRequestStore.dAppRequestData?.params).toEqual([
            originalRequest,
          ]);
          expect(request).toEqual(originalRequest);
        },
      );
    });

    it("simulates a deployment through the library formatter with no recipient", async () => {
      const send = vi
        .fn<SendRequest>()
        .mockImplementation(({ method }) =>
          Promise.resolve(method === "qrl_call" ? "0x" : "0xtxhash"),
        );
      const record = vi.fn<ResponseRecorder>();
      const store = createStoreWithCallback({
        requestParams: contractDeploymentRequest,
        addToResponseData: record,
      });
      const instance = store.qrlStore.qrlInstance;
      if (!instance) throw new Error("Missing test provider");
      vi.spyOn(instance, "call").mockRestore();
      vi.spyOn(instance.requestManager, "send").mockImplementation(send);
      renderComponent(store, {
        transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT,
      });
      await act(async () => {
        await invokePermissionCallback(true);
      });

      const simulation = send.mock.calls.find(
        ([request]) => request.method === "qrl_call",
      )?.[0];
      expect(simulation?.params).toEqual([
        objectContaining({
          from: SENDER_ADDRESS,
          data: contractDeploymentRequest.data,
        }),
        "pending",
      ]);
      const simulationParams: unknown = simulation?.params;
      if (!Array.isArray(simulationParams))
        throw new Error("Missing simulation parameters");
      const simulatedTransaction: unknown = simulationParams[0];
      expect(simulatedTransaction).not.toHaveProperty("to");
      expect(send.mock.calls.map(([request]) => request.method)).toEqual([
        "qrl_call",
        "qrl_sendRawTransaction",
      ]);
      expect(record).toHaveBeenCalledWith({ transactionHash: "0xtxhash" });
    });

    it.each([undefined, null, {}, -1, 1.5])(
      "refuses a malformed nonce before signing: %j",
      async (nonce) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({ addToResponseData: record });
        const instance = store.qrlStore.qrlInstance;
        if (!instance) throw new Error("Missing test provider");
        vi.spyOn(instance, "getTransactionCount").mockResolvedValue(
          malformed<bigint>(nonce),
        );
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });

        expect(record).toHaveBeenCalledWith({
          error: new Error("Invalid transaction quantity"),
        });
        expect(instance.accounts.signTransaction).not.toHaveBeenCalled();
        expect(
          vi.spyOn(instance.requestManager, "send"),
        ).not.toHaveBeenCalled();
      },
    );

    it.each([null, {}, { address: 1 }])(
      "refuses a malformed signing account: %j",
      async (account) => {
        const record = vi.fn<ResponseRecorder>();
        const store = createStoreWithCallback({ addToResponseData: record });
        const instance = store.qrlStore.qrlInstance;
        if (!instance) throw new Error("Missing test provider");
        vi.mocked(instance.accounts.seedToAccount).mockReturnValue(
          malformed<ReturnType<QrlInstance["accounts"]["seedToAccount"]>>(
            account,
          ),
        );
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(record).toHaveBeenCalledWith({
          error: new Error(
            "Signing account does not match the requested sender",
          ),
        });
        expect(instance.accounts.signTransaction).not.toHaveBeenCalled();
      },
    );

    it("reports an authorization failure when its error is missing", async () => {
      const record = vi.fn<ResponseRecorder>();
      const authorization = vi.mocked(revalidateAuthorizedDAppRequest);
      authorization
        .mockResolvedValueOnce({
          canProceed: true,
          proceedError: undefined,
          authorizedChainId: zndTransferRequest.chainId,
        })
        .mockResolvedValueOnce({
          canProceed: false,
          proceedError: undefined,
          authorizedChainId: zndTransferRequest.chainId,
        });
      const store = createStoreWithCallback({ addToResponseData: record });
      renderComponent(store, {
        transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
      });
      await act(async () => {
        await invokePermissionCallback(true);
      });
      expect(record).toHaveBeenCalledWith({
        error: new Error("The request is no longer authorized."),
      });
      expect(
        store.qrlStore.qrlInstance?.accounts.signTransaction,
      ).not.toHaveBeenCalled();
    });

    it.each([null, {}, -1, "invalid"])(
      "refuses a malformed legacy gas price: %j",
      async (gasPrice) => {
        const record = vi.fn<ResponseRecorder>();
        const setCanProceed =
          vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
        const store = createStoreWithCallback({
          requestParams: { ...zndTransferRequest, type: "0x0" },
          addToResponseData: record,
          dAppRequestStore: { setCanProceed },
        });
        const instance = store.qrlStore.qrlInstance;
        if (!instance) throw new Error("Missing test provider");
        vi.spyOn(instance, "getGasPrice").mockResolvedValue(
          malformed<bigint>(gasPrice),
        );
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(setCanProceed).toHaveBeenLastCalledWith(false);
        expect(record).toHaveBeenCalledWith({
          error: new Error("Invalid transaction quantity"),
        });
        expect(instance.accounts.signTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, null, { symbol: 1, name: [] }])(
      "keeps history metadata fallbacks for an older stored chain: %j",
      async (nativeCurrency) => {
        const addTransaction = vi
          .fn<AddTransaction>()
          .mockResolvedValue(undefined);
        const store = createStoreWithCallback({
          transactionHistoryStore: { addTransaction },
        });
        store.qrlStore.qrlConnection.blockchain = malformed<
          StoreType["qrlStore"]["qrlConnection"]["blockchain"]
        >({
          ...store.qrlStore.qrlConnection.blockchain,
          nativeCurrency,
        });
        renderComponent(store, {
          transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
        });
        await act(async () => {
          await invokePermissionCallback(true);
        });
        expect(addTransaction).toHaveBeenCalledWith(
          SENDER_ADDRESS,
          objectContaining({
            tokenSymbol: NATIVE_TOKEN.symbol,
            tokenName: NATIVE_TOKEN.symbol,
            chainId: zndTransferRequest.chainId,
          }),
        );
      },
    );

    it.each([
      null,
      { rawTransaction: 1, transactionHash: "0xhash" },
      { rawTransaction: "0xraw", transactionHash: {} },
    ])("refuses malformed signed transaction data: %j", async (result) => {
      const record = vi.fn<ResponseRecorder>();
      const store = createStoreWithCallback({ addToResponseData: record });
      const instance = store.qrlStore.qrlInstance;
      if (!instance) throw new Error("Missing test provider");
      vi.mocked(instance.accounts.signTransaction).mockResolvedValue(
        malformed<SignedTransaction>(result),
      );
      renderComponent(store, {
        transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER,
      });
      await act(async () => {
        await invokePermissionCallback(true);
      });

      expect(record).toHaveBeenCalledWith({
        error: new Error("QRL Transfer transaction could not be signed"),
      });
      expect(vi.spyOn(instance.requestManager, "send")).not.toHaveBeenCalled();
    });
  });

  describe("copyData", () => {
    it("reports a clipboard rejection", async () => {
      const failure = new Error("Clipboard permission denied");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const writeText = vi
        .fn<Clipboard["writeText"]>()
        .mockRejectedValue(failure);
      Object.assign(navigator, { clipboard: { writeText } });
      try {
        renderComponent(
          createApprovalStore({
            dAppRequestStore: {
              dAppRequestData: { params: [contractInteractionRequest] },
            },
          }),
          { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
        );
        await userEvent.click(screen.getByRole("tab", { name: "Data" }));
        await userEvent.click(screen.getByRole("button"));
        await waitFor(() => {
          expect(report).toHaveBeenCalledWith(
            "Failed to copy transaction data:",
            failure,
          );
        });
      } finally {
        report.mockRestore();
      }
    });

    it("should copy data to clipboard when copy button is clicked", async () => {
      const mockWriteText = vi
        .fn<Clipboard["writeText"]>()
        .mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: mockWriteText },
      });

      renderComponent(
        createApprovalStore({
          dAppRequestStore: {
            dAppRequestData: {
              params: [contractInteractionRequest],
            },
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
      );

      const dataTab = screen.getByRole("tab", { name: "Data" });
      await userEvent.click(dataTab);

      const copyButton = screen.getByRole("button");
      await userEvent.click(copyButton);

      expect(mockWriteText).toHaveBeenCalledWith(
        contractInteractionRequest.data,
      );
    });
  });
});

describe("QrlSendTransactionForContent fee disclosure", () => {
  afterEach(cleanup);

  const ONE_GWEI = BigInt(1_000_000_000);

  const feeStore = ({
    gas,
    estimateGas,
    getGasPrice = () => Promise.resolve(ONE_GWEI),
    type = "0x2",
  }: {
    gas: string;
    estimateGas: () => Promise<bigint>;
    getGasPrice?: () => Promise<bigint>;
    type?: string;
  }) =>
    createApprovalStore({
      qrlStore: {
        qrlConnection: { isConnected: true },
        qrlInstance: createQrlInstance({
          getGasPrice,
          estimateGas,
        }),
        // Half a gwei of base fee and half a gwei of tip, so the block
        // charges one gwei per gas and the signed ceiling is one and a
        // half (the base fee doubled plus the tip).
        getGasFeeData: () =>
          Promise.resolve({
            baseFeePerGas: ONE_GWEI / BigInt(2),
            maxFeePerGas: ONE_GWEI,
            maxPriorityFeePerGas: ONE_GWEI / BigInt(2),
          }),
      },
      dAppRequestStore: {
        dAppRequestData: {
          params: [
            {
              chainId: "0x301825",
              from: SENDER_ADDRESS,
              to: CONTRACT_ADDRESS,
              data: "0x60806040",
              value: "0x0",
              gas,
              type,
            },
          ],
        },
      },
    });

  const renderFees = (storeValues: ReturnType<typeof mockedStore>) =>
    render(
      <StoreProvider value={storeValues}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransactionForContent
              transactionType={SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION}
            />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("shows the maximum fee from the requested gas limit next to the wallet estimate", async () => {
    renderFees(
      feeStore({
        gas: "0xf4240", // 1,000,000
        estimateGas: () => Promise.resolve(BigInt(21_000)),
      }),
    );

    // 1,000,000 x 1.5 gwei, the most the signed transaction could cost.
    expect(await screen.findByText("0.0015 Quanta")).toBeInTheDocument();
    // 21,000 x 1 gwei, what the block actually charges for it.
    expect(screen.getByText("0.000021 Quanta")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You are charged the base fee plus the tip. The maximum is the worst case, and whatever is not used comes back.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Maximum fee")).toBeInTheDocument();
    expect(screen.getByText("Estimated fee")).toBeInTheDocument();
    expect(screen.getByText("Wallet gas estimate")).toBeInTheDocument();
    expect(screen.getByText("21000")).toBeInTheDocument();
    expect(screen.getByText("1000000")).toBeInTheDocument();
  });

  it("flags a gas limit far above the wallet estimate without changing it", async () => {
    renderFees(
      feeStore({
        gas: "0xf4240",
        estimateGas: () => Promise.resolve(BigInt(21_000)),
      }),
    );

    expect(
      await screen.findByText(
        "The site asks for a gas limit far above the wallet's estimate. Unused gas comes back, so the maximum fee below is the most this can cost.",
      ),
    ).toBeInTheDocument();
    // The requested limit is still the one on screen, untouched.
    expect(screen.getByText("1000000")).toBeInTheDocument();
  });

  it("does not flag a gas limit close to the wallet estimate", async () => {
    renderFees(
      feeStore({
        gas: "0xc350", // 50,000
        estimateGas: () => Promise.resolve(BigInt(21_000)),
      }),
    );

    expect(await screen.findByText("Wallet gas estimate")).toBeVisible();
    expect(
      screen.queryByText(
        "The site asks for a gas limit far above the wallet's estimate. Unused gas comes back, so the maximum fee below is the most this can cost.",
      ),
    ).not.toBeInTheDocument();
  });

  it("still shows the maximum fee when the node will not estimate gas", async () => {
    renderFees(
      feeStore({
        gas: "0x5208", // 21,000
        estimateGas: () => {
          return Promise.reject(new Error("execution reverted"));
        },
      }),
    );

    // 21,000 x 1.5 gwei. The ceiling does not depend on the estimate.
    expect(await screen.findByText("0.0000315 Quanta")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Wallet gas estimate")).not.toBeInTheDocument();
  });

  it("prices a legacy transaction from its gas price", async () => {
    const getGasPrice = vi.fn(() => Promise.resolve(BigInt(2_000_000_000)));
    const storeValues = feeStore({
      gas: "0x5208",
      estimateGas: () => Promise.resolve(BigInt(21_000)),
      type: "0x0",
      getGasPrice,
    });

    renderFees(storeValues);

    // 21,000 x 2 gwei. A legacy transaction is charged its gas price
    // exactly, so its maximum carries no headroom.
    expect(
      (await screen.findAllByText("0.000042 Quanta")).length,
    ).toBeGreaterThan(0);
    expect(getGasPrice).toHaveBeenCalled();
  });
});

describe("QrlSendTransactionForContent recipient disclosure", () => {
  afterEach(cleanup);

  const renderWith = (
    params: Record<string, unknown>,
    transactionType: keyof typeof SEND_TRANSACTION_TYPES,
  ) =>
    render(
      <StoreProvider
        value={createApprovalStore({
          dAppRequestStore: { dAppRequestData: { params: [params] } },
        })}
      >
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransactionForContent transactionType={transactionType} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("shows the recipient of an unclassified request that still signs", () => {
    renderWith(
      {
        from: SENDER_ADDRESS,
        to: RECIPIENT_ADDRESS,
        gas: "0x1cbb3",
        type: "0x2",
      },
      SEND_TRANSACTION_TYPES.UNKNOWN,
    );

    expect(
      screen.getByText(getDisplayAddress(RECIPIENT_ADDRESS)),
    ).toBeInTheDocument();
  });

  it("says outright that a request with no recipient creates a contract", () => {
    renderWith(
      {
        from: SENDER_ADDRESS,
        data: "0x608060405234",
        gas: "0x1cbb3",
        type: "0x2",
      },
      SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT,
    );

    expect(
      screen.getByText("None. This creates a new contract."),
    ).toBeInTheDocument();
  });

  it("hides the Data tab for a request that carries no calldata", () => {
    renderWith(
      {
        from: SENDER_ADDRESS,
        to: RECIPIENT_ADDRESS,
        gas: "0x1cbb3",
        type: "0x2",
      },
      SEND_TRANSACTION_TYPES.PLAIN_CALL,
    );

    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Data" })).not.toBeInTheDocument();
  });
});

describe("QrlSendTransactionForContent fee pinning", () => {
  afterEach(cleanup);

  const ONE_GWEI = BigInt(1_000_000_000);

  const setupPinning = ({
    displayedFeePerGas,
    signingFeePerGas,
    requestParams,
  }: {
    displayedFeePerGas: bigint;
    signingFeePerGas: bigint;
    requestParams: Record<string, unknown>;
  }) => {
    let approve: (() => Promise<void>) | undefined;
    const addToResponseData = vi.fn<ResponseRecorder>();
    const signTransaction = vi
      .fn<SignTransaction>()
      .mockResolvedValue(signedTransaction("0xsignedraw", "0xsignedrawhash"));
    const sendRawTransaction = vi
      .fn<SendRequest>()
      .mockResolvedValue("0xbroadcasthash");
    let feeReads = 0;
    const storeValues = createApprovalStore({
      qrlStore: {
        qrlConnection: { isConnected: true },
        qrlInstance: createQrlInstance({
          getGasPrice: () => Promise.resolve(ONE_GWEI),
          estimateGas: () => Promise.resolve(BigInt(21_000)),
          getTransactionCount: () => Promise.resolve(0),
          accounts: {
            seedToAccount: () => ({ address: SENDER_ADDRESS }),
            signTransaction,
          },
          call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
          requestManager: { send: sendRawTransaction },
        }),
        getGasFeeData: () => {
          feeReads += 1;
          // The cost per gas is split evenly between base fee and tip, so
          // the ceiling the surface signs is one and a half times it.
          const feePerGas =
            feeReads === 1 ? displayedFeePerGas : signingFeePerGas;
          return Promise.resolve({
            baseFeePerGas: feePerGas / BigInt(2),
            maxFeePerGas: feePerGas,
            maxPriorityFeePerGas: feePerGas / BigInt(2),
          });
        },
      },
      dAppRequestStore: {
        dAppRequestData: { params: [requestParams] },
        setOnPermissionCallBack: (callback) => {
          approve = () => callback(true, addToResponseData);
        },
        addToResponseData,
      },
      lockStore: {
        getMnemonicPhrases: () => Promise.resolve("test mnemonic phrases"),
      },
      ledgerStore: { isLedgerAccount: () => false },
    });
    return {
      storeValues,
      approve: async () => {
        if (!approve) throw new Error("The approval callback was never set");
        await approve();
      },
      addToResponseData,
      signTransaction,
      sendRawTransaction,
    };
  };

  // 42,000, so the maximum fee never coincides with the 21,000 estimate.
  const transferRequest = {
    chainId: "0x301825",
    from: SENDER_ADDRESS,
    to: RECIPIENT_ADDRESS,
    value: "0x30",
    gas: "0xa410",
    type: "0x2",
  };

  const interactionRequest = {
    chainId: "0x301825",
    from: SENDER_ADDRESS,
    to: CONTRACT_ADDRESS,
    data: "0x608060405234",
    value: "0x0",
    gas: "0xa410",
    type: "0x2",
  };

  const renderPinning = (
    storeValues: ReturnType<typeof mockedStore>,
    transactionType: keyof typeof SEND_TRANSACTION_TYPES,
  ) =>
    render(
      <StoreProvider value={storeValues}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransactionForContent transactionType={transactionType} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("signs the maximum fee that was displayed when the market eased", async () => {
    const pinning = setupPinning({
      displayedFeePerGas: BigInt(2) * ONE_GWEI,
      signingFeePerGas: ONE_GWEI,
      requestParams: transferRequest,
    });
    renderPinning(pinning.storeValues, SEND_TRANSACTION_TYPES.QRL_TRANSFER);

    // 42,000 x 3 gwei, the ceiling the screen showed.
    expect(await screen.findByText("0.000126 Quanta")).toBeInTheDocument();
    await act(async () => pinning.approve());

    expect(pinning.signTransaction).toHaveBeenCalledWith(
      objectContaining({
        maxFeePerGas: `0x${(BigInt(3) * ONE_GWEI).toString(16)}`,
      }),
      "0xhexseed",
    );
    expect(pinning.sendRawTransaction).toHaveBeenCalled();
  });

  it("signs a rise that stays inside the approved ceiling", async () => {
    // The headroom is the point: an ordinary base-fee drift during the
    // ninety seconds an approval may sit open must not abort the send.
    const pinning = setupPinning({
      displayedFeePerGas: ONE_GWEI,
      signingFeePerGas: (BigInt(14) * ONE_GWEI) / BigInt(10),
      requestParams: transferRequest,
    });
    renderPinning(pinning.storeValues, SEND_TRANSACTION_TYPES.QRL_TRANSFER);

    expect(await screen.findByText("0.000063 Quanta")).toBeInTheDocument();
    await act(async () => pinning.approve());

    expect(pinning.signTransaction).toHaveBeenCalledWith(
      objectContaining({
        maxFeePerGas: `0x${((BigInt(15) * ONE_GWEI) / BigInt(10)).toString(16)}`,
      }),
      "0xhexseed",
    );
    expect(pinning.sendRawTransaction).toHaveBeenCalled();
  });

  it("refuses to sign when no maximum fee was ever displayed", async () => {
    const setCanProceed =
      vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
    const addToResponseData = vi.fn<ResponseRecorder>();
    const signTransaction = vi.fn<SignTransaction>();
    let approve: (() => Promise<void>) | undefined;
    let feeReads = 0;
    const storeValues = createApprovalStore({
      qrlStore: {
        qrlConnection: { isConnected: true },
        qrlInstance: createQrlInstance({
          getGasPrice: () => Promise.resolve(ONE_GWEI),
          estimateGas: () => Promise.resolve(BigInt(21_000)),
          getTransactionCount: () => Promise.resolve(0),
          accounts: {
            seedToAccount: () => ({ address: SENDER_ADDRESS }),
            signTransaction,
          },
          call: vi.fn<QrlInstance["call"]>().mockResolvedValue("0x"),
          requestManager: { send: vi.fn<SendRequest>() },
        }),
        // The opening read fails, so the screen shows "Unavailable"; a
        // later read would succeed, which is exactly the gap that used to
        // let signing proceed against a fee nobody was shown.
        getGasFeeData: () => {
          feeReads += 1;
          if (feeReads === 1)
            return Promise.reject(new Error("node unreachable"));
          return Promise.resolve({
            baseFeePerGas: ONE_GWEI,
            maxFeePerGas: BigInt(2) * ONE_GWEI,
            maxPriorityFeePerGas: ONE_GWEI,
          });
        },
      },
      dAppRequestStore: {
        dAppRequestData: { params: [transferRequest] },
        setOnPermissionCallBack: (callback) => {
          approve = () => callback(true, addToResponseData);
        },
        setCanProceed,
        addToResponseData,
      },
      lockStore: {
        getMnemonicPhrases: () => Promise.resolve("test mnemonic phrases"),
      },
      ledgerStore: { isLedgerAccount: () => false },
    });
    renderPinning(storeValues, SEND_TRANSACTION_TYPES.QRL_TRANSFER);

    await waitFor(() => {
      expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    });
    // Approve stays disabled while there is no ceiling to approve.
    expect(setCanProceed).toHaveBeenCalledWith(false);
    expect(setCanProceed).not.toHaveBeenCalledWith(true);

    await act(async () => {
      if (!approve) throw new Error("The approval callback was never set");
      await approve();
    });

    expect(signTransaction).not.toHaveBeenCalled();
    expect(addToResponseData).toHaveBeenCalledWith({
      error: objectContaining({
        code: -32003,
        message:
          "The wallet could not read the current network fee, so it did not sign. Try again from the site.",
      }),
    });
  });

  it("stops the signature and asks again when the fee rose while open", async () => {
    const pinning = setupPinning({
      displayedFeePerGas: ONE_GWEI,
      signingFeePerGas: BigInt(3) * ONE_GWEI,
      requestParams: interactionRequest,
    });
    renderPinning(
      pinning.storeValues,
      SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION,
    );

    // 42,000 x 1.5 gwei, the ceiling approved before the market moved.
    expect(await screen.findByText("0.000063 Quanta")).toBeInTheDocument();
    await act(async () => pinning.approve());

    expect(pinning.signTransaction).not.toHaveBeenCalled();
    expect(pinning.sendRawTransaction).not.toHaveBeenCalled();
    expect(pinning.addToResponseData).toHaveBeenCalledWith({
      error: objectContaining({
        code: -32003,
        message:
          "The network fee rose above the maximum you approved; try again from the site.",
      }),
    });
    // The screen now shows the ceiling it would take, for a fresh decision:
    // 42,000 x 4.5 gwei.
    expect(await screen.findByText("0.000189 Quanta")).toBeInTheDocument();
  });
});

describe("QrlSendTransactionForContent deployment bytecode", () => {
  afterEach(cleanup);

  it("does not read deployment bytecode as a token call", () => {
    // Constructor bytecode can start with any four bytes, including ones
    // that happen to match a token selector. A deployment has no `to` to
    // resolve a token against, so it gets no summary at all.
    const approveCalldata = `0x095ea7b3${"ab".repeat(64)}${"5".padStart(128, "0")}`;
    render(
      <StoreProvider
        value={createApprovalStore({
          dAppRequestStore: {
            dAppRequestData: {
              params: [
                {
                  chainId: "0x301825",
                  from: SENDER_ADDRESS,
                  data: approveCalldata,
                  gas: "0x1cbb3",
                  type: "0x2",
                  value: "0x0",
                },
              ],
            },
          },
        })}
      >
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransactionForContent
              transactionType={SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT}
            />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

    expect(
      screen.getByText("None. This creates a new contract."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Approve token spending"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Approve an amount or one NFT"),
    ).not.toBeInTheDocument();
  });
});
