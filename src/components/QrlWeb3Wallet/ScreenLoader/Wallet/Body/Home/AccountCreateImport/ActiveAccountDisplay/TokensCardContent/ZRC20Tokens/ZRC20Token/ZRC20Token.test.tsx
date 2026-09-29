import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import ZRC20Token from "./ZRC20Token";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    getTokenContractsList: vi.fn(async () => [
      {
        address: "Q28c4113a9d3a2e836f28c23ed8e3c1e7c243f566",
        image: "testImage1",
      },
      {
        address: "Q978918b7b544ad491d0b294cc6ac4d7bb0ef7112",
        image: "testImage2",
      },
      {
        address: "Q0db3981cb93db985e4e3a62ff695f7a1b242dd7c",
        image: "testImage3",
      },
    ]),
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItemLoading/TokenListItemLoading",
  () => ({ default: () => <div>Mocked Token List Item Loading</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItem/TokenListItem",
  () => ({
    default: ({ balance }: { balance: string }) => (
      <div>Mocked Token List Item {balance}</div>
    ),
  }),
);

const CONTRACT = "Q0db3981cb93db985e4e3a62ff695f7a1b242dd7c";

const successfulDetails = (balance: number) => ({
  token: {
    balance,
    balanceBaseUnits: `${balance}000000000000000000`,
    decimals: BigInt(18),
    name: "POWERCOIN",
    symbol: "POW",
    totalSupply: 100000,
    image: "",
  },
  error: "",
});

describe("ZRC20Token", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    storedSymbol?: string,
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <ZRC20Token
              contractAddress={CONTRACT}
              tokenImage=""
              storedSymbol={storedSymbol}
            />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the zrc 20 token component", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getZrc20TokenDetails: async (_contractAddress: string) =>
            successfulDetails(65),
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Mocked Token List Item/)).toBeInTheDocument();
    });
  });

  it("shows the stored symbol with a retry when the chain read fails", async () => {
    const getZrc20TokenDetails = vi
      .fn()
      .mockResolvedValueOnce({ token: undefined, error: "rpc down" })
      .mockResolvedValueOnce(successfulDetails(12));

    renderComponent(mockedStore({ qrlStore: { getZrc20TokenDetails } }), "POW");

    // The error path used to set nothing at all, leaving the row a loading
    // skeleton for the rest of the session.
    await waitFor(() => {
      expect(screen.getByText("POW")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Mocked Token List Item Loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Token details unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText(/Mocked Token List Item/)).toBeInTheDocument();
    });
  });

  it("discards a stale lookup after a fast account switch back and forth", async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    const getZrc20TokenDetails = vi
      .fn()
      // Account A's first lookup hangs.
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      )
      // Account B.
      .mockResolvedValueOnce(successfulDetails(2))
      // Back on account A, with a different balance than the hung call.
      .mockResolvedValueOnce(successfulDetails(3));

    const storeFor = (accountAddress: string) =>
      mockedStore({
        qrlStore: {
          activeAccount: { accountAddress },
          getZrc20TokenDetails,
        },
      });

    const accountA = `Q${"a".repeat(128)}`;
    const accountB = `Q${"b".repeat(128)}`;

    const view = renderComponent(storeFor(accountA));
    await waitFor(() => expect(getZrc20TokenDetails).toHaveBeenCalledTimes(1));

    const rerenderWith = (accountAddress: string) =>
      view.rerender(
        <StoreProvider value={storeFor(accountAddress)}>
          <MemoryRouter>
            <TooltipProvider>
              <ZRC20Token contractAddress={CONTRACT} tokenImage="" />
            </TooltipProvider>
          </MemoryRouter>
        </StoreProvider>,
      );

    rerenderWith(accountB);
    await waitFor(() => expect(getZrc20TokenDetails).toHaveBeenCalledTimes(2));
    rerenderWith(accountA);
    await waitFor(() => expect(getZrc20TokenDetails).toHaveBeenCalledTimes(3));

    await waitFor(() => {
      expect(screen.getByText(/Mocked Token List Item/)).toBeInTheDocument();
    });
    const newestRow = screen.getByText(/Mocked Token List Item/);
    expect(newestRow).toHaveTextContent("3.0 POW");

    // The very first lookup now resolves, last of all. It carries account
    // A's balance from before the switches and must not land.
    releaseFirst(successfulDetails(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/Mocked Token List Item/)).toHaveTextContent(
      "3.0 POW",
    );
  });
});
