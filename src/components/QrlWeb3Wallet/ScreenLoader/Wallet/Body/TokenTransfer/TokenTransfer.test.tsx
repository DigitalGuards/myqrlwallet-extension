import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import TokenTransfer from "./TokenTransfer";

vi.mock("@theqrl/web3", async () => {
  const originalModule =
    await vi.importActual<typeof import("@theqrl/web3")>("@theqrl/web3");
  return {
    ...originalModule,
    validator: { isAddressString: vi.fn(() => true) },
  };
});

const {
  mockGetTransactionValues,
  mockSetTransactionValues,
  mockClearTransactionValues,
  mockResolveQrnsName,
} = vi.hoisted(() => ({
  mockGetTransactionValues: vi.fn().mockResolvedValue({
    receiverAddress: "",
    amount: 0,
  }),
  mockSetTransactionValues: vi.fn().mockResolvedValue(undefined),
  mockClearTransactionValues: vi.fn().mockResolvedValue(undefined),
  mockResolveQrnsName: vi.fn(),
}));

vi.mock("@/utilities/qrnsResolver", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/qrnsResolver")
  >("@/utilities/qrnsResolver");
  return {
    ...originalModule,
    resolveQrnsName: (...args: any[]) => mockResolveQrnsName(...args),
  };
});

vi.mock("@/utilities/storageUtil", async () => {
  return {
    __esModule: true,
    default: {
      getTransactionValues: (...args: any[]) =>
        mockGetTransactionValues(...args),
      setTransactionValues: (...args: any[]) =>
        mockSetTransactionValues(...args),
      clearTransactionValues: (...args: any[]) =>
        mockClearTransactionValues(...args),
      getActiveBlockChain: async () => ({ chainId: "0x1" }),
    },
  };
});

const successSignResult = {
  transactionHash: "0xtxhash",
  rawTransaction: "0xraw",
  error: "",
  nonce: 0,
  maxFeePerGas: "1000",
  maxPriorityFeePerGas: "100",
  gasLimit: 21000,
};

const ACCOUNT_A = toChecksumAddress(`Q${"a".repeat(128)}`);
const ACCOUNT_B = toChecksumAddress(`Q${"b".repeat(128)}`);
const CONTRACT_C = toChecksumAddress(`Q${"c".repeat(128)}`);
const CONTRACT_D = toChecksumAddress(`Q${"d".repeat(128)}`);
const QRNS_REGISTRY = toChecksumAddress(`Q${"e".repeat(128)}`);
const QRNS_RPC_URL = "https://qns-rpc.example";

