import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { StoreProvider } from "@/stores/store";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DAppConnectedBlockchains from "./DAppConnectedBlockchains";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/ChainIcon/ChainIcon",
  () => ({ default: () => <div>Mocked Chain Icon</div> }),
);

describe("DAppConnectedBlockchains", () => {
  const renderComponent = (
    mockedStoreValues = mockedStore({
      dAppRequestStore: {
        currentTabData: {
          connectedBlockchains: [
            {
              chainId: "0x5",
              chainName: "Test chain name",
              rpcUrls: [],
              blockExplorerUrls: [],
              iconUrls: [],
              nativeCurrency: {
                name: "Test native currency",
                symbol: "TST",
                decimals: 18,
              },
              defaultRpcUrl: "http://testDefaultRpcUrl",
              defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
              defaultIconUrl: "http://testDefaultIconUrl",
              isTestnet: false,
              defaultWsRpcUrl: "http://testDefaultRpcUrl",
              isCustomChain: true,
            },
          ],
        },
      },
    }),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <DAppConnectedBlockchains />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the dapp connected blockchains component", () => {
    renderComponent();

    expect(
      screen.getByText(
        "The following blockchains are allowed to be used by this website.",
      ),
    ).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).toBeInTheDocument();
    expect(editButton).toBeEnabled();
    expect(screen.getByText("Mocked Chain Icon")).toBeInTheDocument();
    expect(screen.getByText("Test chain name")).toBeInTheDocument();
    expect(screen.getByText("Chain ID 5")).toBeInTheDocument();
    expect(screen.getByText("http://testDefaultRpcUrl")).toBeInTheDocument();
  });
});
