import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WatchAssetInfo from "./WatchAssetInfo";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainDetails/CurrencyImagePreload/CurrencyImagePreload",
  () => ({
    default: ({ iconUrls }: { iconUrls: string[] }) => (
      <div data-icon-url={iconUrls[0]}>Mocked Currency Image Preload</div>
    ),
  }),
);

describe("WatchAssetInfo", () => {
  afterEach(cleanup);

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
    }),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <WatchAssetInfo />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the watch asset info component", () => {
    renderComponent();

    expect(screen.getByText("Token address")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20B71 4091c F2a62 DADda 28478 03e3f 1B9D2 D3779"),
    ).toBeInTheDocument();
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("TST")).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Currency Image Preload"),
    ).toBeInTheDocument();
    expect(screen.getByText("Decimals")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("Mocked Currency Image Preload")).toHaveAttribute(
      "data-icon-url",
      "testImage",
    );
  });

  it("uses an empty image URL for unfamiliar image metadata", () => {
    const image = { futureImage: "token.svg" };
    const options = {
      address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
      symbol: "TST",
      decimals: 18,
      image,
    };
    renderComponent(
      mockedStore({
        dAppRequestStore: { dAppRequestData: { params: [{ options }] } },
      }),
    );
    expect(screen.getByText("Mocked Currency Image Preload")).toHaveAttribute(
      "data-icon-url",
      "",
    );
    expect(screen.getByText("TST")).toBeInTheDocument();
    expect(options.image).toBe(image);
  });

  it.each(
    [
      undefined,
      null,
      "params",
      [],
      [{ options: null }],
      [{ options: { address: {}, symbol: {}, decimals: {} } }],
    ].map((params) => ({ params })),
  )("renders safe empty fields for malformed options: %j", ({ params }) => {
    renderComponent(
      mockedStore({ dAppRequestStore: { dAppRequestData: { params } } }),
    );
    expect(screen.getByText("Token address")).toBeInTheDocument();
    expect(screen.getByText("Decimals")).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });
});
