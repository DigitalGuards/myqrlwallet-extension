import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import type StorageUtil from "@/utilities/storageUtil";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type NavigateFunction } from "react-router-dom";
import TokenImportSuccess from "./TokenImportSuccess";

const CONTRACT_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;

const { navigate, setTokenContractsList } = vi.hoisted(() => ({
  navigate: vi.fn<NavigateFunction>(),
  setTokenContractsList: vi
    .fn<typeof StorageUtil.setTokenContractsList>()
    .mockResolvedValue(undefined),
}));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));
vi.mock("@/utilities/storageUtil", () => ({
  default: { setTokenContractsList },
}));

describe("TokenImportSuccess", () => {
  afterEach(() => {
    cleanup();
    navigate.mockReset();
    setTokenContractsList.mockReset().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  const mockedOnCancelImport = vi.fn();

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TokenImportSuccess
            contractAddress={CONTRACT_ADDRESS}
            onCancelImport={mockedOnCancelImport}
            token={{
              balance: 25,
              balanceBaseUnits: "25000000000000000000",
              decimals: BigInt(18),
              name: "MOCK TOKEN",
              symbol: "MCK",
              totalSupply: 100,
              image: "",
            }}
          />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the token import success component", () => {
    renderComponent();

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Import token",
    );
    expect(screen.getByText("Contract address")).toBeInTheDocument();
    expect(
      screen.getByText(formatQrlAddressFingerprint(CONTRACT_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("MOCK TOKEN")).toBeInTheDocument();
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("MCK")).toBeInTheDocument();
    expect(screen.getByText("Total supply")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("25.0 MCK")).toBeInTheDocument();
    expect(screen.getByText("Decimals")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("should render the cancel button in token import success component", async () => {
    renderComponent();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    await userEvent.click(cancelButton);
    expect(mockedOnCancelImport).toHaveBeenCalledTimes(1);
  });

  it("should render the import button in token import success component", () => {
    renderComponent();

    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toBeInTheDocument();
    expect(importButton).toBeEnabled();
  });

  it("stores the same token values before navigating home", async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setTokenContractsList.mockReturnValueOnce(pending);
    const store = mockedStore();
    renderComponent(store);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(setTokenContractsList).toHaveBeenCalledExactlyOnceWith(
      store.qrlStore.activeAccount.accountAddress,
      {
        address: CONTRACT_ADDRESS,
        symbol: "MCK",
        decimals: 18,
        image: "",
      },
    );
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["storage", "navigation"])(
    "reports a rejected %s operation",
    async (operation) => {
      const error = new Error("Import failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (operation === "storage")
        setTokenContractsList.mockRejectedValueOnce(error);
      else navigate.mockRejectedValueOnce(error);
      renderComponent();
      await userEvent.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[TokenImportSuccess] Failed to import token:",
          error,
        );
      });
      expect(setTokenContractsList).toHaveBeenCalledTimes(1);
      if (operation === "storage") expect(navigate).not.toHaveBeenCalled();
    },
  );
});
