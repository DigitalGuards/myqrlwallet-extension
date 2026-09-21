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
  () => ({ default: () => <div>Mocked Other Chain Item</div> }),
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
      expect(screen.getByText("Mocked Other Chain Item")).toBeInTheDocument();
    });
  });
});
