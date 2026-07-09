import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
} = vi.hoisted(() => ({
  mockGetTransactionValues: vi.fn<any>().mockResolvedValue({
    receiverAddress: "",
    amount: 0,
  }),
  mockSetTransactionValues: vi.fn<any>().mockResolvedValue(undefined),
  mockClearTransactionValues: vi.fn<any>().mockResolvedValue(undefined),
}));

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

describe("TokenTransfer", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockGetTransactionValues.mockResolvedValue({
      receiverAddress: "",
      amount: 0,
    });
    mockSetTransactionValues.mockResolvedValue(undefined);
    mockClearTransactionValues.mockResolvedValue(undefined);
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
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
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter
          initialEntries={[{ pathname: "/token-transfer", state }]}
        >
          <TokenTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );

  const fillAndSubmitForm = async (buttonName = "Send QRL") => {
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
        await userEvent.type(amountField, "2.5");
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
    expect(
      screen.getByText("Q 20B71 4091c F2a62 DADda 28478 03e3f 1B9D2 D3779"),
    ).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("0.0 QRL")).toBeInTheDocument();
    expect(screen.getByText("Make a transaction")).toBeInTheDocument();
    expect(screen.getByText("Send to")).toBeInTheDocument();
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    expect(receiverAddressField).toBeInTheDocument();
    expect(receiverAddressField).toBeEnabled();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    expect(amountField).toBeInTheDocument();
    expect(amountField).toBeEnabled();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send QRL",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeDisabled();
  });

  it("should enable the send quanta button once receiver address, amount and mnemonic phrases are entered", async () => {
    renderComponent();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
        await userEvent.type(amountField, "2.5");
      },
      { timeout: 5000 },
    );
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send QRL",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeEnabled();
  });

  it("should display the error message if amount is not valid", async () => {
    renderComponent();

    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(async () => {
      await userEvent.type(amountField, "-2.5");
    });
    expect(
      screen.getByText("Amount should be more than 0"),
    ).toBeInTheDocument();
  });

  it("should sign and add pending transaction for Ledger account", async () => {
    const mockAddTransaction = vi.fn<any>().mockResolvedValue(undefined);
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
          sendRawTransaction: vi.fn<any>().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
      expect.objectContaining({
        pendingStatus: "pending",
        status: false,
        tokenSymbol: "QRL",
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
    expect(
      screen.getByText(/User rejected on device/),
    ).toBeInTheDocument();
  });

  it("should add pending transaction and navigate home on successful sign", async () => {
    const mockAddTransaction = vi.fn<any>().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => successSignResult,
          sendRawTransaction: vi.fn<any>().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        status: false,
      }),
    );
  });

  it("should call addTransaction with pending entry on successful sign", async () => {
    const mockAddTransaction = vi.fn<any>().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: async () => successSignResult,
          sendRawTransaction: vi.fn<any>().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        tokenSymbol: "QRL",
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
    const mockSignZrc20Token = vi.fn<any>().mockResolvedValue({
      ...successSignResult,
      data: "0xcontractdata",
    });
    const mockAddTransaction = vi.fn<any>().mockResolvedValue(undefined);

    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: "Q1234567890abcdef1234567890abcdef12345678",
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
          sendRawTransaction: vi.fn<any>().mockResolvedValue(undefined),
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
      "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
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
        tokenContractAddress: "Qabcdef1234567890abcdef1234567890abcdef12",
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

  it("should display insufficient balance error when native QRL amount exceeds balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "5.0 QRL",
          getNativeTokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Insufficient QRL balance (amount + gas fee exceeds balance)",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const sendButton = screen.getByRole("button", { name: "Send QRL" });
    expect(sendButton).toBeDisabled();
  });

  it("should not display balance error when amount is within balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "100.0 QRL",
          getNativeTokenGas: vi.fn(async () => "0.001"),
        },
      }),
    );

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
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

    expect(
      screen.queryByText(/Insufficient/),
    ).not.toBeInTheDocument();

    const sendButton = screen.getByRole("button", { name: "Send QRL" });
    expect(sendButton).toBeEnabled();
  });

  it("should display insufficient token balance error for ZRC-20 when amount exceeds token balance", async () => {
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: "Q1234567890abcdef1234567890abcdef12345678",
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "50.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 QRL",
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
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
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
          tokenContractAddress: "Q1234567890abcdef1234567890abcdef12345678",
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "1,000.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "0.0 QRL",
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
    const amountField = screen.getByRole("spinbutton", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(
          receiverAddressField,
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        );
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("Insufficient QRL for gas fee"),
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
            getAccountBalance: () => "100.0 QRL",
          },
        }),
      );

      const maxButton = await screen.findByRole("button", { name: "Max" });
      await userEvent.click(maxButton);

      await waitFor(() => {
        expect(
          screen.getByRole("spinbutton", { name: "amount" }),
        ).toHaveValue(100);
      });
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("should subtract the native gas reserve from Max", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "10.0 QRL",
            getNativeTokenGas: async () => "0.5",
          },
        }),
      );

      const maxButton = await screen.findByRole("button", { name: "Max" });
      // The reserve estimate is async; retry Max until it reflects it.
      await waitFor(async () => {
        await userEvent.click(maxButton);
        expect(
          screen.getByRole("spinbutton", { name: "amount" }),
        ).toHaveValue(9.5);
      });
    });

    it("should apply a quick percentage of the balance", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "100.0 QRL",
          },
        }),
      );

      const quarterButton = await screen.findByRole("button", {
        name: "25%",
      });
      await userEvent.click(quarterButton);

      await waitFor(() => {
        expect(
          screen.getByRole("spinbutton", { name: "amount" }),
        ).toHaveValue(25);
      });
    });

    it("should use the full token balance for Max on ZRC-20 transfers", async () => {
      renderComponentWithState({
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: "Q1234567890abcdef1234567890abcdef12345678",
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
        expect(
          screen.getByRole("spinbutton", { name: "amount" }),
        ).toHaveValue(50);
      });
    });
  });
});
