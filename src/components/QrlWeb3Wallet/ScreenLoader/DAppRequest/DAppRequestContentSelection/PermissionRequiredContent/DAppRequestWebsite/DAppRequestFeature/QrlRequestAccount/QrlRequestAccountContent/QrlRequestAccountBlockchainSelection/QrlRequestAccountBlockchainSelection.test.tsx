import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import QrlRequestAccountBlockchainSelection from "./QrlRequestAccountBlockchainSelection";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/ChainIcon/ChainIcon",
  () => ({ default: () => <div>Mocked Chain Icon</div> }),
);

describe("QrlRequestAccountBlockchainSelection", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof QrlRequestAccountBlockchainSelection> = {
      isLoading: false,
      allBlockchains: [],
      onBlockchainSelection: () => {},
      selectedBlockchains: [],
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <QrlRequestAccountBlockchainSelection {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the qrl request account blockchain selection component", () => {
    renderComponent(mockedStore(), {
      isLoading: false,
      onBlockchainSelection: () => {},
      allBlockchains: [
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
      selectedBlockchains: [],
    });

    expect(
      screen.getByText("Select the blockchains you want this site to use"),
    ).toBeInTheDocument();
    const checkBox = screen.getByRole("checkbox", {
      name: "blockchainCheckbox",
    });
    expect(checkBox).toBeInTheDocument();
    expect(checkBox).toBeEnabled();
    expect(screen.getByText("Mocked Chain Icon")).toBeInTheDocument();
    expect(screen.getByText("Test chain name")).toBeInTheDocument();
    expect(screen.getByText("Chain ID 5")).toBeInTheDocument();
    expect(screen.getByText("http://testDefaultRpcUrl")).toBeInTheDocument();
  });

  it("should display the message is no blockchains are available", () => {
    renderComponent();

    expect(screen.getByText("No blockchains available")).toBeInTheDocument();
  });

  it("should call the blockchain selection callback on clicking checkbox", async () => {
    const mockedOnBlockchainSelection = vi.fn(() => {});
    renderComponent(mockedStore(), {
      isLoading: false,
      onBlockchainSelection: mockedOnBlockchainSelection,
      allBlockchains: [
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
      selectedBlockchains: [],
    });

    const checkBox = screen.getByRole("checkbox", {
      name: "blockchainCheckbox",
    });
    expect(checkBox).toBeInTheDocument();
    expect(checkBox).toBeEnabled();
    await userEvent.click(checkBox);
    expect(mockedOnBlockchainSelection).toHaveBeenCalledTimes(1);
  });
});
