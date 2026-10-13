import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import StorageUtil from "@/utilities/storageUtil";
import QrlStore from "@/stores/qrlStore";
import AddEditChainForm from "./AddEditChainForm";
import { CHAIN } from "@/utilities/__mocks__/storageFixtures";

const storageMocks = vi.hoisted(() => ({
  getAllBlockChains: vi.fn<typeof StorageUtil.getAllBlockChains>(),
  setAllBlockChains: vi.fn<typeof StorageUtil.setAllBlockChains>(),
}));

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      getAllBlockChains: storageMocks.getAllBlockChains,
      setAllBlockChains: storageMocks.setAllBlockChains,
    },
  };
});

describe("AddEditChainForm", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AddEditChainForm> = {
      chainToEdit: undefined,
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <AddEditChainForm {...mockedProps} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it.each([CHAIN.nativeCurrency, null])(
    "opens a dApp chain with optional metadata and currency %j",
    (nativeCurrency) => {
      renderComponent(mockedStore(), {
        chainToEdit: { ...CHAIN, nativeCurrency },
      });
      expect(screen.getByRole("textbox", { name: "chainName" })).toHaveValue(
        CHAIN.chainName,
      );
      expect(screen.getByRole("textbox", { name: "currencyName" })).toHaveValue(
        "",
      );
      expect(
        screen.getByRole("textbox", { name: "currencySymbol" }),
      ).toHaveValue(nativeCurrency?.symbol ?? "");
      expect(
        screen.getByRole("spinbutton", { name: "currencyDecimals" }),
      ).toHaveValue(nativeCurrency?.decimals ?? null);
      expect(
        screen.getByRole("button", { name: "Add/edit chain" }),
      ).toBeDisabled();
    },
  );

  it("should render the add chain form component", () => {
    renderComponent();

    expect(
      screen.getByRole("heading", { level: 3, name: "Add chain" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Chain name")).toBeInTheDocument();
    const chainNameField = screen.getByRole("textbox", { name: "chainName" });
    expect(chainNameField).toBeInTheDocument();
    expect(chainNameField).toBeEnabled();
    expect(chainNameField).toHaveValue("");
    expect(chainNameField).toHaveAttribute("placeholder", "QRL customnet");
    expect(screen.getByText("Blockchain name")).toBeInTheDocument();

    expect(screen.getByText("Chain ID")).toBeInTheDocument();
    const chainIdField = screen.getByRole("spinbutton", { name: "chainId" });
    expect(chainIdField).toBeInTheDocument();
    expect(chainIdField).toBeEnabled();
    expect(chainIdField).toHaveValue(null);
    expect(chainIdField).toHaveAttribute("placeholder", "111");
    expect(screen.getByText("Unique chain ID")).toBeInTheDocument();

    expect(screen.getByText("RPC URLs")).toBeInTheDocument();
    expect(screen.getByText("Block Explorer URLs")).toBeInTheDocument();
    expect(screen.getByText("Icon URLs")).toBeInTheDocument();

    expect(screen.getByText("Currency name")).toBeInTheDocument();
    const currencyName = screen.getByRole("textbox", { name: "currencyName" });
    expect(currencyName).toBeInTheDocument();
    expect(currencyName).toBeEnabled();
    expect(currencyName).toHaveValue("");
    expect(currencyName).toHaveAttribute("placeholder", "Quanta");
    expect(screen.getByText("Currency of this blockchain")).toBeInTheDocument();

    expect(screen.getByText("Symbol")).toBeInTheDocument();
    const currencySymbolField = screen.getByRole("textbox", {
      name: "currencySymbol",
    });
    expect(currencySymbolField).toBeInTheDocument();
    expect(currencySymbolField).toBeEnabled();
    expect(currencySymbolField).toHaveValue("");
    expect(currencySymbolField).toHaveAttribute("placeholder", "Quanta");
    expect(screen.getByText("Currency symbol")).toBeInTheDocument();

    expect(screen.getByText("Decimals")).toBeInTheDocument();
    const decimalsField = screen.getByRole("spinbutton", {
      name: "currencyDecimals",
    });
    expect(decimalsField).toBeInTheDocument();
    expect(decimalsField).toBeEnabled();
    expect(decimalsField).toHaveValue(null);
    expect(decimalsField).toHaveAttribute("placeholder", "18");
    expect(screen.getByText("Currency decimals")).toBeInTheDocument();

    const addChainButton = screen.getByRole("button", {
      name: "Add/edit chain",
    });
    expect(addChainButton).toBeInTheDocument();
    expect(addChainButton).toBeDisabled();
  });

  it("should render the edit chain form component", async () => {
    renderComponent(
      mockedStore({
        qrlStore: { refreshBlockchainData: vi.fn(async () => {}) },
      }),
      {
        chainToEdit: {
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
      },
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Edit chain" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Chain name")).toBeInTheDocument();
    const chainNameField = screen.getByRole("textbox", { name: "chainName" });
    expect(chainNameField).toBeInTheDocument();
    expect(chainNameField).toBeEnabled();
    expect(chainNameField).toHaveValue("Test chain name");
    expect(chainNameField).toHaveAttribute("placeholder", "QRL customnet");
    expect(screen.getByText("Blockchain name")).toBeInTheDocument();

    expect(screen.getByText("Chain ID")).toBeInTheDocument();
    const chainIdField = screen.getByRole("spinbutton", { name: "chainId" });
    expect(chainIdField).toBeInTheDocument();
    expect(chainIdField).toBeDisabled();
    expect(chainIdField).toHaveValue(5);
    expect(chainIdField).toHaveAttribute("placeholder", "111");
    expect(screen.getByText("Unique chain ID")).toBeInTheDocument();
    expect(screen.getByText("Currency name")).toBeInTheDocument();
    const currencyName = screen.getByRole("textbox", { name: "currencyName" });
    expect(currencyName).toBeInTheDocument();
    expect(currencyName).toBeEnabled();
    expect(currencyName).toHaveValue("Test native currency");
    expect(currencyName).toHaveAttribute("placeholder", "Quanta");
    expect(screen.getByText("Currency of this blockchain")).toBeInTheDocument();

    expect(screen.getByText("Symbol")).toBeInTheDocument();
    const currencySymbolField = screen.getByRole("textbox", {
      name: "currencySymbol",
    });
    expect(currencySymbolField).toBeInTheDocument();
    expect(currencySymbolField).toBeEnabled();
    expect(currencySymbolField).toHaveValue("TST");
    expect(currencySymbolField).toHaveAttribute("placeholder", "Quanta");
    expect(screen.getByText("Currency symbol")).toBeInTheDocument();

    expect(screen.getByText("Decimals")).toBeInTheDocument();
    const decimalsField = screen.getByRole("spinbutton", {
      name: "currencyDecimals",
    });
    expect(decimalsField).toBeInTheDocument();
    expect(decimalsField).toBeEnabled();
    expect(decimalsField).toHaveValue(18);
    expect(decimalsField).toHaveAttribute("placeholder", "18");
    expect(screen.getByText("Currency decimals")).toBeInTheDocument();

    const editChainButton = screen.getByRole("button", {
      name: "Add/edit chain",
    });
    expect(editChainButton).toBeInTheDocument();
    await waitFor(() => {
      expect(editChainButton).toBeEnabled();
    });
  });

  it("should add a chain to the chainlist on clicking add chain button", async () => {
    const mockChains = [
      {
        chainId: "0x5",
        chainName: "Test chain name",
        rpcUrls: ["https://testDefaultRpcUrl"],
        blockExplorerUrls: ["https://testDefaultExplorerUrl"],
        iconUrls: ["https://testDefaultIconUrl"],
        nativeCurrency: {
          name: "Test native currency",
          symbol: "TST",
          decimals: 18,
        },
        defaultRpcUrl: "https://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "https://testDefaultExplorerUrl",
        defaultIconUrl: "https://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      },
    ];
    storageMocks.getAllBlockChains.mockResolvedValue(mockChains);
    storageMocks.setAllBlockChains.mockResolvedValue();
    renderComponent(
      mockedStore({
        qrlStore: {
          addChain: (chain) => QrlStore.prototype.addChain(chain),
        },
      }),
    );

    const chainNameField = screen.getByRole("textbox", { name: "chainName" });
    await userEvent.type(chainNameField, "Typed chain name");
    const chainIdField = screen.getByRole("spinbutton", { name: "chainId" });
    await userEvent.type(chainIdField, "243");

    const addRpcButton = screen.getAllByRole("button", { name: "Add URL" })[0];
    expect(addRpcButton).toBeInTheDocument();
    expect(addRpcButton).toBeEnabled();
    await userEvent.click(addRpcButton);
    expect(
      screen.getByRole("heading", { level: 2, name: "Add URL" }),
    ).toBeInTheDocument();
    const urlField = screen.getByRole("textbox", { name: "url" });
    expect(urlField).toBeInTheDocument();
    expect(urlField).toBeEnabled();
    expect(urlField).toHaveValue("");
    expect(urlField).toHaveAttribute("placeholder", "https://url_address");
    expect(screen.getByText("Enter the URL to be added")).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: "Add" });
    expect(addButton).toBeInTheDocument();
    expect(addButton).toBeDisabled();
    await userEvent.type(urlField, "https://testRpcUrl");
    expect(addButton).toBeEnabled();
    await userEvent.click(addButton);
    await waitFor(() => {
      expect(screen.getByText("https://testRpcUrl")).toBeInTheDocument();
    });

    const currencyName = screen.getByRole("textbox", { name: "currencyName" });
    await userEvent.type(currencyName, "Typed currency name");
    const currencySymbolField = screen.getByRole("textbox", {
      name: "currencySymbol",
    });
    await userEvent.type(currencySymbolField, "TPD");
    const decimalsField = screen.getByRole("spinbutton", {
      name: "currencyDecimals",
    });
    await userEvent.type(decimalsField, "18");
    const addChainButton = screen.getByRole("button", {
      name: "Add/edit chain",
    });
    expect(addChainButton).toBeInTheDocument();
    expect(addChainButton).toBeEnabled();
    await userEvent.click(addChainButton);
    const expectedChainArray: BlockchainDataType[] = [
      {
        chainId: "0x5",
        chainName: "Test chain name",
        rpcUrls: ["https://testDefaultRpcUrl"],
        blockExplorerUrls: ["https://testDefaultExplorerUrl"],
        iconUrls: ["https://testDefaultIconUrl"],
        nativeCurrency: {
          name: "Test native currency",
          symbol: "TST",
          decimals: 18,
        },
        defaultRpcUrl: "https://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "https://testDefaultExplorerUrl",
        defaultIconUrl: "https://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      },
      {
        chainId: "0xf3",
        chainName: "Typed chain name",
        rpcUrls: ["https://testRpcUrl"],
        blockExplorerUrls: [],
        iconUrls: [],
        nativeCurrency: {
          name: "Typed currency name",
          symbol: "TPD",
          decimals: 18,
        },
        defaultRpcUrl: "https://testRpcUrl",
        defaultBlockExplorerUrl: "",
        defaultIconUrl: "",
        isTestnet: false,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      },
    ];
    expect(storageMocks.setAllBlockChains).toHaveBeenCalledTimes(1);
    expect(storageMocks.setAllBlockChains).toHaveBeenCalledWith(
      expectedChainArray,
    );
  });

  it("should edit the chain and update the chainlist on clicking edit chain button", async () => {
    const mockChains = [
      {
        chainId: "0x5",
        chainName: "Test chain name",
        rpcUrls: ["https://testDefaultRpcUrl"],
        blockExplorerUrls: ["https://testDefaultExplorerUrl"],
        iconUrls: ["https://testDefaultIconUrl"],
        nativeCurrency: {
          name: "Test native currency",
          symbol: "TSTA",
          decimals: 18,
        },
        defaultRpcUrl: "https://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "http://testDefaultExplorerUrl",
        defaultIconUrl: "https://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "https://testDefaultRpcUrl",
        isCustomChain: true,
      },
    ];
    storageMocks.getAllBlockChains.mockResolvedValue(mockChains);
    storageMocks.setAllBlockChains.mockResolvedValue();
    renderComponent(
      mockedStore({
        qrlStore: {
          editChain: (chain) => QrlStore.prototype.editChain(chain),
          refreshBlockchainData: vi.fn(async () => {}),
        },
      }),
      {
        chainToEdit: {
          chainId: "0x5",
          chainName: "Test chain name",
          rpcUrls: ["https://testDefaultRpcUrl"],
          blockExplorerUrls: ["https://testDefaultExplorerUrl"],
          iconUrls: ["https://testDefaultIconUrl"],
          nativeCurrency: {
            name: "Test native currency",
            symbol: "TSTA",
            decimals: 18,
          },
          defaultRpcUrl: "https://testDefaultRpcUrl",
          defaultBlockExplorerUrl: "https://testDefaultExplorerUrl",
          defaultIconUrl: "https://testDefaultIconUrl",
          isTestnet: false,
          defaultWsRpcUrl: "http://testDefaultRpcUrl",
          isCustomChain: true,
        },
      },
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Edit chain" }),
    ).toBeInTheDocument();
    const chainNameField = screen.getByRole("textbox", { name: "chainName" });
    await userEvent.type(chainNameField, " edited");
    const chainIdField = screen.getByRole("spinbutton", { name: "chainId" });
    await userEvent.type(chainIdField, "1");
    const currencyName = screen.getByRole("textbox", {
      name: "currencyName",
    });
    await userEvent.type(currencyName, " edited");
    const editChainButton = screen.getByRole("button", {
      name: "Add/edit chain",
    });
    expect(editChainButton).toBeInTheDocument();
    expect(editChainButton).toBeEnabled();
    await userEvent.click(editChainButton);
    const expectedChainArray: BlockchainDataType[] = [
      {
        chainId: "0x5",
        chainName: "Test chain name edited",
        rpcUrls: ["https://testDefaultRpcUrl"],
        blockExplorerUrls: ["https://testDefaultExplorerUrl"],
        iconUrls: ["https://testDefaultIconUrl"],
        nativeCurrency: {
          name: "Test native currency edited",
          symbol: "TSTA",
          decimals: 18,
        },
        defaultRpcUrl: "https://testDefaultRpcUrl",
        defaultBlockExplorerUrl: "https://testDefaultExplorerUrl",
        defaultIconUrl: "https://testDefaultIconUrl",
        isTestnet: false,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      },
    ];
    expect(storageMocks.setAllBlockChains).toHaveBeenCalledTimes(1);
    expect(storageMocks.setAllBlockChains).toHaveBeenCalledWith(
      expectedChainArray,
    );
  });

  it("shows a rejected chain write and preserves the form for retry", async () => {
    const error = new Error("Chain storage unavailable");
    storageMocks.setAllBlockChains.mockRejectedValueOnce(error);
    const initializeBlockchain = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const editChain = vi
      .fn<QrlStore["editChain"]>()
      .mockResolvedValue({ updatedChainList: [DEFAULT_BLOCKCHAIN] });
    renderComponent(
      mockedStore({ qrlStore: { editChain, initializeBlockchain } }),
      {
        chainToEdit: DEFAULT_BLOCKCHAIN,
      },
    );
    const submit = screen.getByRole("button", { name: "Add/edit chain" });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await userEvent.click(submit);
    expect(await screen.findByText(error.message)).toBeInTheDocument();
    expect(initializeBlockchain).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "chainName" })).toHaveValue(
      DEFAULT_BLOCKCHAIN.chainName,
    );
  });
});
