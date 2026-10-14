import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WatchAssetVerification from "./WatchAssetVerification";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainDetails/CurrencyImagePreload/CurrencyImagePreload",
  () => ({ default: () => <div>Mocked Currency Image Preload</div> }),
);

describe("WatchAssetVerification", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    mockedStoreValues = mockedStore({
      dAppRequestStore: {
        dAppRequestData: {
          params: [
            {
              options: {
                address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
                symbol: "TST",
                image: "testImage",
                decimals: 18,
              },
            },
          ],
        },
      },
      qrlStore: {
        getZrc20TokenDetails: () =>
          Promise.resolve({
            token: {
              balance: 2,
              balanceBaseUnits: "2000000000000000000",
              decimals: 18n,
              image: "testImage",
              name: "Test Name",
              symbol: "TST",
              totalSupply: 100,
            },
            error: "",
          }),
      },
    }),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <WatchAssetVerification />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the watch asset verification component when there are no mismatch", async () => {
    renderComponent();

    expect(screen.getByText("Verifying token details...")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(
          "Ensure you understand what you are doing before adding the token.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("should render the watch asset verification component when there is a mismatch", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [
              {
                options: {
                  address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
                  symbol: "TST",
                  image: "testImage",
                  decimals: 18,
                },
              },
            ],
          },
        },
        qrlStore: {
          getZrc20TokenDetails: () =>
            Promise.resolve({
              token: {
                balance: 2,
                balanceBaseUnits: "2000000000000000000",
                decimals: 18n,
                image: "testImage",
                name: "Test Name",
                symbol: "NOMATCH",
                totalSupply: 100,
              },
              error: "",
            }),
        },
      }),
    );

    expect(screen.getByText("Verifying token details...")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(
          "The token symbol did not match. Expected 'NOMATCH', but received 'TST'",
        ),
      ).toBeInTheDocument();
    });
  });

  const options = {
    address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
    symbol: "TST",
    decimals: 18,
  };

  it.each([
    { token: undefined, error: "RPC failed" },
    { token: undefined, error: "" },
  ])(
    "shows fetch failure when token details are unavailable: %j",
    async (details) => {
      renderComponent(
        mockedStore({
          dAppRequestStore: { dAppRequestData: { params: [{ options }] } },
          qrlStore: { getZrc20TokenDetails: () => Promise.resolve(details) },
        }),
      );
      expect(
        await screen.findByText(/Failed to fetch details for/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Verifying token details..."),
      ).not.toBeInTheDocument();
    },
  );

  it("shows fetch failure and reports a rejected token lookup", async () => {
    const error = new Error("RPC unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: { dAppRequestData: { params: [{ options }] } },
        qrlStore: { getZrc20TokenDetails: () => Promise.reject(error) },
      }),
    );
    expect(
      await screen.findByText(/Failed to fetch details for/i),
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Failed to verify token details",
      error,
    );
  });

  it.each(
    [
      undefined,
      null,
      "params",
      [],
      [{ options: null }],
      [{ options: { ...options, symbol: {} } }],
      ...["18", "invalid", null, 1.5, NaN, Infinity, -1, 37].map((decimals) => [
        { options: { ...options, decimals } },
      ]),
    ].map((params) => ({ params })),
  )(
    "handles malformed token parameters without a lookup: %j",
    async ({ params }) => {
      const getZrc20TokenDetails =
        vi.fn<StoreType["qrlStore"]["getZrc20TokenDetails"]>();
      renderComponent(
        mockedStore({
          dAppRequestStore: { dAppRequestData: { params } },
          qrlStore: { getZrc20TokenDetails },
        }),
      );
      expect(
        await screen.findByText(/Failed to fetch details for/i),
      ).toBeInTheDocument();
      expect(getZrc20TokenDetails).not.toHaveBeenCalled();
    },
  );

  it("preserves the decimal mismatch warning", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: { dAppRequestData: { params: { 0: { options } } } },
        qrlStore: {
          getZrc20TokenDetails: () =>
            Promise.resolve({
              token: {
                name: "Test",
                symbol: "TST",
                decimals: 6n,
                balance: 2,
                balanceBaseUnits: "2000000",
                totalSupply: 100,
                image: "",
              },
              error: "",
            }),
        },
      }),
    );
    expect(
      await screen.findByText(/decimals did not match.*6.*18/i),
    ).toBeInTheDocument();
  });
});
