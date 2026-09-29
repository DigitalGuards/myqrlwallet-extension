import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AddQrlChainContent from "./AddQrlChainContent";
import StorageUtil from "@/utilities/storageUtil";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainInfo",
  () => ({ default: () => <div>Mocked Add Qrl Chain Info</div> }),
);

describe("AddQrlChainContent", () => {
  afterEach(cleanup);

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
    const addChain = vi.fn(async () => ({
      chainFound: false,
      updatedChainList: [],
    }));
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
});
