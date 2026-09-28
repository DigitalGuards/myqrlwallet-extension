import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import StringUtil from "@/utilities/stringUtil";
import { ContractExecutionError } from "@theqrl/web3-errors";
import {
  FeeMarketEIP1559Transaction,
  signTransaction,
} from "@theqrl/web3-qrl-accounts";
import { sha3Raw } from "@theqrl/web3-utils";
import QrlSendTransactionForContent from "./QrlSendTransactionForContent";
import { SEND_TRANSACTION_TYPES } from "../QrlSendTransaction";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

const SENDER_ADDRESS = `Q${"a".repeat(128)}`;
const RECIPIENT_ADDRESS = `Q${"b".repeat(128)}`;
const CONTRACT_ADDRESS = `Q${"c".repeat(128)}`;

const getDisplayAddress = (address: string) => {
  const { prefix, addressSplit } = StringUtil.getSplitAddress(address);
  return `${prefix} ${addressSplit.join(" ")}`;
};

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: vi.fn(() => "0xhexseed"),
}));

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn(async () => ({
    canProceed: true,
    proceedError: undefined,
  })),
}));

// No mocking here: this checks a real crypto invariant the Ledger-signing
// path in QrlSendTransactionForContent relies on (F2). The mnemonic path
// gets its precomputed hash straight from signTransaction's own result; the
// Ledger path only gets raw signed bytes back and has to derive the same
// hash itself with sha3Raw. Same seed fixture as
// src/functions/qip55Web3Composition.test.ts.
describe("hash parity between signTransaction's own hash and sha3Raw(rawTransaction)", () => {
  const EXTENDED_SEED =
    "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

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

  const renderComponent = (
    mockedStoreValues = mockedStore(),
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

  const createStoreWithCallback = (overrides: Record<string, any> = {}) => {
    capturedPermissionCallback = null;
    return mockedStore({
      qrlStore: {
        qrlConnection: { isConnected: true },
        qrlInstance: {
          getGasPrice: async () => BigInt(1000),
          getTransactionCount: async () => 0,
          getChainId: async () => 1,
          accounts: {
            // seedToAccount backs the sender-derivation guard in the signing path.
            seedToAccount: () => ({
              address: SENDER_ADDRESS,
            }),
            signTransaction: async () => ({
              rawTransaction: "0xsignedraw",
              transactionHash: "0xsignedrawhash",
            }),
          },
          call: vi.fn().mockResolvedValue("0x"),
          requestManager: { send: vi.fn().mockResolvedValue("0xtxhash") },
        } as any,
        getGasFeeData: async () => ({
          baseFeePerGas: BigInt(100),
          maxFeePerGas: BigInt(200),
          maxPriorityFeePerGas: "100",
        }),
        ...overrides.qrlStore,
      },
      dAppRequestStore: {
        dAppRequestData: {
          params: [overrides.requestParams || zndTransferRequest],
        },
        setOnPermissionCallBack: (cb: any) => {
          capturedPermissionCallback = cb;
        },
        addToResponseData: overrides.addToResponseData || vi.fn(),
        ...overrides.dAppRequestStore,
      },
      lockStore: {
        getMnemonicPhrases: async () => "test mnemonic phrases",
        ...overrides.lockStore,
      },
      ledgerStore: {
        isLedgerAccount: () => false,
        signAndSerializeTransaction: async () => "0xledgersigned",
        ...overrides.ledgerStore,
      } as any,
      transactionHistoryStore: { ...overrides.transactionHistoryStore },
    });
  };

  it.each([
    [SEND_TRANSACTION_TYPES.QRL_TRANSFER, zndTransferRequest],
    [SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION, contractInteractionRequest],
  ])(
    "pins signing chain and stops broadcast if final identity check fails (%s)",
    async (transactionType, requestParams) => {
      const signTransaction = vi.fn().mockResolvedValue({
        rawTransaction: "0xsignedraw",
        transactionHash: "0xsignedrawhash",
      });
      const sendRawTransaction = vi.fn();
      const addToResponseData = vi.fn();
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
          proceedError: new Error("Pinned network identity changed") as never,
        });
      renderComponent(
        createStoreWithCallback({
          requestParams,
          addToResponseData,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => 1000n,
              getTransactionCount: async () => 0,
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction,
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: sendRawTransaction },
            },
          },
        }),
        { transactionType },
      );
      await act(async () => capturedPermissionCallback!(true));
      expect(signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ chainId: "0x301825" }),
        "0xhexseed",
      );
      expect(sendRawTransaction).not.toHaveBeenCalled();
      expect(addToResponseData).toHaveBeenCalledWith({
        error: expect.objectContaining({
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
      mockedStore({
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
      mockedStore({
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

  it("should render the Value row for contract interaction when value is non-zero", async () => {
    const requestForInteractionWithValue = {
      from: SENDER_ADDRESS,
      to: CONTRACT_ADDRESS,
      data: "0x608060405234",
      value: "0x30",
      gas: "0x1cbb3",
      type: "0x2",
    };
    renderComponent(
      mockedStore({
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

  it("should not render the Value row for contract interaction when value is zero", async () => {
    renderComponent(
      mockedStore({
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

  it("should render the Value row for contract deployment when value is non-zero (payable constructor)", async () => {
    const requestForDeploymentWithValue = {
      ...contractDeploymentRequest,
      value: "0x30",
    };
    renderComponent(
      mockedStore({
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
    const mockSignTransaction = vi.fn().mockResolvedValue({
      rawTransaction: "0xsignedinteract",
      transactionHash: "0xsignedinteracthash",
    });
    const mockSendRawTransaction = vi
      .fn()
      .mockResolvedValue("0xinteracttxhash");
    const interactionWithValue = {
      ...contractInteractionRequest,
      value: "0x30",
    };

    renderComponent(
      createStoreWithCallback({
        requestParams: interactionWithValue,
        qrlStore: {
          qrlInstance: {
            getGasPrice: async () => BigInt(1000),
            getTransactionCount: async () => 0,
            getChainId: async () => 1,
            accounts: {
              // seedToAccount backs the sender-derivation guard in the signing path.
              seedToAccount: () => ({
                address: SENDER_ADDRESS,
              }),
              signTransaction: mockSignTransaction,
            },
            call: vi.fn().mockResolvedValue("0x"),
            requestManager: { send: mockSendRawTransaction },
          } as any,
        },
      }),
      { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
    );

    // UI must show the value that will be signed.
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("0.000000000000000048 Quanta")).toBeInTheDocument();

    await act(async () => {
      await capturedPermissionCallback!(true);
    });

    // And the signed transaction must carry that same value.
    const signedTx = mockSignTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(signedTx.value).toBe("0x30");
  });

  it("should render the qrl send transaction component for QRL transfer", async () => {
    const requestForZndTransfer = {
      from: SENDER_ADDRESS,
      to: RECIPIENT_ADDRESS,
      value: "0x30",
      gas: "0x1cb55",
      type: "0x2",
    };
    renderComponent(
      mockedStore({
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
      const mockSendRawTransaction = vi.fn().mockResolvedValue("0xtxhash");
      const mockAddToResponseData = vi.fn();

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: async () => ({
                  rawTransaction: "0xsignedraw",
                  transactionHash: "0xsignedrawhash",
                }),
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      expect(capturedPermissionCallback).not.toBeNull();
      await act(async () => {
        await capturedPermissionCallback!(true);
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
        .fn()
        .mockResolvedValue("0xledgertxhash");
      const mockAddToResponseData = vi.fn();
      const mockSignAndSerialize = vi.fn().mockResolvedValue("0xledgersigned");

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
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
        await capturedPermissionCallback!(true);
      });

      expect(mockSignAndSerialize).toHaveBeenCalled();
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xledgersigned"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xledgertxhash",
      });
    });

    it("derives the hash from the raw signed bytes for a Ledger account, and still records it if the broadcast times out", async () => {
      vi.useFakeTimers();
      try {
        const send = vi.fn(() => new Promise<never>(() => {}));
        const addToResponseData = vi.fn();
        const addTransaction = vi.fn();
        const signAndSerializeTransaction = vi
          .fn()
          .mockResolvedValue("0xledgersigned");

        renderComponent(
          createStoreWithCallback({
            qrlStore: {
              qrlInstance: {
                getGasPrice: async () => BigInt(1000),
                getTransactionCount: async () => 0,
                getChainId: async () => 1,
                call: vi.fn().mockResolvedValue("0x"),
                requestManager: { send },
              } as any,
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

        const settled = capturedPermissionCallback!(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await act(async () => {
          await settled;
        });

        const expectedHash = sha3Raw("0xledgersigned");
        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
            message: expect.stringContaining(expectedHash),
          }),
        });
        expect(addTransaction).toHaveBeenCalledWith(
          SENDER_ADDRESS,
          expect.objectContaining({ transactionHash: expectedHash }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("should send QRL transfer with legacy gas pricing (non-0x2)", async () => {
      const mockSendRawTransaction = vi.fn().mockResolvedValue("0xtxhash");
      const legacyRequest = { ...zndTransferRequest, type: "0x0" };

      renderComponent(
        createStoreWithCallback({
          requestParams: legacyRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: async () => ({
                  rawTransaction: "0xsignedlegacy",
                  transactionHash: "0xsignedlegacyhash",
                }),
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xsignedlegacy"],
      });
    });

    it("should handle error when from is missing", async () => {
      const mockAddToResponseData = vi.fn();
      const missingFromRequest = { ...zndTransferRequest, from: "" };

      renderComponent(
        createStoreWithCallback({
          requestParams: missingFromRequest,
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: expect.stringContaining("from"),
        }),
      });
    });

    it("should handle error when Ledger signing fails", async () => {
      const mockAddToResponseData = vi.fn();

      renderComponent(
        createStoreWithCallback({
          addToResponseData: mockAddToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: async () => {
              throw new Error("User rejected on device");
            },
          },
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
            } as any,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: "User rejected on device",
        }),
      });
    });
  });

  describe("broadcast", () => {
    const renderTransfer = (
      send: ReturnType<typeof vi.fn>,
      history: Record<string, ReturnType<typeof vi.fn>>,
      addToResponseData: ReturnType<typeof vi.fn>,
      call: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue("0x"),
    ) =>
      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: async () => ({
                  rawTransaction: "0xsignedraw",
                  transactionHash: "0xsignedrawhash",
                }),
              },
              call,
              requestManager: { send },
            } as any,
          },
          transactionHistoryStore: history,
          addToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

    it("simulates the transaction before broadcasting, and records nonce/fee fields for speed-up/cancel", async () => {
      const call = vi.fn().mockResolvedValue("0x");
      const send = vi.fn().mockResolvedValue("0xbroadcasthash");
      const addTransaction = vi.fn();
      const addToResponseData = vi.fn();
      renderTransfer(send, { addTransaction }, addToResponseData, call);

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      // The simulation runs, and runs before the broadcast, against the
      // "pending" block so a transaction depending on one still in the
      // mempool (an approve ahead of the swap it authorizes) is not
      // rejected for state that is already about to change.
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
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
        expect.objectContaining({
          transactionHash: "0xbroadcasthash",
          pendingStatus: "pending",
          blockNumber: "",
          nonce: 0,
          maxFeePerGas: "200",
          maxPriorityFeePerGas: "100",
          gasLimit: 117589,
        }),
      );
    });

    it("returns a node rejection to the dApp and records nothing", async () => {
      const rejection = new Error("insufficient funds for gas * price + value");
      const send = vi.fn().mockRejectedValue(rejection);
      const addTransaction = vi.fn();
      const addToResponseData = vi.fn();
      renderTransfer(send, { addTransaction }, addToResponseData);

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(addToResponseData).toHaveBeenCalledWith({ error: rejection });
      expect(addToResponseData).not.toHaveBeenCalledWith(
        expect.objectContaining({ transactionHash: expect.anything() }),
      );
      expect(addTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ["an empty string", ""],
      ["a non-string value", 12345],
    ])(
      "fails before recording history when the node's response is %s",
      async (_label, nodeResponse) => {
        const send = vi.fn().mockResolvedValue(nodeResponse);
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData);

        await act(async () => {
          await capturedPermissionCallback!(true);
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
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
        const call = vi.fn().mockRejectedValue(revertError);
        const send = vi.fn();
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        await act(async () => {
          await capturedPermissionCallback!(true);
        });

        expect(send).not.toHaveBeenCalled();
        expect(addTransaction).not.toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
            message: "Transaction has been reverted by the QRVM",
            reason: "execution reverted: Insufficient balance",
            signature: "0x08c379a0",
          }),
        });
      });

      it("forwards a non-revert simulation error unchanged", async () => {
        const networkError = new Error("The v3 network is unavailable.");
        const call = vi.fn().mockRejectedValue(networkError);
        const send = vi.fn();
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        await act(async () => {
          await capturedPermissionCallback!(true);
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

      it("fails once the simulation timeout elapses, without broadcasting", async () => {
        const call = vi.fn(() => new Promise<never>(() => {}));
        const send = vi.fn();
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = capturedPermissionCallback!(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await act(async () => {
          await settled;
        });

        expect(send).not.toHaveBeenCalled();
        expect(addTransaction).not.toHaveBeenCalled();
        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
            message: "Simulating the transaction timed out after 30000ms",
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
        const call = vi.fn().mockResolvedValue("0x");
        const send = vi.fn(() => new Promise<never>(() => {}));
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = capturedPermissionCallback!(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await act(async () => {
          await settled;
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
            message: expect.stringContaining("0xsignedrawhash"),
            data: { transactionHash: "0xsignedrawhash", pending: true },
          }),
        });
        expect(addTransaction).toHaveBeenCalledWith(
          SENDER_ADDRESS,
          expect.objectContaining({
            transactionHash: "0xsignedrawhash",
            pendingStatus: "pending",
            nonce: 0,
            maxFeePerGas: "200",
            maxPriorityFeePerGas: "100",
            gasLimit: 117589,
          }),
        );
      });

      it("shares a single 30 s budget between the simulation and the broadcast", async () => {
        // The simulation alone eats 20 s of the shared budget; the
        // broadcast must be given only the remaining 10 s.
        const call = vi.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve("0x"), 20_000);
            }),
        );
        const send = vi.fn(() => new Promise<never>(() => {}));
        const addTransaction = vi.fn();
        const addToResponseData = vi.fn();
        renderTransfer(send, { addTransaction }, addToResponseData, call);

        const settled = capturedPermissionCallback!(true);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(addToResponseData).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);
        await act(async () => {
          await settled;
        });

        expect(addToResponseData).toHaveBeenCalledWith({
          error: expect.objectContaining({
            message: expect.stringContaining("0xsignedrawhash"),
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
      const addToResponseData = vi.fn();
      const addTransaction = vi.fn();
      const send = vi.fn();

      renderComponent(
        createStoreWithCallback({
          qrlStore: { qrlInstance: undefined },
          addToResponseData,
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: vi
              .fn()
              .mockResolvedValue("0xledgersigned"),
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(send).not.toHaveBeenCalled();
      expect(addTransaction).not.toHaveBeenCalled();
      expect(addToResponseData).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: "The network changed. Review the request again.",
        }),
      });
    });
  });

  describe("deployContractOrInteract", () => {
    it("should deploy contract via regular account (mnemonic)", async () => {
      const mockSendRawTransaction = vi
        .fn()
        .mockResolvedValue("0xdeploytxhash");
      const mockAddToResponseData = vi.fn();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: async () => ({
                  rawTransaction: "0xsigneddeploy",
                  transactionHash: "0xsigneddeployhash",
                }),
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
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
      const addTransaction = vi.fn();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 5,
              getChainId: async () => 1,
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: async () => ({
                  rawTransaction: "0xsigneddeploy",
                  transactionHash: "0xsigneddeployhash",
                }),
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: {
                send: vi.fn().mockResolvedValue("0xdeploytxhash"),
              },
            } as any,
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        expect.objectContaining({
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
      const addTransaction = vi.fn();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractInteractionRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 7,
              getChainId: async () => 1,
              accounts: {
                seedToAccount: () => ({ address: SENDER_ADDRESS }),
                signTransaction: async () => ({
                  rawTransaction: "0xsignedinteracttx",
                  transactionHash: "0xsignedinteracttxhash",
                }),
              },
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: {
                send: vi.fn().mockResolvedValue("0xinteracttxhash2"),
              },
            } as any,
          },
          transactionHistoryStore: { addTransaction },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(addTransaction).toHaveBeenCalledWith(
        SENDER_ADDRESS,
        expect.objectContaining({
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
        .fn()
        .mockResolvedValue("0xledgerdeployhash");
      const mockAddToResponseData = vi.fn();
      const mockSignAndSerialize = vi.fn().mockResolvedValue("0xledgerdeploy");

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
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
        await capturedPermissionCallback!(true);
      });

      expect(mockSignAndSerialize).toHaveBeenCalled();
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xledgerdeploy"],
      });
      expect(mockAddToResponseData).toHaveBeenCalledWith({
        transactionHash: "0xledgerdeployhash",
      });
    });

    it("should interact with contract via Ledger account (with to address)", async () => {
      const mockSendRawTransaction = vi
        .fn()
        .mockResolvedValue("0xledgerinteracthash");
      const mockAddToResponseData = vi.fn();
      const mockSignAndSerialize = vi
        .fn()
        .mockResolvedValue("0xledgerinteract");

      renderComponent(
        createStoreWithCallback({
          requestParams: contractInteractionRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
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
        await capturedPermissionCallback!(true);
      });

      // Verify txData includes 'to' for contract interaction
      const txDataArg = mockSignAndSerialize.mock.calls[0][1] as Record<
        string,
        any
      >;
      expect(txDataArg.to).toBe(contractInteractionRequest.to);
      expect(mockSendRawTransaction).toHaveBeenCalledWith({
        method: "qrl_sendRawTransaction",
        params: ["0xledgerinteract"],
      });
    });

    it("should use legacy gasPrice for non-0x2 contract deployment via Ledger", async () => {
      const mockSendRawTransaction = vi.fn().mockResolvedValue("0xhash");
      const mockSignAndSerialize = vi.fn().mockResolvedValue("0xsigned");
      const legacyDeployRequest = { ...contractDeploymentRequest, type: "0x0" };

      renderComponent(
        createStoreWithCallback({
          requestParams: legacyDeployRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              getChainId: async () => 1,
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
          },
          ledgerStore: {
            isLedgerAccount: () => true,
            signAndSerializeTransaction: mockSignAndSerialize,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      // Verify txData uses gasPrice instead of maxFeePerGas
      const txDataArg = mockSignAndSerialize.mock.calls[0][1] as Record<
        string,
        any
      >;
      expect(txDataArg.gasPrice).toBeDefined();
      expect(txDataArg.maxFeePerGas).toBeUndefined();
    });

    it("should handle error when signing returns no rawTransaction", async () => {
      const mockAddToResponseData = vi.fn();

      renderComponent(
        createStoreWithCallback({
          requestParams: contractDeploymentRequest,
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              accounts: {
                // seedToAccount backs the sender-derivation guard in the signing path.
                seedToAccount: () => ({
                  address: SENDER_ADDRESS,
                }),
                signTransaction: async () => ({
                  rawTransaction: undefined,
                }),
              },
            } as any,
          },
          addToResponseData: mockAddToResponseData,
        }),
        { transactionType: SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT },
      );

      await act(async () => {
        await capturedPermissionCallback!(true);
      });

      expect(mockAddToResponseData).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: "Transaction could not be signed",
        }),
      });
    });
  });

  describe("onPermissionCallBack", () => {
    it("should not execute transaction when hasApproved is false", async () => {
      const mockSendRawTransaction = vi.fn();

      renderComponent(
        createStoreWithCallback({
          qrlStore: {
            qrlInstance: {
              getGasPrice: async () => BigInt(1000),
              getTransactionCount: async () => 0,
              call: vi.fn().mockResolvedValue("0x"),
              requestManager: { send: mockSendRawTransaction },
            } as any,
          },
        }),
        { transactionType: SEND_TRANSACTION_TYPES.QRL_TRANSFER },
      );

      await act(async () => {
        await capturedPermissionCallback!(false);
      });

      expect(mockSendRawTransaction).not.toHaveBeenCalled();
    });
  });

  describe("copyData", () => {
    it("should copy data to clipboard when copy button is clicked", async () => {
      const mockWriteText = vi.fn();
      Object.assign(navigator, {
        clipboard: { writeText: mockWriteText },
      });

      renderComponent(
        mockedStore({
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
