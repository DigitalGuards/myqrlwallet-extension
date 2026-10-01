import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import AccountLabelsStore from "@/stores/accountLabelsStore";
import AccountBadge from "./AccountBadge";

// Storage that never answers, which is the state the chip is in for the
// first renders after an import, a creation or an unlock: the account is
// already active while its stored label is still on its way.
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn(() => new Promise(() => {})),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
        clear: vi.fn(() => Promise.resolve()),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  },
}));

const ACCOUNT_ONE = "Q20fB08fF1f1376A14C055E9F56df80563E16722b";
const ACCOUNT_TWO = "Q20B714091cF2a62DADda2847803e3f1B9D2D3779";

describe("AccountBadge", () => {
  afterEach(cleanup);

  const storeWith = (
    accounts: string[],
    activeAccountAddress: string,
    labels: Record<string, string> = {},
  ): StoreType => {
    const accountLabelsStore = new AccountLabelsStore();
    accountLabelsStore.labels = labels;
    return {
      ...mockedStore({
        qrlStore: {
          activeAccount: { accountAddress: activeAccountAddress },
          qrlAccounts: {
            isLoading: false,
            accounts: accounts.map((accountAddress) => ({
              accountAddress,
              accountBalance: "0.0 Quanta",
            })),
          },
        },
      }),
      accountLabelsStore,
    };
  };

  const renderComponent = (mockedStoreValues: StoreType) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <AccountBadge />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("names a freshly active account from its position while the stored labels are still loading", () => {
    renderComponent(storeWith([ACCOUNT_ONE], ACCOUNT_ONE));

    expect(screen.getByText("Account 1")).toBeInTheDocument();
  });

  it("never shows the raw address while the stored labels are still loading", () => {
    renderComponent(storeWith([ACCOUNT_ONE], ACCOUNT_ONE));

    expect(
      screen.queryByText(formatQrlAddressFingerprint(ACCOUNT_ONE)),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_ONE)).not.toBeInTheDocument();
  });

  it("counts positions from the account list, so the second account reads Account 2", () => {
    renderComponent(storeWith([ACCOUNT_ONE, ACCOUNT_TWO], ACCOUNT_TWO));

    expect(screen.getByText("Account 2")).toBeInTheDocument();
  });

  it("prefers a stored label over the positional name", () => {
    renderComponent(
      storeWith([ACCOUNT_ONE], ACCOUNT_ONE, { [ACCOUNT_ONE]: "Savings" }),
    );

    expect(screen.getByText("Savings")).toBeInTheDocument();
  });

  it("shows the wallet marker alone while the account is not listed yet", () => {
    renderComponent(storeWith([], ACCOUNT_ONE));

    expect(
      screen.queryByText(formatQrlAddressFingerprint(ACCOUNT_ONE)),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Accounts: ${ACCOUNT_ONE}` }),
    ).toBeInTheDocument();
  });

  it("keeps the exact address on the chip for assistive technology", () => {
    renderComponent(storeWith([ACCOUNT_ONE], ACCOUNT_ONE));

    expect(
      screen.getByRole("button", { name: `Accounts: ${ACCOUNT_ONE}` }),
    ).toBeInTheDocument();
  });

  it("renders nothing without an active account", () => {
    renderComponent(storeWith([], ""));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
