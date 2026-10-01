import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { ROUTES } from "@/router/router";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ActiveChain from "./ActiveChain";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/ChainIcon/ChainIcon",
  () => ({ default: () => <div>Mocked Chain Icon</div> }),
);

describe("ActiveChain", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <ActiveChain />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the active chain component", () => {
    renderComponent();

    expect(screen.getByText("Active chain")).toBeInTheDocument();
    expect(screen.getByText("Mocked Chain Icon")).toBeInTheDocument();
    expect(screen.getByText("QRL v3 Private")).toBeInTheDocument();
    expect(screen.getByText("Chain ID 3151909")).toBeInTheDocument();
    expect(
      screen.getByText("https://qrlwallet.com/api/qrl-rpc/testnet"),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Edit chain" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", ROUTES.ADD_EDIT_CHAIN);
    const editChainButton = screen.getByRole("button", { name: "Edit chain" });
    expect(editChainButton).toBeInTheDocument();
  });

  it("offers no retry control on a healthy chain", () => {
    renderComponent();

    expect(
      screen.queryByRole("button", { name: "Retry connection" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry control once the node stops answering", async () => {
    const probeConnectionNow = vi.fn().mockResolvedValue(false);
    renderComponent(
      mockedStore({
        qrlStore: {
          probeConnectionNow,
          qrlConnection: { isConnected: false, isLoading: false },
        },
      }),
    );

    expect(screen.getByText("The node is not answering")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry connection" });
    await userEvent.click(retry);

    expect(probeConnectionNow).toHaveBeenCalledWith({ manual: true });
  });
});
