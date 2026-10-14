import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import { historyEntryView } from "@/utilities/storageViews";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TransactionDetail from "./TransactionDetail";

const { createTab, isLedgerAccount } = vi.hoisted(() => ({
  createTab: vi.fn().mockResolvedValue({}),
  isLedgerAccount: vi.fn().mockResolvedValue(false),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    tabs: {
      create: createTab,
    },
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    isLedgerAccount,
    getActiveBlockChain: vi.fn().mockResolvedValue({ chainId: "0x1" }),
  },
}));

const sampleTransaction: TransactionHistoryEntry = {
  id: "0xabc123def456",
  from: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
  to: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
  amount: 2.5,
  tokenSymbol: "QRL",
  tokenName: "QRL",
  isZrc20Token: false,
  tokenContractAddress: "",
  tokenDecimals: 18,
  transactionHash: "0xabc123def456",
  blockNumber: "100",
  gasUsed: "21000",
  effectiveGasPrice: "1000000000",
  status: true,
  timestamp: 1700000000000,
  chainId: "0x1",
};

const pendingTransaction: TransactionHistoryEntry = {
  ...sampleTransaction,
  pendingStatus: "pending",
  nonce: 5,
  maxFeePerGas: "2000000000",
  maxPriorityFeePerGas: "1000000000",
  gasLimit: 21000,
  blockNumber: "",
  gasUsed: "",
  effectiveGasPrice: "",
};

