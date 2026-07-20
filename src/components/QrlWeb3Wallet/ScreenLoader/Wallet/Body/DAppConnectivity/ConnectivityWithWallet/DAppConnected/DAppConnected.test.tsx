import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import DAppConnected from "./DAppConnected";

describe("DAppConnected", () => {
  afterEach(cleanup);

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
    expect(screen.getByText("Q20fB0")).toBeInTheDocument();
    expect(screen.getByText("8fF1f")).toBeInTheDocument();
    expect(screen.getByText("1376A")).toBeInTheDocument();
    expect(screen.getByText("14C05")).toBeInTheDocument();
    expect(screen.getByText("5E9F5")).toBeInTheDocument();
    expect(screen.getByText("6df80")).toBeInTheDocument();
    expect(screen.getByText("563E1")).toBeInTheDocument();
    expect(screen.getByText("6722b")).toBeInTheDocument();
    expect(screen.getByText("0.0 Quanta")).toBeInTheDocument();
  });
});
