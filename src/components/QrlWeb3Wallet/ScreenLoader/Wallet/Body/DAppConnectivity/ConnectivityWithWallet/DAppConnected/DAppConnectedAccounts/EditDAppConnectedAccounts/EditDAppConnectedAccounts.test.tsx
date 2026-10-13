import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import type { updateAccountsAndBlockchainsForUrlOrigin } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import type StorageUtil from "@/utilities/storageUtil";
import userEvent from "@testing-library/user-event";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EditDAppConnectedAccounts from "./EditDAppConnectedAccounts";

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
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection",
  () => ({ default: () => <div>Mocked Qrl Request Account Selection</div> }),
);

describe("EditDAppConnectedAccounts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    mockedStoreValues = mockedStore({
      dAppRequestStore: {
        currentTabData: {
          connectedAccounts: ["Q20B714091cF2a62DADda2847803e3f1B9D2D3779"],
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
            <Route path="/edit" element={<EditDAppConnectedAccounts />} />
            <Route
              path="/dapp-connectivity"
              element={<div>Connection overview</div>}
            />
          </Routes>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the edit dapp connected accounts component", () => {
    renderComponent();

    expect(screen.getByText("Mocked Back Button")).toBeInTheDocument();
    expect(screen.getByText("Edit connected accounts")).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Active Browser Tab Icon"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Qrl Request Account Selection"),
    ).toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    const editButton = screen.getByRole("button", { name: "Edit accounts" });
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
      screen.getByRole("button", { name: "Edit accounts" }),
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to edit connected accounts:",
        error,
      );
    });
    expect(screen.queryByText("Connection overview")).not.toBeInTheDocument();
  });

  it("saves the selected accounts before returning to the overview", async () => {
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
      screen.getByRole("button", { name: "Edit accounts" }),
    );
    expect(await screen.findByText("Connection overview")).toBeInTheDocument();
    expect(updateConnection).toHaveBeenCalledExactlyOnceWith({
      urlOrigin,
      accounts,
      blockchains,
    });
    expect(initializeBlockchain).not.toHaveBeenCalled();
  });
});
