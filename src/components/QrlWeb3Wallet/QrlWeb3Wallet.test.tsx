import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/router/router";
import RouteMonitor from "./RouteMonitor/RouteMonitor";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StorageUtil from "@/utilities/storageUtil";
import {
  DEFAULT_BLOCKCHAIN,
  type BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import QrlWeb3Wallet from "./QrlWeb3Wallet";
import BackButton from "./ScreenLoader/Shared/BackButton/BackButton";
import AddEditChain from "./ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChain";

const mocks = vi.hoisted(() => {
  const routeState: { value: unknown } = { value: undefined };
  return {
    getActivePage: vi.fn<() => Promise<unknown>>(),
    clearActivePage: vi.fn<() => Promise<void>>(),
    setActivePage: vi.fn<(page: string) => Promise<void>>(),
    navigate: vi.fn<(page: string | number) => void | Promise<void>>(),
    scroll: vi.fn(),
    pathname: "/initial",
    routeState,
    getAllBlockChains: vi.fn<() => Promise<BlockchainDataType[]>>(),
    setAllBlockChains: vi.fn<(chains: BlockchainDataType[]) => Promise<void>>(),
  };
});

vi.mock("@/utilities/storageUtil", () => ({ default: mocks }));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({
    pathname: mocks.pathname,
    state: mocks.routeState.value,
  }),
}));
vi.mock("@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion", () => ({
  scrollShellToTop: mocks.scroll,
}));

beforeEach(() => {
  mocks.getActivePage.mockReset().mockResolvedValue("/saved");
  mocks.clearActivePage.mockReset().mockResolvedValue(undefined);
  mocks.setActivePage.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset();
  mocks.pathname = "/initial";
  mocks.routeState.value = undefined;
  mocks.getAllBlockChains.mockReset().mockResolvedValue([]);
  mocks.setAllBlockChains.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RouteMonitor", () => {
  it("clears the saved page before navigating and saves subsequent route changes", async () => {
    const calls: string[] = [];
    mocks.clearActivePage.mockImplementation(() => {
      calls.push("clear");
      return Promise.resolve();
    });
    mocks.navigate.mockImplementation(() => {
      calls.push("navigate");
    });
    const { rerender } = render(<RouteMonitor />);
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/saved");
    });
    expect(calls).toEqual(["clear", "navigate"]);
    expect(mocks.setActivePage).not.toHaveBeenCalled();

    mocks.pathname = "/next";
    rerender(<RouteMonitor />);
    await waitFor(() => {
      expect(mocks.setActivePage).toHaveBeenCalledWith("/next");
    });
    expect(mocks.scroll).toHaveBeenCalledTimes(2);
  });

  it.each(
    [undefined, null, "", 7, true, { pathname: "/saved" }, ["/saved"]].map(
      (page) => ({ page }),
    ),
  )(
    "uses home for a missing or malformed stored page ($page) without clearing it",
    async ({ page }) => {
      mocks.getActivePage.mockResolvedValue(page);
      render(<RouteMonitor />);
      await waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledWith(ROUTES.HOME);
      });
      expect(mocks.clearActivePage).not.toHaveBeenCalled();
    },
  );

  it.each(["read", "clear", "navigate"])(
    "reports a failed restore %s",
    async (step) => {
      const error = new Error("restore failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (step === "read") mocks.getActivePage.mockRejectedValue(error);
      if (step === "clear") mocks.clearActivePage.mockRejectedValue(error);
      if (step === "navigate") mocks.navigate.mockRejectedValue(error);
      render(<RouteMonitor />);

      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Failed to restore the active page:",
          error,
        );
      });
      if (step !== "navigate") expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it("reports a failed page save", async () => {
    const error = new Error("save failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<RouteMonitor />);
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalled();
    });
    mocks.setActivePage.mockRejectedValue(error);
    mocks.pathname = "/next";
    rerender(<RouteMonitor />);

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to save the active page:",
        error,
      );
    });
  });
});

