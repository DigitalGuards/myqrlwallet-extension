import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ScreenLoader from "./ScreenLoader";

vi.mock("@/components/QrlWeb3Wallet/ScreenLoader/Lock/Lock", () => ({
  default: () => <div>Mocked Lock</div>,
}));
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequest",
  () => ({ default: () => <div>Mocked DApp Request</div> }),
);
vi.mock("@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Wallet", () => ({
  default: () => <div>Mocked Wallet</div>,
}));

describe("ScreenLoader", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ScreenLoader />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the lock screen while locked", async () => {
    renderComponent(mockedStore({ lockStore: { isLocked: true } }));

    await waitFor(() => {
      expect(screen.getByText("Mocked Lock")).toBeInTheDocument();
      expect(screen.queryByText("Mocked DApp Request")).not.toBeInTheDocument();
      expect(screen.queryByText("Mocked Wallet")).not.toBeInTheDocument();
    });
  });

  it("should render the dapp request screen if there is a dapp request", async () => {
    renderComponent(
      mockedStore({
        lockStore: { isLocked: false },
        dAppRequestStore: { hasDAppRequest: true },
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Mocked Lock")).not.toBeInTheDocument();
      expect(screen.getByText("Mocked DApp Request")).toBeInTheDocument();
      expect(screen.queryByText("Mocked Wallet")).not.toBeInTheDocument();
    });
  });

  it("should render the wallet screen if there is no dapp request", async () => {
    renderComponent(
      mockedStore({
        lockStore: { isLocked: false },
        dAppRequestStore: { hasDAppRequest: false },
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Mocked Lock")).not.toBeInTheDocument();
      expect(screen.queryByText("Mocked DApp Request")).not.toBeInTheDocument();
      expect(screen.getByText("Mocked Wallet")).toBeInTheDocument();
    });
  });

  it("reads lock state before requests and reports a failed lock read", async () => {
    const error = new Error("lock read failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const readDAppRequestData = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        lockStore: {
          isLocked: true,
          readLockState: vi.fn().mockRejectedValue(error),
        },
        dAppRequestStore: { readDAppRequestData },
      }),
    );

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to load the wallet screen state:",
        error,
      );
    });
    expect(readDAppRequestData).not.toHaveBeenCalled();
    expect(await screen.findByText("Mocked Lock")).toBeInTheDocument();
  });

  it("reports a failed request read after reading lock state", async () => {
    const error = new Error("request read failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    renderComponent(
      mockedStore({
        lockStore: {
          isLocked: true,
          readLockState: () => {
            calls.push("lock");
            return Promise.resolve();
          },
        },
        dAppRequestStore: {
          readDAppRequestData: () => {
            calls.push("request");
            return Promise.reject(error);
          },
        },
      }),
    );

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to load the wallet screen state:",
        error,
      );
    });
    expect(calls).toEqual(["lock", "request"]);
  });

  it("reports a failed blockchain initialization after unlock", async () => {
    const error = new Error("connection failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const initializeBlockchain = vi.fn().mockRejectedValue(error);
    renderComponent(
      mockedStore({
        lockStore: { isLocked: false },
        qrlStore: { initializeBlockchain },
        dAppRequestStore: { hasDAppRequest: false },
      }),
    );

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to initialize the blockchain after unlock:",
        error,
      );
    });
    expect(initializeBlockchain).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Mocked Wallet")).toBeInTheDocument();
  });
});