describe("TokenTransfer", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockGetTransactionValues.mockResolvedValue({
      receiverAddress: "",
      amount: 0,
    });
    mockSetTransactionValues.mockResolvedValue(undefined);
    mockClearTransactionValues.mockResolvedValue(undefined);
    mockResolveQrnsName.mockReset();
  });

  const withQip55Account = (store: ReturnType<typeof mockedStore>) => {
    store.qrlStore.activeAccount.accountAddress = ACCOUNT_A;
    return store;
  };

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={withQip55Account(mockedStoreValues)}>
        <MemoryRouter>
          <TokenTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );

  const renderComponentWithState = (
    state: Record<string, any>,
    mockedStoreValues = mockedStore(),
  ) =>
    render(
      <StoreProvider value={withQip55Account(mockedStoreValues)}>
        <MemoryRouter initialEntries={[{ pathname: "/token-transfer", state }]}>
          <TokenTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );

  const fillAndSubmitForm = async (
    buttonName = "Send Quanta",
    amount = "2.5",
  ) => {
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, amount);
      },
      { timeout: 5000 },
    );
    const sendButton = screen.getByRole("button", { name: buttonName });
    expect(sendButton).toBeEnabled();
    await act(async () => {
      await userEvent.click(sendButton);
    });
  };

  it("should render the account details component", () => {
    renderComponent();

    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.getByText("Account address")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("0.0 Quanta")).toBeInTheDocument();
    expect(screen.getByText("Make a transaction")).toBeInTheDocument();
    expect(screen.getByText("Send to")).toBeInTheDocument();
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    expect(receiverAddressField).toBeInTheDocument();
    expect(receiverAddressField).toBeEnabled();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    const amountField = screen.getByRole("textbox", { name: "amount" });
    expect(amountField).toBeInTheDocument();
    expect(amountField).toBeEnabled();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send Quanta",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeDisabled();
  });

  it("should enable the send quanta button once receiver address, amount and mnemonic phrases are entered", async () => {
    renderComponent();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "2.5");
      },
      { timeout: 5000 },
    );
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send Quanta",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeEnabled();
  });

  it("fails closed with a clear state when QRNS is not configured", async () => {
    renderComponent();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );

    expect(
      await screen.findByText("QRNS is not configured for this chain"),
    ).toBeInTheDocument();
    expect(mockResolveQrnsName).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send Quanta" })).toBeDisabled();
  });

  it("binds a configured QRNS result to native signing", async () => {
    mockResolveQrnsName.mockResolvedValue(ACCOUNT_B);
    const mockSignNativeToken = vi.fn().mockResolvedValue(successSignResult);

    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          } as any,
          signNativeToken: mockSignNativeToken,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "amount" }), "1");

    await waitFor(
      () => {
        expect(mockResolveQrnsName).toHaveBeenCalledWith(
          "alice.qrl",
          expect.objectContaining({
            chainId: "0x301825",
            defaultRpcUrl: QRNS_RPC_URL,
            qrnsRegistryAddress: QRNS_REGISTRY,
          }),
        );
        expect(
          screen.getByText(formatQrlAddressFingerprint(ACCOUNT_B)),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Show full address" }),
    );
    expect(
      within(screen.getByTestId("address-disclosure-full")).getByTitle(
        ACCOUNT_B,
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Send Quanta" }));
    await waitFor(() => {
      expect(mockSignNativeToken).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        "1",
        expect.any(String),
        undefined,
      );
    });
  });

  it("uses the bound QRNS address for ZRC-20 gas estimation", async () => {
    mockResolveQrnsName.mockResolvedValue(ACCOUNT_B);
    const mockGetZrc20TokenGas = vi.fn().mockResolvedValue("0.001");

    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "100.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          } as any,
          getAccountBalance: () => "10.0 Quanta",
          getZrc20TokenGas: mockGetZrc20TokenGas,
        },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "amount" }), "1");

    await waitFor(
      () => {
        expect(mockGetZrc20TokenGas).toHaveBeenCalledWith(
          ACCOUNT_A,
          ACCOUNT_B,
          "1",
          CONTRACT_C,
          18,
          expect.objectContaining({ tier: expect.any(String) }),
        );
      },
      { timeout: 3000 },
    );
  });

  it("ignores an older in-flight QRNS result after the name changes", async () => {
    let resolveAlice!: (address: string) => void;
    let resolveBob!: (address: string) => void;
    mockResolveQrnsName
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveAlice = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveBob = resolve;
        }),
      );

    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          } as any,
        },
      }),
    );

    const receiver = screen.getByRole("textbox", { name: "receiverAddress" });
    await userEvent.type(receiver, "alice.qrl");
    await waitFor(() => expect(mockResolveQrnsName).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });

    await userEvent.clear(receiver);
    await userEvent.type(receiver, "bob.qrl");
    await waitFor(() => expect(mockResolveQrnsName).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });

    await act(async () => resolveBob(CONTRACT_C));
    expect(
      await screen.findByText(formatQrlAddressFingerprint(CONTRACT_C)),
    ).toBeInTheDocument();

    await act(async () => resolveAlice(ACCOUNT_B));
    expect(
      screen.getByText(formatQrlAddressFingerprint(CONTRACT_C)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(formatQrlAddressFingerprint(ACCOUNT_B)),
    ).not.toBeInTheDocument();
  });

  it("should display the error message if amount is not valid", async () => {
    renderComponent();

    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(async () => {
      await userEvent.type(amountField, "-2.5");
    });
    expect(
      screen.getByText("Amount should be more than 0"),
    ).toBeInTheDocument();
  });

  it("should sign and add pending transaction for Ledger account", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    const validRawTxHex = "0x02f8a00180843b9aca00843b9aca0082520894";

    renderComponent(
      mockedStore({
        ledgerStore: {
          isLedgerAccount: () => true,
          signAndSerializeTransaction: async () => validRawTxHex,
        } as any,
        qrlStore: {
          qrlInstance: {
            getTransactionCount: async () => 0,
            getChainId: async () => 1,
          } as any,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        pendingStatus: "pending",
        status: false,
        tokenSymbol: "Quanta",
      }),
    );
  });

  it("should display error when Ledger signing fails", async () => {
    renderComponent(
      mockedStore({
        ledgerStore: {
          isLedgerAccount: () => true,
          signAndSerializeTransaction: async () => {
            throw new Error("User rejected on device");
          },
        } as any,
        qrlStore: {
          qrlInstance: {
            getTransactionCount: async () => 0,
            getChainId: async () => 1,
          } as any,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(screen.getByText(/User rejected on device/)).toBeInTheDocument();
  });

  it("should add pending transaction and navigate home on successful sign", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => successSignResult,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        status: false,
      }),
    );
  });

  it.each(["0.0000001", "0.123456789012345678"])(
    "passes exact amount text %s through the form into signing and history",
    async (amount) => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      const add = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        mockedStore({
          qrlStore: {
            signNativeToken: sign,
            sendRawTransaction: vi.fn().mockResolvedValue(undefined),
          },
          transactionHistoryStore: { addTransaction: add },
        }),
      );
      await fillAndSubmitForm("Send Quanta", amount);
      expect(sign).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        amount,
        expect.any(String),
        undefined,
      );
      expect(add).toHaveBeenCalledWith(
        ACCOUNT_A,
        expect.objectContaining({ amount, pendingStatus: "pending" }),
      );
    },
  );

  it.each([
    [
      new Error("Receipt polling timed out"),
      { pendingStatus: "unknown", status: false },
    ],
    [
      { code: -32602, message: "Invalid transaction" },
      { pendingStatus: "failed", status: false, submissionRejected: true },
    ],
    [
      {
        receipt: { transactionHash: "0xtxhash", status: 0n, blockNumber: 100n },
      },
      {
        pendingStatus: "failed",
        status: false,
        receiptStatusVerified: true,
        blockNumber: "100",
      },
    ],
  ])(
    "classifies broadcast completion with receipt evidence: %p",
    async (error, expected) => {
      const update = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        mockedStore({
          qrlStore: {
            signNativeToken: async () => successSignResult,
            sendRawTransaction: vi.fn().mockRejectedValue(error),
          },
          transactionHistoryStore: { updateTransaction: update },
        }),
      );
      await fillAndSubmitForm();
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith(
          ACCOUNT_A,
          "0xtxhash",
          expect.objectContaining(expected),
        ),
      );
    },
  );

  it.each([
    ["0.0000001", 18],
    ["9007199254740993", 0],
  ])(
    "preserves token input %s at %s decimals through form submission",
    async (amount, decimals) => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      renderComponentWithState(
        {
          tokenDetails: {
            isZrc20Token: true,
            tokenContractAddress: CONTRACT_C,
            tokenDecimals: decimals,
            tokenImage: "token.png",
            tokenBalance: "10000000000000000 TST",
            tokenName: "Test Token",
            tokenSymbol: "TST",
          },
        },
        mockedStore({
          qrlStore: {
            signZrc20Token: sign,
            sendRawTransaction: vi.fn().mockResolvedValue(undefined),
          },
        }),
      );
      await screen.findByRole("button", { name: "Send TST" });
      await fillAndSubmitForm("Send TST", amount);
      expect(sign).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        amount,
        expect.any(String),
        CONTRACT_C,
        decimals,
        undefined,
      );
    },
  );

  it("rejects fractional zero-decimal token input without signing", async () => {
    const sign = vi.fn();
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 0,
          tokenImage: "token.png",
          tokenBalance: "10 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({ qrlStore: { signZrc20Token: sign } }),
    );
    await screen.findByRole("button", { name: "Send TST" });
    await fillAndSubmitForm("Send TST", "1.1");
    expect(sign).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 0 decimal places/)).toBeInTheDocument();
  });

  it("should call addTransaction with pending entry on successful sign", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => successSignResult,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        tokenSymbol: "Quanta",
        blockNumber: "",
        gasUsed: "",
      }),
    );
  });

  it("should navigate home when cancel button is clicked", async () => {
    renderComponent();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await act(async () => {
      await userEvent.click(cancelButton);
    });
    expect(mockClearTransactionValues).toHaveBeenCalled();
  });

  it("should display error when signing returns an error", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => ({
            error: "Insufficient funds",
          }),
        },
      }),
    );

    await fillAndSubmitForm();
    expect(screen.getByText(/Insufficient funds/)).toBeInTheDocument();
  });

  it("should display error when onSubmit throws an exception", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => {
            throw new Error("Network timeout");
          },
        },
      }),
    );

    await fillAndSubmitForm();
    expect(screen.getByText(/Network timeout/)).toBeInTheDocument();
  });

  it("should sign ZRC20 token and add pending transaction when token details are set from state", async () => {
    const mockSignZrc20Token = vi.fn().mockResolvedValue({
      ...successSignResult,
      data: "0xcontractdata",
    });
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);

    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "100.0",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          signZrc20Token: mockSignZrc20Token,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    await fillAndSubmitForm("Send TST");
    expect(mockSignZrc20Token).toHaveBeenCalled();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        pendingStatus: "pending",
        tokenSymbol: "TST",
      }),
    );
  });

  it("should load token details from storage when no state is provided", async () => {
    mockGetTransactionValues.mockResolvedValue({
      receiverAddress: "",
      amount: 0,
      tokenDetails: {
        isZrc20Token: true,
        tokenContractAddress: CONTRACT_D,
        tokenDecimals: 8,
        tokenImage: "stored-token.png",
        tokenBalance: "200.0",
        tokenName: "Stored Token",
        tokenSymbol: "STK",
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Send STK")).toBeInTheDocument();
    });
  });

  it("should reset form when shouldStartFresh state is true", async () => {
    renderComponentWithState({ shouldStartFresh: true });

    await waitFor(() => {
      expect(mockClearTransactionValues).toHaveBeenCalled();
    });
  });

  it("should display insufficient balance error when native Quanta amount exceeds balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "5.0 Quanta",
          getNativeTokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Insufficient Quanta balance (amount + gas fee exceeds balance)",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const sendButton = screen.getByRole("button", { name: "Send Quanta" });
    expect(sendButton).toBeDisabled();
  });

  it("should not display balance error when amount is within balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "100.0 Quanta",
          getNativeTokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "5");
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect(screen.getByText("Gas fee")).toBeInTheDocument();
      expect(screen.getByText("Low")).toBeInTheDocument();
      expect(screen.getByText("Market")).toBeInTheDocument();
      expect(screen.getByText("Aggressive")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Insufficient/)).not.toBeInTheDocument();

    const sendButton = screen.getByRole("button", { name: "Send Quanta" });
    expect(sendButton).toBeEnabled();
  });

  it("should display insufficient token balance error for ZRC-20 when amount exceeds token balance", async () => {
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "50.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          getZrc20TokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "100");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("Insufficient TST balance"),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("should display insufficient gas error for ZRC-20 when native balance cannot cover gas", async () => {
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "1,000.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "0.0 Quanta",
          getZrc20TokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("Insufficient Quanta for gas fee"),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  describe("balance slider", () => {
    it("should fill the full native balance on Max when no gas reserve is known", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "100.0 Quanta",
          },
        }),
      );

      const maxButton = await screen.findByRole("button", { name: "Max" });
      await userEvent.click(maxButton);

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "100",
        );
      });
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("should subtract the native gas reserve from Max", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "10.0 Quanta",
            getNativeTokenGas: async () => "0.5",
          },
        }),
      );

      const maxButton = await screen.findByRole("button", { name: "Max" });
      // The reserve estimate is async; retry Max until it reflects it.
      await waitFor(async () => {
        await userEvent.click(maxButton);
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "9.5",
        );
      });
    });

    it("should apply a quick percentage of the balance", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "100.0 Quanta",
          },
        }),
      );

      const quarterButton = await screen.findByRole("button", {
        name: "25%",
      });
      await userEvent.click(quarterButton);

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "25",
        );
      });
    });

    it("should use the full token balance for Max on ZRC-20 transfers", async () => {
      renderComponentWithState({
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "50.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      });

      await waitFor(() => {
        expect(screen.getByText("Send TST")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("button", { name: "Max" }));

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "50",
        );
      });
    });
  });
});