vi.mock("@/components/QrlWeb3Wallet/ScreenLoader/ScreenLoader", () => ({
  default: () => <div>Mocked Screen Loader</div>,
}));

describe("QrlWeb3Wallet", () => {
  it("renders the screen loader and restores the route", async () => {
    render(
      <StoreProvider value={mockedStore()}>
        <MemoryRouter>
          <QrlWeb3Wallet />
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(screen.getByText("Mocked Screen Loader")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/saved");
    });
  });
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChainForm/AddEditChainForm",
  () => ({
    default: ({ chainToEdit }: { chainToEdit?: BlockchainDataType }) => (
      <div>Mocked Add Edit Chain Form {chainToEdit?.chainId}</div>
    ),
  }),
);

describe("AddEditChain", () => {
  const renderComponent = (
    mockedStoreValues = mockedStore(),
    state?: unknown,
  ) => {
    mocks.routeState.value = state;
    return render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter initialEntries={[{ pathname: "/chains/edit", state }]}>
          <AddEditChain />
        </MemoryRouter>
      </StoreProvider>,
    );
  };

  it("should render the add edit chain component", () => {
    renderComponent();

    expect(screen.getByText("Mocked Add Edit Chain Form")).toBeInTheDocument();
  });

  it("loads the requested chain without writing storage", async () => {
    const chains = [
      { ...DEFAULT_BLOCKCHAIN, chainId: "0x01" },
      DEFAULT_BLOCKCHAIN,
    ];
    const read = vi
      .spyOn(StorageUtil, "getAllBlockChains")
      .mockResolvedValue(chains);
    const write = vi.spyOn(StorageUtil, "setAllBlockChains");
    renderComponent(mockedStore(), {
      hasState: true,
      chainId: DEFAULT_BLOCKCHAIN.chainId,
    });

    expect(
      await screen.findByText(
        `Mocked Add Edit Chain Form ${DEFAULT_BLOCKCHAIN.chainId}`,
      ),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(chains).toEqual([
      { ...DEFAULT_BLOCKCHAIN, chainId: "0x01" },
      DEFAULT_BLOCKCHAIN,
    ]);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("accepts add-chain state without a chain id", () => {
    const read = vi.spyOn(StorageUtil, "getAllBlockChains");
    renderComponent(mockedStore(), { hasState: true });
    expect(read).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { state: null },
    { state: [] },
    { state: "edit" },
    { state: { hasState: "true", chainId: "0x01" } },
    { state: { hasState: false, chainId: "0x01" } },
    { state: { hasState: true, chainId: 1 } },
    { state: { hasState: true, chainId: null } },
    { state: { hasState: true, chainId: {} } },
  ])(
    "rejects malformed route state $state before loading chains",
    async ({ state }) => {
      const read = vi.spyOn(StorageUtil, "getAllBlockChains");
      renderComponent(mockedStore(), state);

      await waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledWith(ROUTES.CHAIN_CONNECTIVITY);
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("reports a rejected chain load", async () => {
    const error = new Error("chain storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(StorageUtil, "getAllBlockChains").mockRejectedValue(error);
    renderComponent(mockedStore(), { hasState: true, chainId: "0x01" });

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to load the chain to edit:",
        error,
      );
    });
  });

  it("reports a rejected redirect", async () => {
    const error = new Error("navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.navigate.mockRejectedValueOnce(error);
    renderComponent();

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to return to chain connectivity:",
        error,
      );
    });
  });
});

describe("BackButton navigation failures", () => {
  it.each([undefined, "/accounts"])(
    "reports a navigation rejection for %s",
    async (navigationRoute) => {
      const error = new Error("navigation failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.navigate.mockRejectedValueOnce(error);
      render(
        <MemoryRouter>
          <BackButton navigationRoute={navigationRoute} />
        </MemoryRouter>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(mocks.navigate).toHaveBeenCalledWith(navigationRoute ?? -1);
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith("Failed to navigate back:", error);
      });
    },
  );
});
