import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OtherChains from "./OtherChains";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    default: {
      getAllBlockChains: vi.fn(async () => [
        {
          chainId: "0x123",
          defaultRpcUrl: "http://testDefaultRpcUrl",
          defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
          defaultIconUrl: "http://testDefaultIconUrl",
          isTestnet: false,
          defaultWsRpcUrl: "http://testDefaultRpcUrl",
          isCustomChain: true,
        },
      ]),
    },
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChainItem/OtherChainItem",
  () => ({
    default: ({ blockchain }: { blockchain: { chainId: string } }) => (
      <div>Mocked Other Chain Item {blockchain.chainId}</div>
    ),
  }),
);

describe("OtherChains", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <OtherChains />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the other chains component", async () => {
    renderComponent();

    expect(screen.getByText("Other chains")).toBeInTheDocument();
    await waitFor(async () => {
      expect(screen.getByText(/Mocked Other Chain Item/)).toBeInTheDocument();
    });
  });
  it("re-filters the list when the active chain changes", async () => {
    const store = mockedStore({
      qrlStore: {
        qrlConnection: {
          isConnected: true,
          isLoading: false,
          areBalancesStale: false,
          blockchain: { chainId: "0x999" },
        },
      },
    });
    const view = renderComponent(store);
    await waitFor(() => {
      expect(screen.getByText(/Mocked Other Chain Item/)).toBeInTheDocument();
    });

    // Switching to 0x123 must drop it from "other chains". The effect read
    // chainId but did not list it as a dependency, so it never re-ran.
    const switched = mockedStore({
      qrlStore: {
        qrlConnection: {
          isConnected: true,
          isLoading: false,
          areBalancesStale: false,
          blockchain: { chainId: "0x123" },
        },
      },
    });
    view.rerender(
      <StoreProvider value={switched}>
        <MemoryRouter>
          <OtherChains />
        </MemoryRouter>
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/Mocked Other Chain Item/),
      ).not.toBeInTheDocument();
    });
  });
});
