import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import DAppRequest from "./DAppRequest";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge",
  () => ({ default: () => <div>Mocked ChainBadge</div> }),
);

describe("DAppRequest", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <DAppRequest />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the dapp request content component", async () => {
    renderComponent();

    expect(screen.getByText("Mocked ChainBadge")).toBeInTheDocument();
    expect(screen.getByText("Your permission required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Here is a request coming in. Go through the details and decide if it needs to be allowed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Do you trust and want to allow this?"),
    ).toBeInTheDocument();
    const noButton = screen.getByRole("button", { name: "No" });
    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(noButton).toBeInTheDocument();
    expect(yesButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    expect(yesButton).toBeDisabled();
  });

  it("should show the branded boot loader with the phase label while connecting", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: { isLoading: true },
          initProgress: { active: true, fraction: 0.5, phase: "accounts" },
        },
      }),
    );

    expect(screen.getByTestId("loader-icon")).toBeInTheDocument();
    expect(screen.getByText("Fetching balances")).toBeInTheDocument();
    expect(
      screen.queryByText("Your permission required"),
    ).not.toBeInTheDocument();
  });

  it("should show the indeterminate branded loader when no boot progress is available", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: { isLoading: true },
          initProgress: { active: false, fraction: 1, phase: "session" },
        },
      }),
    );

    expect(screen.getByTestId("loader-icon")).toBeInTheDocument();
    expect(screen.getByText("Connecting to the network")).toBeInTheDocument();
  });
});
