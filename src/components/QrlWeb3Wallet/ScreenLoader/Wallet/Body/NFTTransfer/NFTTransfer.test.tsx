import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import NFTTransfer from "./NFTTransfer";

const { mockResolveQrnsName } = vi.hoisted(() => ({
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
  afterEach(cleanup);

  beforeEach(() => {
    mockResolveQrnsName.mockReset();
  });

  const renderComponent = (
    state = defaultState,
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
        btn.textContent?.includes("Send NFT") &&
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
          } as any,
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
        ledgerStore: { isLedgerAccount: () => true } as any,
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
      defaultState,
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
      resolveBob(CURRENT_RESOLVED_ACCOUNT);
    });
    expect(
      await screen.findByText(
        formatQrlAddressFingerprint(CURRENT_RESOLVED_ACCOUNT),
      ),
    ).toBeInTheDocument();

    await act(async () => {
      resolveAlice(RESOLVED_ACCOUNT);
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
});
