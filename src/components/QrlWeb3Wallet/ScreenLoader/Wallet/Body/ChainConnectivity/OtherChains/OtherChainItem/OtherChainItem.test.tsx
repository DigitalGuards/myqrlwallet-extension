import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import OtherChainItem from "./OtherChainItem";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      getAllBlockChains: vi.fn(async () => []),
      setAllBlockChains: vi.fn(async () => {}),
      getActiveBlockChain: vi.fn(async () => ({
        chainId: "0x5",
        chainName: "Test chain name",
        rpcUrls: [],
        blockExplorerUrls: [],
        iconUrls: [],
        nativeCurrency: {
          name: "Test native currency",
          symbol: "Test symbol",
          decimals: 18,
        },
        defaultRpcUrl: "http://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
        defaultIconUrl: "http://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "http://testDefaultRpcUrl",
        isCustomChain: true,
      })),
      setActiveBlockChain: vi.fn(async () => {}),
      getDAppsConnectedAccountsData: vi.fn(async () => {}),
      setDAppsConnectedAccountsData: vi.fn(async () => {}),
      addDAppChain: vi.fn().mockResolvedValue(undefined),
      removeDAppChain: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("OtherChains", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof OtherChainItem> = {
      blockchain: {
        chainId: "0x5",
        chainName: "Test chain name",
        rpcUrls: [],
        blockExplorerUrls: [],
        iconUrls: [],
        nativeCurrency: {
          name: "Test native currency",
          symbol: "Test symbol",
          decimals: 18,
        },
        defaultRpcUrl: "http://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
        defaultIconUrl: "http://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "http://testDefaultRpcUrl",
        isCustomChain: true,
      },
      triggerReRender: vi.fn(),
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <OtherChainItem {...mockedProps} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the other chain item component", () => {
    renderComponent();

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "http://testDefaultIconUrl");
    expect(img).toHaveAttribute("alt", "Test chain name");
    expect(screen.getByText("Test chain name")).toBeInTheDocument();
    expect(screen.getByText("Chain ID 5")).toBeInTheDocument();
    expect(screen.getByText("http://testDefaultRpcUrl")).toBeInTheDocument();
    const connectChainButton = screen.getByRole("button", {
      name: "Connect chain",
    });
    expect(connectChainButton).toBeInTheDocument();
    const moreButton = screen.getByRole("button", {
      name: "More",
    });
    expect(moreButton).toBeInTheDocument();
  });

  it("should call the select chain method on clicking the connect button", async () => {
    const mockedSelectBlockchain = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        qrlStore: { selectBlockchain: mockedSelectBlockchain },
        dAppRequestStore: {
          currentTabData: { urlOrigin: "http://testUrlOrigin" },
        },
      }),
    );

    const connectChainButton = screen.getByRole("button", {
      name: "Connect chain",
    });
    expect(connectChainButton).toBeInTheDocument();
    expect(connectChainButton).toBeEnabled();
    await userEvent.click(connectChainButton);
    expect(mockedSelectBlockchain).toHaveBeenCalledTimes(1);
  });

  it("should display more options on clicking the connect button", async () => {
    renderComponent();

    const moreButton = screen.getByRole("button", {
      name: "More",
    });
    expect(moreButton).toBeInTheDocument();
    expect(moreButton).toBeEnabled();
    await userEvent.click(moreButton);
    const editChainButton = screen.getByRole("button", {
      name: "Edit chain",
    });
    expect(editChainButton).toBeInTheDocument();
    expect(editChainButton).toBeEnabled();
    const link = screen.getByRole("link", { name: "Edit chain" });
    expect(link).toBeInTheDocument();
    const deleteChainButton = screen.getByRole("button", {
      name: "Delete chain",
    });
    expect(deleteChainButton).toBeInTheDocument();
    expect(deleteChainButton).toBeEnabled();
  });

  it("should disable the delete button is the chain is not custom", async () => {
    const mockedTriggerReRender = vi.fn();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          currentTabData: { urlOrigin: "http://testUrlOrigin" },
        },
      }),
      {
        blockchain: {
          chainId: "0x5",
          chainName: "Test chain name",
          rpcUrls: [],
          blockExplorerUrls: [],
          iconUrls: [],
          nativeCurrency: {
            name: "Test native currency",
            symbol: "Test symbol",
            decimals: 18,
          },
          defaultRpcUrl: "http://testDefaultRpcUrl",
          defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
          defaultIconUrl: "http://testDefaultIconUrl",
          isTestnet: false,
          defaultWsRpcUrl: "http://testDefaultRpcUrl",
          isCustomChain: false,
        },
        triggerReRender: mockedTriggerReRender,
      },
    );

    const moreButton = screen.getByRole("button", {
      name: "More",
    });
    await userEvent.click(moreButton);
    const deleteChainButton = screen.getByRole("button", {
      name: "Delete chain",
    });
    expect(deleteChainButton).toBeInTheDocument();
    expect(deleteChainButton).toBeDisabled();
  });

  it("should call the setAllBlockChains method on clicking delete button", async () => {
    const mockedTriggerReRender = vi.fn();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          currentTabData: { urlOrigin: "http://testUrlOrigin" },
        },
      }),
      {
        blockchain: {
          chainId: "0x5",
          chainName: "Test chain name",
          rpcUrls: [],
          blockExplorerUrls: [],
          iconUrls: [],
          nativeCurrency: {
            name: "Test native currency",
            symbol: "Test symbol",
            decimals: 18,
          },
          defaultRpcUrl: "http://testDefaultRpcUrl",
          defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
          defaultIconUrl: "http://testDefaultIconUrl",
          isTestnet: false,
          defaultWsRpcUrl: "http://testDefaultRpcUrl",
          isCustomChain: true,
        },
        triggerReRender: mockedTriggerReRender,
      },
    );

    const moreButton = screen.getByRole("button", {
      name: "More",
    });
    await userEvent.click(moreButton);
    const deleteChainButton = screen.getByRole("button", {
      name: "Delete chain",
    });
    expect(deleteChainButton).toBeInTheDocument();
    await userEvent.click(deleteChainButton);
    expect(screen.getByText("Delete chain")).toBeInTheDocument();
    expect(
      screen.getByText("Do you want to delete the chain 'Test chain name'?"),
    ).toBeInTheDocument();
    const deleteCancelButton = screen.getByRole("button", {
      name: "Cancel Delete",
    });
    expect(deleteCancelButton).toBeInTheDocument();
    const deleteConfirmationButton = screen.getByRole("button", {
      name: "Confirm Delete",
    });
    expect(deleteConfirmationButton).toBeInTheDocument();
    await userEvent.click(deleteConfirmationButton);
    expect(mockedTriggerReRender).toHaveBeenCalledTimes(1);
  });
});
