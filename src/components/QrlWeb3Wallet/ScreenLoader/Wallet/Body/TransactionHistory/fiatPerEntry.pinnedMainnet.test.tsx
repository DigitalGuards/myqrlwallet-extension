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
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: { tabs: { create: vi.fn().mockResolvedValue({}) } },
}));
vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    isLedgerAccount: vi.fn().mockResolvedValue(false),
    getActiveBlockChain: vi.fn().mockResolvedValue({ chainId: "0x1" }),
  },
}));

import { mockedStore } from "@/__mocks__/mockedStore";
import { QRL_MAINNET_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import { V3_CHAIN_ID } from "@/configuration/releaseProfile";
import { StoreProvider } from "@/stores/store";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransactionDetail from "./TransactionDetail/TransactionDetail";
import TransactionHistoryItem from "./TransactionHistoryItem/TransactionHistoryItem";

/**
 * Fiat values in history follow each entry's own chain. The active
 * network being a verified pinned mainnet is not enough: entries from the
 * chain that was active before a switch stay unpriced.
 */

const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const OTHER_ACCOUNT = `Q${"b".repeat(128)}`;

const entryOn = (chainId: string): TransactionHistoryEntry => ({
  id: "0xtxhash1",
  from: ACTIVE_ACCOUNT,
  to: OTHER_ACCOUNT,
  amount: 10,
  tokenSymbol: "Quanta",
  tokenName: "Quanta",
  isZrc20Token: false,
  tokenContractAddress: "",
  tokenDecimals: 18,
  transactionHash: "0xtxhash1",
  blockNumber: "100",
  gasUsed: "21000",
  effectiveGasPrice: "1000000000",
  status: true,
  timestamp: 1700000000000,
  chainId,
});

// The active network is the verified pinned mainnet in every case here.
const storeOnVerifiedMainnet = () => {
  if (QRL_MAINNET_BLOCKCHAIN === null) {
    throw new Error("The pinned test build has no mainnet built-in");
  }
  return mockedStore({
    priceStore: {
      quoteFor: (currency: string) => ({
        price: 1.5,
        currency,
        change24h: 0,
      }),
    },
    settingsStore: { showBalanceAndPrice: true, currency: "USD" },
    qrlStore: {
      isFiatNetwork: true,
      qrlConnection: { blockchain: QRL_MAINNET_BLOCKCHAIN },
    },
  });
};

const renderItem = (transaction: TransactionHistoryEntry) =>
  render(
    <StoreProvider value={storeOnVerifiedMainnet()}>
      <MemoryRouter>
        <TransactionHistoryItem transaction={transaction} />
      </MemoryRouter>
    </StoreProvider>,
  );

const renderDetail = (transaction: TransactionHistoryEntry) =>
  render(
    <StoreProvider value={storeOnVerifiedMainnet()}>
      <MemoryRouter
        initialEntries={[
          { pathname: "/transaction-detail", state: { transaction } },
        ]}
      >
        <TransactionDetail />
      </MemoryRouter>
    </StoreProvider>,
  );

describe("fiat values per history entry, with mainnet pinned", () => {
  afterEach(cleanup);

  it("prices a mainnet entry in the list", () => {
    renderItem(entryOn(TEST_MAINNET.chainId));

    // 10 Quanta at $1.50
    expect(screen.getByText("≈ $15.00")).toBeInTheDocument();
  });

  it("leaves a testnet entry unpriced in the list", () => {
    renderItem(entryOn(V3_CHAIN_ID));

    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("prices a mainnet entry in the detail view", () => {
    renderDetail(entryOn(TEST_MAINNET.chainId));

    // The amount and the total cost, which adds a fee too small to move it.
    expect(screen.getAllByText("≈ $15.00")).toHaveLength(2);
  });

  it("leaves a testnet entry unpriced in the detail view", () => {
    renderDetail(entryOn(V3_CHAIN_ID));

    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("gives a mainnet entry no explorer link while the mainnet pin names no explorer", () => {
    renderDetail(entryOn(TEST_MAINNET.chainId));

    expect(
      screen.queryByText("View on Block Explorer"),
    ).not.toBeInTheDocument();
  });
});
