import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AddQrlChainContent from "./AddQrlChainContent";
import StorageUtil from "@/utilities/storageUtil";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import QrlStore from "@/stores/qrlStore";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import AddQrlChainDetails from "./AddQrlChainInfo/AddQrlChainDetails/AddQrlChainDetails";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainInfo",
  () => ({ default: () => <div>Mocked Add Qrl Chain Info</div> }),
);

describe("AddQrlChainContent", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AddQrlChainContent />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the add qrl chain content component", () => {
    renderComponent();

    expect(screen.getByText("Add new chain")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Here is a request to add the following blockchain to the wallet and make it the active one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked Add Qrl Chain Info")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Do you want to add this chain and switch the wallet to it?",
      ),
    ).toBeInTheDocument();
    const noButton = screen.getByRole("button", { name: "No" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
  });

  it("should call onPermission with false if request is rejected", async () => {
    const mockedOnPermission = vi.fn(async () => {});
    renderComponent(
      mockedStore({ dAppRequestStore: { onPermission: mockedOnPermission } }),
    );

    const noButton = screen.getByRole("button", { name: "No" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    await userEvent.click(noButton);
    expect(mockedOnPermission).toHaveBeenCalledTimes(1);
    expect(mockedOnPermission).toHaveBeenCalledWith(false);
  });

  it("should call onPermission with true if request is approved", async () => {
    const mockedOnPermission = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          onPermission: mockedOnPermission,
          canProceed: true,
        },
      }),
    );

    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
    await userEvent.click(yesButton);
    expect(mockedOnPermission).toHaveBeenCalledTimes(1);
    expect(mockedOnPermission).toHaveBeenCalledWith(true);
  });
  it("adopts a validated rpc url and leaves the request slot alone (M1, L5)", async () => {
    const addChain = vi.fn().mockResolvedValue({
      chainFound: false,
      updatedChainList: [],
    });
    const selectBlockchain = vi.fn(async () => {});
    const setAllBlockChains = vi
      .spyOn(StorageUtil, "setAllBlockChains")
      .mockResolvedValue(undefined);
    const clearRequest = vi
      .spyOn(StorageUtil, "clearDAppsRequestData")
      .mockResolvedValue(undefined);
    let captured:
      | ((hasApproved: boolean, record: ResponseRecorder) => Promise<void>)
      | undefined;
    const recorded: Record<string, unknown>[] = [];
    const record: ResponseRecorder = (data) => {
      recorded.push(data);
    };

    renderComponent(
      mockedStore({
        qrlStore: { addChain, selectBlockchain },
        dAppRequestStore: {
          setOnPermissionCallBack: (
            callBack: (
              hasApproved: boolean,
              recorder: ResponseRecorder,
            ) => Promise<void>,
          ) => {
            captured = callBack;
          },
          dAppRequestData: {
            method: "wallet_addQRLChain",
            requestId: "request-a",
            params: [
              {
                chainName: "Some chain",
                chainId: "0x301825",
                nativeCurrency: {
                  name: "Quanta",
                  symbol: "Quanta",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.example", "https://rpc2.example"],
                blockExplorerUrls: [],
                iconUrls: [],
              },
            ],
            requestData: { senderData: { url: "https://dapp.example/app" } },
          },
        },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(captured).toBeTypeOf("function");
    await captured?.(true, record);

    expect(addChain).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultRpcUrl: "https://rpc.example",
        defaultWsRpcUrl: "",
      }),
    );
    expect(setAllBlockChains).toHaveBeenCalled();
    expect(selectBlockchain).toHaveBeenCalledWith("0x301825");
    // The slot is cleared by onPermission once the answer is on its way.
    // Clearing it here used to erase the requestId the answer needs.
    expect(clearRequest).not.toHaveBeenCalled();
    // The result lands in this run's own bucket.
    expect(recorded).toContainEqual({ result: true });
  });

  const chainParameters = {
    chainId: "0x55",
    chainName: "Additional chain",
    rpcUrls: ["https://rpc.example"],
    nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
  };

  const approveParameters = async (params: unknown) => {
    const record = vi.fn<ResponseRecorder>();
    let callback: DAppRequestStore["onPermissionCallBack"] | undefined;
    const selectBlockchain = vi
      .fn<QrlStore["selectBlockchain"]>()
      .mockResolvedValue(undefined);
    const store = mockedStore({
      qrlStore: {
        addChain: QrlStore.prototype.addChain.bind(QrlStore.prototype),
        selectBlockchain,
      },
      dAppRequestStore: {
        dAppRequestData: { method: "wallet_addQRLChain", params },
        setOnPermissionCallBack: (handler) => {
          callback = handler;
        },
        onPermission: async (approved) => {
          if (!callback) throw new Error("Missing approval callback");
          await callback(approved, record);
        },
      },
    });
    const addChain = vi.spyOn(store.qrlStore, "addChain");
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(record).toHaveBeenCalledTimes(1);
    });
    return { record, addChain, selectBlockchain };
  };

  it.each(
    [
      chainParameters,
      { ...chainParameters, nativeCurrency: null },
      { ...chainParameters, nativeCurrency: { symbol: "QRL", decimals: 18 } },
      { ...chainParameters, blockExplorerUrls: [], iconUrls: [] },
    ].flatMap((chain) => [
      { chain, format: "array", params: [chain] },
      { chain, format: "indexed object", params: { 0: chain } },
    ]),
  )(
    "preserves optional chain fields and every existing record with $format parameters",
    async ({ chain, params }) => {
      const retained = {
        ...DEFAULT_BLOCKCHAIN,
        customMetadata: { retained: true },
      };
      vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue([retained]);
      const save = vi
        .spyOn(StorageUtil, "setAllBlockChains")
        .mockResolvedValue(undefined);
      const { record, selectBlockchain } = await approveParameters(params);
      expect(save).toHaveBeenCalledExactlyOnceWith([
        retained,
        {
          blockExplorerUrls: undefined,
          iconUrls: undefined,
          ...chain,
          defaultRpcUrl: "https://rpc.example",
          defaultBlockExplorerUrl: "",
          defaultIconUrl: "",
          isTestnet: false,
          defaultWsRpcUrl: "",
          isCustomChain: true,
        },
      ]);
      expect(selectBlockchain).toHaveBeenCalledExactlyOnceWith("0x55");
      expect(record).toHaveBeenCalledExactlyOnceWith({ result: true });
      expect(save.mock.invocationCallOrder[0]).toBeLessThan(
        selectBlockchain.mock.invocationCallOrder[0],
      );
      expect(selectBlockchain.mock.invocationCallOrder[0]).toBeLessThan(
        record.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([
    undefined,
    null,
    {},
    [null],
    ["invalid"],
    [{ ...chainParameters, chainId: 5 }],
    [{ ...chainParameters, rpcUrls: [42] }],
    [{ ...chainParameters, nativeCurrency: undefined }],
    [{ ...chainParameters, nativeCurrency: { symbol: {}, decimals: 18 } }],
    [{ ...chainParameters, iconUrls: [null] }],
  ])(
    "rejects malformed chain parameters without writing records: %j",
    async (params) => {
      const save = vi
        .spyOn(StorageUtil, "setAllBlockChains")
        .mockResolvedValue(undefined);
      const { record, addChain, selectBlockchain } =
        await approveParameters(params);
      expect(record.mock.calls[0]?.[0].error).toMatchObject({ code: -32602 });
      expect(addChain).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(selectBlockchain).not.toHaveBeenCalled();
    },
  );

  it("renders malformed chain details safely", () => {
    render(
      <StoreProvider
        value={mockedStore({
          dAppRequestStore: {
            dAppRequestData: {
              params: [{ nativeCurrency: "invalid", iconUrls: [null] }],
            },
          },
        })}
      >
        <AddQrlChainDetails />
      </StoreProvider>,
    );
    expect(screen.getByText("Chain name")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  it("reports a failure to register the approval callback", async () => {
    const error = new Error("Callback registration failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          setOnPermissionCallBack: () => {
            throw error;
          },
        },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      error,
    );
  });
});
