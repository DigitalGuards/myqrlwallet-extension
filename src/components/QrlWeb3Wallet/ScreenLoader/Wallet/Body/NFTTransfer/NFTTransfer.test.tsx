import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, type NavigateFunction } from "react-router-dom";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import NFTTransfer from "./NFTTransfer";
import { deferred } from "@/test-utils/deferred";
import * as resolvers from "@hookform/resolvers/zod";

vi.mock("@hookform/resolvers/zod", async () => ({
  ...(await vi.importActual<typeof import("@hookform/resolvers/zod")>(
    "@hookform/resolvers/zod",
  )),
}));
import { fireEvent } from "@testing-library/react";

const { mockResolveQrnsName, mockNavigate } = vi.hoisted(() => ({
  mockResolveQrnsName:
    vi.fn<typeof import("@/utilities/qrnsResolver").resolveQrnsName>(),
  mockNavigate: vi.fn<NavigateFunction>(),
}));

vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/utilities/qrnsResolver", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/qrnsResolver")
  >("@/utilities/qrnsResolver");
  return {
    ...originalModule,
    resolveQrnsName: mockResolveQrnsName,
  };
});

const defaultState = {
  contractAddress: `Q${"a".repeat(128)}`,
  tokenId: "7",
  collectionName: "TestNFT",
  imageUrl: "https://example.com/nft.png",
  nftName: "Cool Token #7",
};
const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const RESOLVED_ACCOUNT = toChecksumAddress(`Q${"b".repeat(128)}`);
const CURRENT_RESOLVED_ACCOUNT = toChecksumAddress(`Q${"c".repeat(128)}`);
const QRNS_REGISTRY = toChecksumAddress(`Q${"e".repeat(128)}`);
const QRNS_RPC_URL = "https://qns-rpc.example";