describe("TransactionDetail", () => {
  afterEach(cleanup);

  const renderComponent = (
    transaction?: unknown,
    mockedStoreValues = mockedStore(),
    initialAction?: unknown,
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/transaction-detail",
              state: transaction
                ? { transaction, action: initialAction }
                : undefined,
            },
          ]}
        >
          <TransactionDetail />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the heading", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("Transaction Details")).toBeInTheDocument();
  });

  it("shows historical fees as unavailable when receipt facts are absent", () => {
    renderComponent({
      ...sampleTransaction,
      gasUsed: "",
      effectiveGasPrice: "",
      paidFeesQrl: undefined,
    });
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });

  it("displays a neutral status for an observation failure awaiting reconciliation", () => {
    renderComponent({
      ...pendingTransaction,
      pendingStatus: "unknown",
      status: false,
    });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("should show transaction not found when no state", () => {
    renderComponent(undefined);

    expect(screen.getByText("Transaction not found")).toBeInTheDocument();
  });

  it.each([
    ["non-object", "invalid"],
    ["array", []],
    ["missing fields", { transactionHash: "0xold" }],
    ["recipient", { ...pendingTransaction, to: null }],
    ["amount", { ...pendingTransaction, amount: {} }],
    ["status", { ...pendingTransaction, status: "confirmed" }],
    ["timestamp", { ...pendingTransaction, timestamp: NaN }],
    ["pending status", { ...pendingTransaction, pendingStatus: "invalid" }],
    ["nonce", { ...pendingTransaction, nonce: "5" }],
    ["inherited nonce", { ...sampleTransaction, __proto__: { nonce: "5" } }],
    ["gas limit", { ...pendingTransaction, gasLimit: Infinity }],
    ["fee", { ...pendingTransaction, maxFeePerGas: {} }],
    ["call data", { ...pendingTransaction, data: [] }],
    ["receipt flag", { ...pendingTransaction, receiptStatusVerified: "yes" }],
    [
      "replacement action",
      { ...pendingTransaction, replacedByAction: "invalid" },
    ],
  ])(
    "rejects malformed route transaction %s before estimation or signing",
    (_label, transaction) => {
      const getGasFeeData = vi.fn();
      const signAndSendReplacementTransaction = vi.fn();
      const updateTransaction = vi.fn();
      renderComponent(
        transaction,
        mockedStore({
          qrlStore: { getGasFeeData, signAndSendReplacementTransaction },
          transactionHistoryStore: { updateTransaction },
        }),
        "speed-up",
      );
      expect(screen.getByText("Transaction not found")).toBeInTheDocument();
      expect(getGasFeeData).not.toHaveBeenCalled();
      expect(signAndSendReplacementTransaction).not.toHaveBeenCalled();
      expect(updateTransaction).not.toHaveBeenCalled();
    },
  );

  it("renders the validated view of an older stored history entry", () => {
    renderComponent(historyEntryView({ transactionHash: "0xlegacy" }));
    expect(screen.getByText("0xlegacy")).toBeInTheDocument();
    expect(screen.queryByText("Transaction not found")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speed Up" }),
    ).not.toBeInTheDocument();
  });

  it("ignores an unknown route action", () => {
    const getGasFeeData = vi.fn();
    renderComponent(
      pendingTransaction,
      mockedStore({ qrlStore: { getGasFeeData } }),
      { action: "speed-up" },
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(getGasFeeData).not.toHaveBeenCalled();
  });

  it("reports a rejected explorer tab request", async () => {
    const failure = new Error("Tab unavailable");
    createTab.mockRejectedValueOnce(failure);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderComponent(sampleTransaction);
      await userEvent.click(screen.getByText("View on Block Explorer"));
      expect(report).toHaveBeenCalledWith(
        "Failed to open block explorer:",
        failure,
      );
    } finally {
      report.mockRestore();
    }
  });

  it("should display amount and token symbol", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("Amount")).toBeInTheDocument();
    const amountElement = screen.getByText("2.5 QRL", {
      selector: ".text-lg",
    });
    expect(amountElement).toBeInTheDocument();
  });

  it("should display Confirmed status for successful transaction", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("should display Failed status for failed transaction", () => {
    renderComponent({ ...sampleTransaction, status: false });

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("should display from and to addresses", () => {
    renderComponent(sampleTransaction);

    expect(
      screen.getByText("Q20B714091cF2a62DADda2847803e3f1B9D2D3779"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Q20fB08fF1f1376A14C055E9F56df80563E16722b"),
    ).toBeInTheDocument();
  });

  it("should display transaction hash", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("0xabc123def456")).toBeInTheDocument();
  });

  it("should display block number", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("should display gas used", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("21,000")).toBeInTheDocument();
  });

  it("should display date and time", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("Date & Time")).toBeInTheDocument();
  });

  it("should have a back button", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });

  it("should display copy buttons for from, to, and tx hash", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByLabelText("Copy From")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy To")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy Transaction Hash")).toBeInTheDocument();
  });

  it("should copy value to clipboard on copy button click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderComponent(sampleTransaction);

    await userEvent.click(screen.getByLabelText("Copy Transaction Hash"));
    expect(writeText).toHaveBeenCalledWith("0xabc123def456");
  });

  it("should show View on Block Explorer button", () => {
    renderComponent(sampleTransaction);

    expect(screen.getByText("View on Block Explorer")).toBeInTheDocument();
  });

  it("should open block explorer on button click", async () => {
    renderComponent(sampleTransaction);

    await userEvent.click(screen.getByText("View on Block Explorer"));
    expect(createTab).toHaveBeenCalled();
  });

  // ── Pending transaction tests ──

  it("should show Pending badge for pending transaction", () => {
    renderComponent(pendingTransaction);

    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("should show 'Waiting for confirmation...' for pending transaction", () => {
    renderComponent(pendingTransaction);

    expect(screen.getByText("Waiting for confirmation...")).toBeInTheDocument();
  });

  it("should not show block number for pending transaction", () => {
    renderComponent(pendingTransaction);

    expect(screen.queryByText("Block Number")).not.toBeInTheDocument();
  });

  it("should not show View on Block Explorer for pending transaction", () => {
    renderComponent(pendingTransaction);

    expect(
      screen.queryByText("View on Block Explorer"),
    ).not.toBeInTheDocument();
  });

  it("should show Speed Up and Cancel buttons for pending tx with nonce", () => {
    renderComponent(pendingTransaction);

    expect(screen.getByText("Speed Up")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("should not show Speed Up/Cancel buttons for pending tx without nonce", () => {
    renderComponent({
      ...pendingTransaction,
      nonce: undefined,
    });

    expect(
      screen.queryByRole("button", { name: /speed up/i }),
    ).not.toBeInTheDocument();
  });

  it("should display Replaced status badge", () => {
    renderComponent({
      ...sampleTransaction,
      pendingStatus: "replaced",
      replacementTransactionHash: "0xreplacement123",
      replacedByAction: "speed-up",
    });

    expect(screen.getByText("Replaced")).toBeInTheDocument();
  });

  it("should display replacement tx hash for replaced transaction", () => {
    renderComponent({
      ...sampleTransaction,
      pendingStatus: "replaced",
      replacementTransactionHash: "0xreplacement123",
      replacedByAction: "speed-up",
    });

    expect(screen.getByText("Replaced by (Speed Up)")).toBeInTheDocument();
    expect(screen.getByText("0xreplacement123")).toBeInTheDocument();
  });

  it("should display 'Cancelled by' label for cancelled transaction", () => {
    renderComponent({
      ...sampleTransaction,
      pendingStatus: "cancelled",
      replacementTransactionHash: "0xcancel123",
      replacedByAction: "cancel",
    });

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Cancelled by")).toBeInTheDocument();
    expect(screen.getByText("0xcancel123")).toBeInTheDocument();
  });

  it("should open speed-up dialog when Speed Up button clicked", async () => {
    renderComponent(pendingTransaction);

    await userEvent.click(screen.getByText("Speed Up"));

    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });
  });

  it("should open cancel dialog when Cancel button clicked", async () => {
    renderComponent(pendingTransaction);

    await userEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.getAllByText("Cancel Transaction").length).toBeGreaterThan(
        0,
      );
    });
  });

  it("should auto-open speed-up dialog when navigated with speed-up action", async () => {
    renderComponent(pendingTransaction, mockedStore(), "speed-up");

    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });
  });

  it("should auto-open cancel dialog when navigated with cancel action", async () => {
    renderComponent(pendingTransaction, mockedStore(), "cancel");

    await waitFor(() => {
      expect(screen.getAllByText("Cancel Transaction").length).toBeGreaterThan(
        0,
      );
    });
  });

  describe("replacement ordering", () => {
    const signedReplacement = {
      transactionHash: "0xreplacement",
      rawTransaction: "0xraw",
      error: "",
    };

    const openAndConfirmSpeedUp = async () => {
      await userEvent.click(screen.getByText("Speed Up"));
      await waitFor(() => {
        expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
      });
      const dialogButtons = screen.getAllByText("Speed Up");
      await userEvent.click(dialogButtons[dialogButtons.length - 1]);
    };

    it("leaves the original untouched when the broadcast is rejected", async () => {
      const updateTransaction = vi
        .fn<StoreType["transactionHistoryStore"]["updateTransaction"]>()
        .mockResolvedValue(undefined);
      renderComponent(
        pendingTransaction,
        mockedStore({
          qrlStore: {
            signAndSendReplacementTransaction: vi
              .fn()
              .mockResolvedValue(signedReplacement),
            sendRawTransaction: vi
              .fn()
              .mockRejectedValue(new Error("replacement underpriced")),
          },
          transactionHistoryStore: { updateTransaction },
        }),
      );

      await openAndConfirmSpeedUp();

      // The original is still the only live transaction, so it must not
      // read as "Replaced" with nothing behind it.
      await waitFor(() => {
        expect(updateTransaction).toHaveBeenCalled();
      });
      const markedReplaced = updateTransaction.mock.calls.some(
        (call) => call[2].pendingStatus === "replaced",
      );
      expect(markedReplaced).toBe(false);
    });

    it("marks the original replaced once the node accepts the broadcast", async () => {
      const updateTransaction = vi
        .fn<StoreType["transactionHistoryStore"]["updateTransaction"]>()
        .mockResolvedValue(undefined);
      renderComponent(
        pendingTransaction,
        mockedStore({
          qrlStore: {
            signAndSendReplacementTransaction: vi
              .fn()
              .mockResolvedValue(signedReplacement),
            sendRawTransaction: vi.fn(
              (_raw: string, onBroadcast?: (hash: string) => void) => {
                onBroadcast?.("0xreplacement");
                return Promise.resolve(undefined);
              },
            ),
          },
          transactionHistoryStore: { updateTransaction },
        }),
      );

      await openAndConfirmSpeedUp();

      await waitFor(() => {
        expect(updateTransaction).toHaveBeenCalledWith(
          pendingTransaction.from,
          pendingTransaction.transactionHash,
          expect.objectContaining({
            pendingStatus: "replaced",
            replacementTransactionHash: "0xreplacement",
          }),
        );
      });
    });

    it("does not settle the replacement on a receipt for another hash", async () => {
      const updateTransaction = vi
        .fn<StoreType["transactionHistoryStore"]["updateTransaction"]>()
        .mockResolvedValue(undefined);
      renderComponent(
        pendingTransaction,
        mockedStore({
          qrlStore: {
            signAndSendReplacementTransaction: vi
              .fn()
              .mockResolvedValue(signedReplacement),
            sendRawTransaction: vi.fn().mockResolvedValue({
              status: 1n,
              blockNumber: 9n,
              transactionHash: "0xsomethingelse",
            }),
          },
          transactionHistoryStore: { updateTransaction },
        }),
      );

      await openAndConfirmSpeedUp();

      await waitFor(() => {
        expect(updateTransaction).toHaveBeenCalled();
      });
      const confirmed = updateTransaction.mock.calls.some(
        (call) => call[2].pendingStatus === "confirmed",
      );
      expect(confirmed).toBe(false);
    });
  });

  it.each(["broadcast", "receipt", "rejection"] as const)(
    "reports history persistence failure from the %s handler",
    async (phase) => {
      const failure = new Error("History storage unavailable");
      const broadcastFailure = new Error("Broadcast unavailable");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const updateTransaction = vi
        .fn<StoreType["transactionHistoryStore"]["updateTransaction"]>()
        .mockRejectedValue(failure);
      const sendRawTransaction = vi.fn(
        (_raw: string, onBroadcast?: (hash: string) => void) => {
          if (phase === "broadcast") {
            onBroadcast?.("0xreplacement");
            return new Promise<undefined>(() => {});
          }
          return phase === "rejection"
            ? Promise.reject(broadcastFailure)
            : Promise.resolve(undefined);
        },
      );
      try {
        renderComponent(
          pendingTransaction,
          mockedStore({
            qrlStore: {
              signAndSendReplacementTransaction: vi.fn().mockResolvedValue({
                transactionHash: "0xreplacement",
                rawTransaction: "0xraw",
                error: "",
              }),
              sendRawTransaction,
            },
            transactionHistoryStore: { updateTransaction },
          }),
          "speed-up",
        );
        const dialog = await screen.findByRole("alertdialog");
        await userEvent.click(
          within(dialog).getByRole("button", { name: "Speed Up" }),
        );
        await waitFor(() => {
          expect(report).toHaveBeenCalledWith(
            phase === "broadcast"
              ? "[handleReplacement] Failed to update original transaction:"
              : "[handleReplacement] Failed to update transaction history:",
            failure,
          );
        });
        expect(updateTransaction).toHaveBeenCalledTimes(1);
        expect(updateTransaction).toHaveBeenCalledWith(
          pendingTransaction.from,
          phase === "rejection"
            ? "0xreplacement"
            : pendingTransaction.transactionHash,
          expect.objectContaining({
            pendingStatus: phase === "rejection" ? "unknown" : "replaced",
          }),
        );
      } finally {
        report.mockRestore();
      }
    },
  );

  it("keeps a signing rejection visible in the replacement dialog", async () => {
    renderComponent(
      pendingTransaction,
      mockedStore({
        qrlStore: {
          signAndSendReplacementTransaction: vi
            .fn()
            .mockRejectedValue(new Error("Signing unavailable")),
        },
      }),
      "speed-up",
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speed Up" }),
    );
    expect(
      await screen.findByText("Speed up failed: Error: Signing unavailable"),
    ).toBeInTheDocument();
  });

  it("should not call sendRawTransaction for Ledger account replacement", async () => {
    isLedgerAccount.mockResolvedValueOnce(true);

    const mockSendRawTransaction = vi.fn();
    const store = mockedStore({
      qrlStore: {
        sendRawTransaction: mockSendRawTransaction,
      },
    });

    renderComponent(pendingTransaction, store);

    await userEvent.click(screen.getByText("Speed Up"));
    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByText("Speed Up");
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);

    // Wait for async handleReplacement to complete
    await waitFor(() => {
      expect(isLedgerAccount).toHaveBeenCalledWith(pendingTransaction.from);
    });

    expect(mockSendRawTransaction).not.toHaveBeenCalled();
  });

  it("should not call signAndSendReplacement when mnemonic is empty", async () => {
    const mockSign = vi.fn().mockResolvedValue({
      transactionHash: undefined,
      rawTransaction: undefined,
      error: "",
    });
    const mockGetMnemonic = vi.fn().mockResolvedValue("");
    const store = mockedStore({
      lockStore: {
        getMnemonicPhrases: mockGetMnemonic,
      },
      qrlStore: {
        signAndSendReplacementTransaction: mockSign,
      },
    });

    renderComponent(pendingTransaction, store);

    await userEvent.click(screen.getByText("Speed Up"));
    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByText("Speed Up");
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(mockGetMnemonic).toHaveBeenCalled();
    });

    expect(mockSign).not.toHaveBeenCalled();
  });

  it("should not call sendRawTransaction when signAndSend returns error", async () => {
    const mockSendRaw = vi.fn();
    const mockSign = vi.fn().mockResolvedValue({
      transactionHash: undefined,
      rawTransaction: undefined,
      error: "Insufficient funds for gas",
    });
    const store = mockedStore({
      qrlStore: {
        signAndSendReplacementTransaction: mockSign,
        sendRawTransaction: mockSendRaw,
      },
    });

    renderComponent(pendingTransaction, store);

    await userEvent.click(screen.getByText("Speed Up"));
    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByText("Speed Up");
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(mockSign).toHaveBeenCalled();
    });

    expect(mockSendRaw).not.toHaveBeenCalled();
  });

  it("should handle successful replacement flow", async () => {
    const mockUpdateTransaction = vi.fn().mockResolvedValue(undefined);
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);

    const store = mockedStore({
      qrlStore: {
        signAndSendReplacementTransaction: () =>
          Promise.resolve({
            transactionHash: "0xnewtx123",
            rawTransaction: "0xraw123",
            error: "",
          }),
        sendRawTransaction: () =>
          Promise.resolve({
            transactionHash: "0xnewtx123",
            transactionIndex: 0n,
            blockHash: "0xblock",
            from: pendingTransaction.from,
            to: pendingTransaction.to,
            cumulativeGasUsed: 21000n,
            logs: [],
            logsBloom: "0x",
            root: "0x",
            status: BigInt(1),
            blockNumber: BigInt(200),
            gasUsed: BigInt(21000),
            effectiveGasPrice: BigInt(2000000000),
          }),
      },
      transactionHistoryStore: {
        updateTransaction: mockUpdateTransaction,
        addTransaction: mockAddTransaction,
      },
    });

    renderComponent(pendingTransaction, store);

    await userEvent.click(screen.getByText("Speed Up"));
    await waitFor(() => {
      expect(screen.getByText("Speed Up Transaction")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByText("Speed Up");
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(mockUpdateTransaction).toHaveBeenCalledWith(
        pendingTransaction.from,
        pendingTransaction.transactionHash,
        expect.objectContaining({
          pendingStatus: "replaced",
          replacementTransactionHash: "0xnewtx123",
          replacedByAction: "speed-up",
        }),
      );
    });

    expect(mockAddTransaction).toHaveBeenCalled();
  });

  it("should display Dropped status badge", () => {
    renderComponent({
      ...sampleTransaction,
      pendingStatus: "dropped",
    });

    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });
});
