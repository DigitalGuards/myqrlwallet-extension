import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import StorageUtil from "@/utilities/storageUtil";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WatchAssetContent from "./WatchAssetContent";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge",
  () => ({ default: () => <div>Mocked Chain Badge</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetInfo/WatchAssetInfo",
  () => ({ default: () => <div>Mocked Watch Asset Info</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetVerification/WatchAssetVerification",
  () => ({ default: () => <div>Mocked Watch Asset Verification</div> }),
);

describe("WatchAssetContent", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const options = {
    address: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
    symbol: "TST",
    decimals: 18,
    image: "token.svg",
  };
  const approvingStore = (params: unknown) => {
    const record = vi.fn<ResponseRecorder>();
    const store = mockedStore({
      dAppRequestStore: { dAppRequestData: { params } },
    });
    store.dAppRequestStore.setOnPermissionCallBack = (callback) => {
      store.dAppRequestStore.onPermissionCallBack = callback;
    };
    store.dAppRequestStore.onPermission = (approved) =>
      store.dAppRequestStore.onPermissionCallBack(approved, record);
    return { store, record };
  };

  const renderComponent = (
    mockedStoreValues = mockedStore({
      dAppRequestStore: { dAppRequestData: { params: [{ options: {} }] } },
      qrlStore: {
        activeAccount: {
          accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
        },
      },
    }),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <WatchAssetContent />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the watch asset content", () => {
    renderComponent();

    expect(screen.getByText("Mocked Chain Badge")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Here is a request to add an ZRC20 token to the wallet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked Watch Asset Info")).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Watch Asset Verification"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Do you want to add this token?"),
    ).toBeInTheDocument();
    const noButton = screen.getByRole("button", { name: "No" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
  });

  it("awaits the token write before recording success", async () => {
    let finishWrite: () => void = () => {
      throw new Error("Write was never started");
    };
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const setToken = vi
      .spyOn(StorageUtil, "setTokenContractsList")
      .mockReturnValue(write);
    const { store, record } = approvingStore([{ options }]);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(setToken).toHaveBeenCalledWith(
      store.qrlStore.activeAccount.accountAddress,
      options,
    );
    expect(record).not.toHaveBeenCalled();
    await act(async () => {
      finishWrite();
      await write;
    });
    await waitFor(() => {
      expect(record).toHaveBeenCalledWith({ result: true });
    });
  });

  it.each([0, 6, 18, 36])(
    "preserves decimal %i and optional image metadata",
    async (decimals) => {
      const image = { futureImage: "token.svg" };
      const asset = { ...options, decimals, image };
      const setToken = vi
        .spyOn(StorageUtil, "setTokenContractsList")
        .mockResolvedValue(undefined);
      const { store, record } = approvingStore({ 0: { options: asset } });
      renderComponent(store);
      await userEvent.click(screen.getByRole("button", { name: "Yes" }));
      expect(setToken).toHaveBeenCalledWith(
        store.qrlStore.activeAccount.accountAddress,
        asset,
      );
      expect(record).toHaveBeenCalledWith({ result: true });
    },
  );

  it("preserves the empty-image default", async () => {
    const setToken = vi
      .spyOn(StorageUtil, "setTokenContractsList")
      .mockResolvedValue(undefined);
    const { store } = approvingStore([
      {
        options: {
          address: options.address,
          symbol: options.symbol,
          decimals: options.decimals,
        },
      },
    ]);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(setToken).toHaveBeenCalledWith(
      store.qrlStore.activeAccount.accountAddress,
      { ...options, image: "" },
    );
  });

  it.each(
    [
      undefined,
      null,
      [],
      [{}],
      [{ options: {} }],
      [{ options: { ...options, address: {} } }],
      ...["18", null, 1.5, -1, 37].map((decimals) => [
        { options: { ...options, decimals } },
      ]),
    ].map((params) => ({ params })),
  )("refuses malformed options without writing: %j", async ({ params }) => {
    const setToken = vi
      .spyOn(StorageUtil, "setTokenContractsList")
      .mockResolvedValue(undefined);
    const { store, record } = approvingStore(params);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(record.mock.lastCall?.[0].error).toMatchObject({ code: -32602 });
    expect(setToken).not.toHaveBeenCalled();
  });

  it("performs no token write after rejection", async () => {
    const setToken = vi
      .spyOn(StorageUtil, "setTokenContractsList")
      .mockResolvedValue(undefined);
    const { store, record } = approvingStore([{ options }]);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(setToken).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["Yes", "No"])("reports a rejected %s action", async (name) => {
    const error = new Error("Permission failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          onPermission: vi
            .fn<StoreType["dAppRequestStore"]["onPermission"]>()
            .mockRejectedValue(error),
        },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name }));
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      error,
    );
  });

  it("reports a failed token write without recording success", async () => {
    const error = new Error("Storage unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(StorageUtil, "setTokenContractsList").mockRejectedValue(error);
    const { store, record } = approvingStore([{ options }]);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      error,
    );
    expect(record).not.toHaveBeenCalled();
  });
});