describe("NFTTransfer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockResolveQrnsName.mockReset();
    mockNavigate.mockReset();
  });

  const renderComponent = (
    state: unknown = defaultState,
    mockedStoreValues = mockedStore(),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter initialEntries={[{ pathname: "/nft-transfer", state }]}>
          <NFTTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the send NFT heading", () => {
    renderComponent();
    expect(
      screen.getByRole("heading", { name: "Send NFT" }),
    ).toBeInTheDocument();
  });

  it("should display NFT name and token ID", () => {
    renderComponent();
    expect(screen.getByText("Cool Token #7")).toBeInTheDocument();
    expect(screen.getByText("Token #7")).toBeInTheDocument();
  });

  it("should render receiver address input", () => {
    renderComponent();
    const input = screen.getByRole("textbox", { name: "receiverAddress" });
    expect(input).toBeInTheDocument();
  });

  it("should render cancel and send buttons", () => {
    renderComponent();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getAllByText("Send NFT").length).toBeGreaterThanOrEqual(1);
  });

  it("should render address book button", () => {
    renderComponent();
    expect(
      screen.getByRole("button", { name: /address book/i }),
    ).toBeInTheDocument();
  });

  it("should render NFT image when provided", () => {
    renderComponent();
    const img = screen.getByAltText("Cool Token #7");
    expect(img).toHaveAttribute("src", "https://example.com/nft.png");
  });

  it("should show fallback when no image URL", () => {
    renderComponent({
      ...defaultState,
      imageUrl: "",
      nftName: "",
    });
    expect(screen.getByText("TestNFT #7")).toBeInTheDocument();
  });

  it("should have a back button", () => {
    renderComponent();
    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });

  it("should have send button disabled when form is empty", () => {
    renderComponent();
    const sendButtons = screen.getAllByRole("button");
    const sendButton = sendButtons.find(
      (btn) =>
        btn.textContent.includes("Send NFT") &&
        btn.getAttribute("type") !== "button",
    );
    expect(sendButton).toBeDisabled();
  });

  it("fails closed when the active chain has no QRNS registry", async () => {
    renderComponent();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );

    expect(
      await screen.findByText("QRNS is not configured for this chain"),
    ).toBeInTheDocument();
    expect(mockResolveQrnsName).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send NFT" })).toBeDisabled();
  });

  it("uses the current configured QRNS result for NFT signing", async () => {
    mockResolveQrnsName.mockResolvedValue(RESOLVED_ACCOUNT);
    const mockSignNftTransfer = vi.fn().mockResolvedValue({
      transactionHash: "0xtxhash",
      rawTransaction: "0xraw",
      error: "",
    });

    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          },
          signNftTransfer: mockSignNftTransfer,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );

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
          screen.getByText(formatQrlAddressFingerprint(RESOLVED_ACCOUNT)),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    await waitFor(() => {
      expect(mockSignNftTransfer).toHaveBeenCalledWith(
        ACTIVE_ACCOUNT,
        RESOLVED_ACCOUNT,
        "7",
        expect.any(String),
        defaultState.contractAddress,
        "ZRC721",
        "1",
      );
    });
  });

  it("refuses a Ledger account an NFT transfer with an explicit message", async () => {
    const mockSignNftTransfer = vi.fn();

    renderComponent(
      defaultState,
      mockedStore({
        ledgerStore: { isLedgerAccount: () => true },
        qrlStore: { signNftTransfer: mockSignNftTransfer },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    });

    expect(mockSignNftTransfer).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Sending NFTs from a Ledger account/),
    ).toBeInTheDocument();
  });

  it("does not settle an NFT transfer on a receipt for a different hash", async () => {
    const updateTransaction = vi.fn().mockResolvedValue(undefined);

    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          signNftTransfer: vi.fn().mockResolvedValue({
            transactionHash: "0xtxhash",
            rawTransaction: "0xraw",
            error: "",
          }),
          // A receipt that belongs to some other transaction proves
          // nothing about this one; the shared classifier rejects it.
          sendRawTransaction: vi.fn().mockResolvedValue({
            status: 1n,
            blockNumber: 9n,
            transactionHash: "0xsomethingelse",
          }),
        },
        transactionHistoryStore: { updateTransaction },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    });

    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("ignores an older in-flight QRNS result after the name changes", async () => {
    const alice = deferred<string>();
    const bob = deferred<string>();
    mockResolveQrnsName
      .mockReturnValueOnce(alice.promise)
      .mockReturnValueOnce(bob.promise);

    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          },
        },
      }),
    );

    const input = screen.getByRole("textbox", { name: "receiverAddress" });
    await userEvent.type(input, "alice.qrl");
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
      },
      { timeout: 3000 },
    );

    await userEvent.clear(input);
    await userEvent.type(input, "bob.qrl");
    await waitFor(
      () => {
        expect(mockResolveQrnsName).toHaveBeenCalledWith(
          "bob.qrl",
          expect.objectContaining({
            chainId: "0x301825",
            defaultRpcUrl: QRNS_RPC_URL,
            qrnsRegistryAddress: QRNS_REGISTRY,
          }),
        );
      },
      { timeout: 3000 },
    );

    await act(async () => {
      bob.resolve(CURRENT_RESOLVED_ACCOUNT);
      await bob.promise;
    });
    expect(
      await screen.findByText(
        formatQrlAddressFingerprint(CURRENT_RESOLVED_ACCOUNT),
      ),
    ).toBeInTheDocument();

    await act(async () => {
      alice.resolve(RESOLVED_ACCOUNT);
      await alice.promise;
    });
    expect(
      screen.queryByText(formatQrlAddressFingerprint(RESOLVED_ACCOUNT)),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(formatQrlAddressFingerprint(CURRENT_RESOLVED_ACCOUNT)),
    ).toBeInTheDocument();
  });

  it("shows a translated locked-wallet message and re-polls lock state when signing hits a locked wallet (L4)", async () => {
    const mockReadLockState = vi.fn().mockResolvedValue(undefined);
    const RECEIVER = `Q${"d".repeat(128)}`;

    renderComponent(
      defaultState,
      mockedStore({
        lockStore: {
          getMnemonicPhrases: vi
            .fn()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
          readLockState: mockReadLockState,
        },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RECEIVER,
    );
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));

    expect(
      await screen.findByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
    expect(mockReadLockState).toHaveBeenCalled();
  });
  it("warns while the balances are stale", async () => {
    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          qrlConnection: {
            isConnected: true,
            isLoading: false,
            areBalancesStale: true,
            blockchain: { chainId: "0x1" },
          },
        },
      }),
    );

    // The gas for an NFT transfer is spent from a native balance that is
    // just as stale as the rest.
    expect(
      await screen.findByText(
        "The node is not answering, so this balance may be out of date.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    null,
    [],
    { ...defaultState, tokenId: 7 },
    { ...defaultState, standard: "ZRC20" },
    { ...defaultState, balance: 3 },
  ])("blocks signing for malformed route state %j", async (state) => {
    const signNftTransfer = vi.fn();
    const getErc1155TokenBalance = vi.fn();
    renderComponent(
      state,
      mockedStore({ qrlStore: { signNftTransfer, getErc1155TokenBalance } }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    expect(screen.getByRole("button", { name: "Send NFT" })).toBeDisabled();
    expect(signNftTransfer).not.toHaveBeenCalled();
    expect(getErc1155TokenBalance).not.toHaveBeenCalled();
  });

  it("revalidates the selected amount when the live NFT balance arrives", async () => {
    const balance = deferred<string | undefined>();
    const signNftTransfer = vi.fn();
    const getErc1155TokenBalance = vi.fn().mockReturnValue(balance.promise);
    renderComponent(
      { ...defaultState, standard: "ZRC1155", balance: "3" },
      mockedStore({ qrlStore: { signNftTransfer, getErc1155TokenBalance } }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    const amount = screen.getByRole("textbox", { name: "amount" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "3");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send NFT" })).toBeEnabled();
    });
    await act(async () => {
      balance.resolve("2");
      await balance.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send NFT" })).toBeDisabled();
    });
    expect(getErc1155TokenBalance).toHaveBeenCalledWith(
      defaultState.contractAddress,
      "7",
    );
    expect(signNftTransfer).not.toHaveBeenCalled();
  });

  it("reports a rejected balance refresh and keeps the previous balance", async () => {
    const error = new Error("balance unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(
      { ...defaultState, standard: "ZRC1155", balance: "3" },
      mockedStore({
        qrlStore: {
          getErc1155TokenBalance: vi.fn().mockRejectedValue(error),
        },
      }),
    );
    expect(await screen.findByText("Token #7 · ×3")).toBeInTheDocument();
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to refresh NFT balance:",
        error,
      );
    });
  });

  it("ignores a stale balance after the token changes", async () => {
    const first = deferred<string | undefined>();
    const getErc1155TokenBalance = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("2");
    const store = mockedStore({ qrlStore: { getErc1155TokenBalance } });
    render(
      <StoreProvider value={store}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/nft-transfer",
              state: { ...defaultState, standard: "ZRC1155", balance: "3" },
            },
          ]}
        >
          <Link
            to="/nft-transfer"
            state={{
              ...defaultState,
              tokenId: "8",
              standard: "ZRC1155",
              balance: "3",
            }}
          >
            Next NFT
          </Link>
          <NFTTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Next NFT" }));
    expect(await screen.findByText("Token #8 · ×2")).toBeInTheDocument();
    await act(async () => {
      first.resolve("1");
      await first.promise;
    });
    expect(screen.getByText("Token #8 · ×2")).toBeInTheDocument();
  });

  it("records a pending NFT transfer before broadcasting and navigates while the receipt is pending", async () => {
    const receipt = deferred<undefined>();
    const addTransaction = vi.fn().mockResolvedValue(undefined);
    const sendRawTransaction = vi.fn().mockReturnValue(receipt.promise);
    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          signNftTransfer: vi.fn().mockResolvedValue({
            transactionHash: "0xtxhash",
            rawTransaction: "0xraw",
            error: "",
          }),
          sendRawTransaction,
        },
        transactionHistoryStore: { addTransaction },
      }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/transaction-history");
    });
    expect(addTransaction).toHaveBeenCalledWith(
      ACTIVE_ACCOUNT,
      expect.objectContaining({
        id: "0xtxhash",
        tokenName: "Cool Token #7 #7",
        pendingStatus: "pending",
        tokenContractAddress: defaultState.contractAddress,
      }),
    );
    expect(addTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      sendRawTransaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(sendRawTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0] ?? 0,
    );
    await act(async () => {
      receipt.resolve(undefined);
      await receipt.promise;
    });
  });

  it.each(["receipt", "broadcast", "refresh"])(
    "reports a rejected %s follow-up without another history write",
    async (failure) => {
      const error = new Error("follow-up unavailable");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const updateTransaction = vi.fn().mockResolvedValue(undefined);
      const fetchAccounts = vi.fn().mockResolvedValue(undefined);
      const sendRawTransaction = vi.fn().mockResolvedValue({
        status: 1n,
        blockNumber: 9n,
        transactionHash: "0xtxhash",
      });
      if (failure === "broadcast")
        sendRawTransaction.mockRejectedValueOnce(
          new Error("broadcast unavailable"),
        );
      if (failure === "refresh") fetchAccounts.mockRejectedValueOnce(error);
      else updateTransaction.mockRejectedValueOnce(error);
      renderComponent(
        defaultState,
        mockedStore({
          qrlStore: {
            signNftTransfer: vi.fn().mockResolvedValue({
              transactionHash: "0xtxhash",
              rawTransaction: "0xraw",
              error: "",
            }),
            sendRawTransaction,
            fetchAccounts,
          },
          transactionHistoryStore: { updateTransaction },
        }),
      );
      await userEvent.type(
        screen.getByRole("textbox", { name: "receiverAddress" }),
        RESOLVED_ACCOUNT,
      );
      await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[NFTTransfer] Failed to process broadcast result:",
          error,
        );
      });
      expect(updateTransaction).toHaveBeenCalledTimes(1);
      expect(updateTransaction).toHaveBeenCalledWith(
        ACTIVE_ACCOUNT,
        "0xtxhash",
        expect.objectContaining({
          pendingStatus: failure === "broadcast" ? "unknown" : "confirmed",
        }),
      );
      expect(fetchAccounts).toHaveBeenCalledTimes(
        failure === "refresh" ? 1 : 0,
      );
    },
  );

  it("keeps the locked-wallet error visible when lock-state refresh rejects", async () => {
    const error = new Error("refresh unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(
      defaultState,
      mockedStore({
        lockStore: {
          getMnemonicPhrases: vi
            .fn()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
          readLockState: vi.fn().mockRejectedValue(error),
        },
      }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(
      await screen.findByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith(
      "Failed to refresh wallet lock state:",
      error,
    );
  });

  it("reports rejected cancel navigation", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    mockNavigate.mockRejectedValueOnce(error);
    renderComponent();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(report).toHaveBeenCalledWith("Failed to close NFT transfer:", error);
  });

  it("reports a rejected amount validation", async () => {
    const error = new Error("validation unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolver: ReturnType<typeof resolvers.zodResolver> = (
      _values,
      _context,
      options,
    ) => {
      if (options.names?.length === 1 && options.names[0] === "amount") {
        return Promise.reject(error);
      }
      return Promise.resolve({ values: {}, errors: {} });
    };
    vi.spyOn(resolvers, "zodResolver").mockReturnValue(resolver);
    renderComponent({ ...defaultState, standard: "ZRC1155", balance: "3" });
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to validate NFT amount:",
        error,
      );
    });
  });

  it("reports a rejected form submission without signing", async () => {
    const error = new Error("validation unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolver = vi.fn(() => Promise.resolve({ values: {}, errors: {} }));
    vi.spyOn(resolvers, "zodResolver").mockReturnValue(resolver);
    const signNftTransfer = vi.fn();
    const view = renderComponent(
      defaultState,
      mockedStore({ qrlStore: { signNftTransfer } }),
    );
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Missing transfer form");
    await waitFor(() => {
      expect(resolver).toHaveBeenCalled();
    });
    resolver.mockRejectedValueOnce(error);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to submit NFT transfer:",
        error,
      );
    });
    expect(signNftTransfer).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/validation unavailable/),
    ).toBeInTheDocument();
  });

  it("reports rejected history navigation after broadcasting", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    mockNavigate.mockRejectedValueOnce(error);
    const sendRawTransaction = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      defaultState,
      mockedStore({
        qrlStore: {
          signNftTransfer: vi.fn().mockResolvedValue({
            transactionHash: "0xtxhash",
            rawTransaction: "0xraw",
            error: "",
          }),
          sendRawTransaction,
        },
      }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      RESOLVED_ACCOUNT,
    );
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(report).toHaveBeenCalledWith(
      "Failed to open transaction history:",
      error,
    );
    expect(sendRawTransaction).toHaveBeenCalledWith("0xraw");
  });
});
