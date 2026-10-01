import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetBalance, mockIsListening } = vi.hoisted(() => ({
  mockGetBalance: vi.fn().mockResolvedValue(BigInt(0)),
  mockIsListening: vi.fn().mockResolvedValue(true),
}));

vi.mock("@theqrl/web3", () => {
  class MockWeb3 {
    static providers = { HttpProvider: class {} };
    qrl = { getBalance: mockGetBalance, net: { isListening: mockIsListening } };
    constructor(_opts: unknown) {}
  }
  return {
    __esModule: true,
    default: MockWeb3,
    utils: { fromPlanck: (v: bigint) => (Number(v) / 1e18).toString() },
  };
});

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAllAccounts: vi.fn().mockResolvedValue([]),
    getAllBlockChains: vi.fn().mockResolvedValue([]),
    getActiveBlockChain: vi.fn().mockResolvedValue(""),
    setActiveBlockChain: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn().mockResolvedValue(""),
    setActiveAccount: vi.fn().mockResolvedValue(undefined),
    clearActiveAccount: vi.fn().mockResolvedValue(undefined),
    setAllAccounts: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: mockStorage,
}));

vi.mock("@/configuration/releaseProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@/configuration/releaseProfile")
  >("@/configuration/releaseProfile");
  return { ...actual, assertV3Network: vi.fn().mockResolvedValue(undefined) };
});

import { mockedStore } from "@/__mocks__/mockedStore";
import AccountId from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountId/AccountId";
import ActiveAccountDisplay from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";
import AccountAddressSection from "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/AccountAddressSection/AccountAddressSection";
import { StoreProvider } from "@/stores/store";
import type { StoreType } from "@/stores/store";
import { cleanup, render, screen } from "@testing-library/react";
import { isAction, runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import QrlStore from "./qrlStore";

const ACCOUNT = "Q79b662ce3d663643df4454a8ba3f532c0de6887f";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * A real QrlStore, initialized, with one account holding `balance`.
 *
 * The point of this file is that the reader under test is the production
 * one. A hand-written stand-in would annotate itself however the test
 * wanted and prove nothing about the store.
 */
const realStore = async (balance: bigint) => {
  mockGetBalance.mockResolvedValue(balance);
  const store = new QrlStore();
  await flush();
  store.stopBalancePolling();
  return store;
};

/**
 * The mocked store with only the balance reader and the account list
 * replaced by the real store's, so each component keeps its cheap mocked
 * collaborators and still reads balances through production code.
 */
const storeWithRealBalances = (real: QrlStore): StoreType => {
  const base = mockedStore();
  const qrlStore = Object.create(base.qrlStore) as QrlStore;
  Object.defineProperties(qrlStore, {
    getAccountBalance: { value: real.getAccountBalance },
    activeAccount: { value: { accountAddress: ACCOUNT } },
  });
  return { ...base, qrlStore };
};

const setBalance = (real: QrlStore, accountBalance: string) =>
  act(() => {
    runInAction(() => {
      real.qrlAccounts = {
        ...real.qrlAccounts,
        accounts: [{ accountAddress: ACCOUNT, accountBalance }],
      };
    });
  });

const renderWith = (store: StoreType, children: ReactNode) =>
  render(
    <StoreProvider value={store}>
      <MemoryRouter>{children}</MemoryRouter>
    </StoreProvider>,
  );

describe("balance reads stay reactive", () => {
  beforeEach(() => {
    mockGetBalance.mockReset().mockResolvedValue(BigInt(0));
    mockIsListening.mockReset().mockResolvedValue(true);
    mockStorage.getAllAccounts.mockResolvedValue([ACCOUNT]);
    mockStorage.getActiveAccount.mockResolvedValue(ACCOUNT);
    mockStorage.getActiveBlockChain.mockResolvedValue({
      chainId: "0x301825",
      chainName: "v3 Private",
      defaultRpcUrl: "http://rpc.invalid",
    });
  });

  afterEach(cleanup);

  it("keeps getAccountBalance out of MobX's action wrapper", async () => {
    const real = await realStore(BigInt(1e18));

    // Annotated as an action it runs untracked, which is exactly how the
    // account rows froze at their first painted number.
    expect(isAction(real.getAccountBalance)).toBe(false);
  });

  it("survives being destructured off the store", async () => {
    const real = await realStore(BigInt(1e18));
    const { getAccountBalance } = real;

    // Every consumer destructures it, so an unbound prototype method
    // would throw on the first call.
    expect(getAccountBalance(ACCOUNT)).toBe("1.0 Quanta");
  });

  it("re-renders a destructured reader when the balance changes", async () => {
    const real = await realStore(BigInt(1e18));
    const Probe = observer(() => {
      const { getAccountBalance } = real;
      return <span data-testid="probe">{getAccountBalance(ACCOUNT)}</span>;
    });

    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("1.0 Quanta");

    setBalance(real, "4.00 Quanta");
    expect(screen.getByTestId("probe")).toHaveTextContent("4.00 Quanta");
  });

  it("re-renders an account-list row when the balance changes", async () => {
    const real = await realStore(BigInt(1e18));
    renderWith(storeWithRealBalances(real), <AccountId account={ACCOUNT} />);

    expect(screen.getByText("1.00 Quanta")).toBeInTheDocument();

    setBalance(real, "4.50 Quanta");

    expect(screen.getByText("4.50 Quanta")).toBeInTheDocument();
    expect(screen.queryByText("1.00 Quanta")).not.toBeInTheDocument();
  });

  it("re-renders the Home hero balance when the balance changes", async () => {
    const real = await realStore(BigInt(1e18));
    renderWith(storeWithRealBalances(real), <ActiveAccountDisplay />);

    expect(screen.getByText("1.00")).toBeInTheDocument();

    setBalance(real, "4.50 Quanta");

    expect(screen.getByText("4.50")).toBeInTheDocument();
    expect(screen.queryByText("1.00")).not.toBeInTheDocument();
  });

  it("re-renders the send form's account balance when it changes", async () => {
    const real = await realStore(BigInt(1e18));
    renderWith(storeWithRealBalances(real), <AccountAddressSection />);

    // Shown exactly as the store formats it, with no second rounding pass.
    expect(screen.getByText("1.0 Quanta")).toBeInTheDocument();

    setBalance(real, "4.50 Quanta");

    expect(screen.getByText("4.50 Quanta")).toBeInTheDocument();
    expect(screen.queryByText("1.0 Quanta")).not.toBeInTheDocument();
  });
});
