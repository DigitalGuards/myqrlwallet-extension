import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { StoreProvider } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { includeChainForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SwitchQrlChainContent from "./SwitchQrlChainContent";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainInfo/SwitchQrlChainInfo",
  () => ({ default: () => <div>Mocked Switch Qrl Chain Info</div> }),
);
vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  includeChainForUrlOrigin: vi.fn(() => Promise.resolve()),
}));

describe("SwitchQrlChainContent", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const approvingStore = (params: unknown) => {
    const record = vi.fn<ResponseRecorder>();
    const selectBlockchain = vi
      .fn<(chainId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const store = mockedStore({
      dAppRequestStore: { dAppRequestData: { params } },
      qrlStore: { selectBlockchain },
    });
    store.dAppRequestStore.setOnPermissionCallBack = (callback) => {
      store.dAppRequestStore.onPermissionCallBack = callback;
    };
    store.dAppRequestStore.onPermission = (approved) =>
      store.dAppRequestStore.onPermissionCallBack(approved, record);
    return { store, record, selectBlockchain };
  };

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <SwitchQrlChainContent />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the switch qrl chain content component", () => {
    renderComponent();

    expect(screen.getByText("Switch chain")).toBeInTheDocument();
    expect(
      screen.getByText("Here is a request to switch the current blockchain."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Switch Qrl Chain Info"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Do you want to switch the chain?"),
    ).toBeInTheDocument();
    const noButton = screen.getByRole("button", { name: "No" });
    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
  });

  it("should call onPermission with false if request is rejected", async () => {
    const mockedOnPermission = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
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
    const mockedOnPermission = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
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

  it.each(
    [[{ chainId: "0x11" }], { 0: { chainId: "0x11" } }].map((params) => ({
      params,
    })),
  )(
    "awaits the origin grant before switching and recording success: %j",
    async ({ params }) => {
      let finishGrant: () => void = () => {
        throw new Error("Grant was never started");
      };
      const grant = new Promise<void>((resolve) => {
        finishGrant = resolve;
      });
      vi.mocked(includeChainForUrlOrigin).mockReturnValueOnce(grant);
      const { store, record, selectBlockchain } = approvingStore(params);
      renderComponent(store);
      await userEvent.click(screen.getByRole("button", { name: "Yes" }));
      expect(includeChainForUrlOrigin).toHaveBeenCalledWith({
        urlOrigin: "http://localhost/",
        chainId: "0x11",
      });
      expect(selectBlockchain).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      await act(async () => {
        finishGrant();
        await grant;
      });
      await waitFor(() => {
        expect(record).toHaveBeenCalledWith({ result: true });
      });
      expect(selectBlockchain).toHaveBeenCalledWith("0x11");
    },
  );

  it.each(
    [
      undefined,
      null,
      "params",
      [],
      [null],
      [{}],
      [{ chainId: 17 }],
      [{ chainId: "" }],
    ].map((params) => ({ params })),
  )(
    "refuses malformed switch parameters without writes: %j",
    async ({ params }) => {
      const { store, record, selectBlockchain } = approvingStore(params);
      renderComponent(store);
      await userEvent.click(screen.getByRole("button", { name: "Yes" }));
      expect(record.mock.lastCall?.[0].error).toMatchObject({ code: -32602 });
      expect(includeChainForUrlOrigin).not.toHaveBeenCalled();
      expect(selectBlockchain).not.toHaveBeenCalled();
    },
  );

  it.each(["Yes", "No"])("reports a rejected %s action", async (name) => {
    const error = new Error("Permission failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          onPermission: vi.fn<() => Promise<void>>().mockRejectedValue(error),
        },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name }));
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      error,
    );
  });

  it("reports a failed grant before switching or recording success", async () => {
    const error = new Error("Grant failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(includeChainForUrlOrigin).mockRejectedValueOnce(error);
    const { store, record, selectBlockchain } = approvingStore([
      { chainId: "0x11" },
    ]);
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      error,
    );
    expect(selectBlockchain).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
