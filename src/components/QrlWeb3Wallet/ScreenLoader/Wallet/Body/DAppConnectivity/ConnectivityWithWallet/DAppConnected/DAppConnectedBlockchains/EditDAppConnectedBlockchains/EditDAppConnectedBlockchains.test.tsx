import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import type { updateAccountsAndBlockchainsForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import type StorageUtil from "@/utilities/storageUtil";
import userEvent from "@testing-library/user-event";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EditDAppConnectedBlockchains from "./EditDAppConnectedBlockchains";

const { updateConnection, readChains } = vi.hoisted(() => ({
  updateConnection: vi
    .fn<typeof updateAccountsAndBlockchainsForUrlOrigin>()
    .mockResolvedValue([]),
  readChains: vi
    .fn<typeof StorageUtil.getAllBlockChains>()
    .mockResolvedValue([]),
}));
vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  updateAccountsAndBlockchainsForUrlOrigin: updateConnection,
}));
vi.mock("@/utilities/storageUtil", () => ({
  default: { getAllBlockChains: readChains },
}));

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BackButton/BackButton",
  () => ({ default: () => <div>Mocked Back Button</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ActiveBrowserTab/ActiveBrowserTabIcon/ActiveBrowserTabIcon",
  () => ({ default: () => <div>Mocked Active Browser Tab Icon</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection",
  () => ({ default: () => <div>Mocked Qrl Request Account Blockchain Selection</div> }),
);

describe("EditDAppConnectedBlockchains", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
    routeState: unknown = { hasState: true },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter
          initialEntries={[{ pathname: "/edit", state: routeState }]}
        >
          <Routes>
            <Route path="/edit" element={<EditDAppConnectedBlockchains />} />
            <Route
              path="/dapp-connectivity"
              element={<div>Connection overview</div>}
            />
          </Routes>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the edit dapp connected blockchains component", () => {
    renderComponent();

    expect(screen.getByText("Mocked Back Button")).toBeInTheDocument();
    expect(screen.getByText("Edit connected blockchains")).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Active Browser Tab Icon"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Qrl Request Account Blockchain Selection"),
    ).toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    const editButton = screen.getByRole("button", { name: "Edit blockchains" });
    expect(editButton).toBeInTheDocument();
    expect(editButton).toBeEnabled();
  });

  it.each([null, [], { hasState: "true" }, { hasState: 1 }, true])(
    "redirects malformed route state %j without writing",
    async (state) => {
      renderComponent(undefined, state);
      expect(
        await screen.findByText("Connection overview"),
      ).toBeInTheDocument();
      expect(updateConnection).not.toHaveBeenCalled();
    },
  );

  it("reports a rejected permission update and keeps the editor open", async () => {
    const error = new Error("Permission storage unavailable");
    updateConnection.mockRejectedValueOnce(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit blockchains" }),
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to edit connected blockchains:",
        error,
      );
    });
    expect(screen.queryByText("Connection overview")).not.toBeInTheDocument();
  });

  it("saves the selected blockchains before returning to the overview", async () => {
    const urlOrigin = "https://dapp.example";
    const accounts = [`Q${"a".repeat(128)}`];
    const blockchains = [DEFAULT_BLOCKCHAIN];
    const initializeBlockchain = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          currentTabData: {
            urlOrigin,
            connectedAccounts: accounts,
            connectedBlockchains: blockchains,
          },
        },
        qrlStore: { initializeBlockchain },
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit blockchains" }),
    );
    expect(await screen.findByText("Connection overview")).toBeInTheDocument();
    expect(updateConnection).toHaveBeenCalledExactlyOnceWith({
      urlOrigin,
      accounts,
      blockchains,
    });
    expect(initializeBlockchain).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected chain list read", async () => {
    const error = new Error("Chain storage unavailable");
    readChains.mockRejectedValueOnce(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent();
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to load blockchains:", error);
    });
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("reports a rejected blockchain refresh after saving permissions", async () => {
    const error = new Error("Blockchain refresh failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const initializeBlockchain = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(error);
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          currentTabData: { connectedBlockchains: [DEFAULT_BLOCKCHAIN] },
        },
        qrlStore: { initializeBlockchain },
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit blockchains" }),
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to edit connected blockchains:",
        error,
      );
    });
    expect(updateConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Connection overview")).toBeInTheDocument();
  });
});
