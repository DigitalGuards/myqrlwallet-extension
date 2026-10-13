import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import DAppConnected from "./DAppConnected";

describe("DAppConnected", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <DAppConnected />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the dapp connected component", () => {
    renderComponent(
      mockedStore({
        qrlStore: { qrlAccounts: { isLoading: false } },
        dAppRequestStore: {
          currentTabData: {
            connectedBlockchains: [],
            connectedAccounts: ["Q20fB08fF1f1376A14C055E9F56df80563E16722b"],
          },
        },
      }),
    );

    expect(
      screen.getByText(
        "The following accounts are connected, and can interact with this website.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        formatQrlAddressFingerprint(
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        ),
      ),
    ).toBeInTheDocument();
    // The account row re-applies the shared balance rule, so the store's
    // "0.0 Quanta" renders as "0.00 Quanta", matching the web wallet.
    expect(screen.getByText("0.00 Quanta")).toBeInTheDocument();
  });

  it("reports a rejected current-tab read", async () => {
    const error = new Error("Tab unavailable");
    const fetchCurrentTabData = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(mockedStore({ dAppRequestStore: { fetchCurrentTabData } }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to load current tab:", error);
    });
  });
});
