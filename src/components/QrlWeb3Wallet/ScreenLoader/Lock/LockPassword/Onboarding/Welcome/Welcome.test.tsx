import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import Welcome from "./Welcome";
import { ONBOARDING_STEPS } from "../Onboarding";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/LockPasswordSetup/LockPasswordSetup",
  () => ({ default: () => <div>Mocked Lock Password Setup</div> }),
);

describe("Welcome", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof Welcome> = {
      selectStep: () => {},
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <Welcome {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the welcome component", () => {
    renderComponent();

    expect(
      screen.getByRole("heading", { level: 3, name: "Welcome" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Let's start using MyQRLWallet"),
    ).toBeInTheDocument();
    expect(screen.getByText("We are")).toBeInTheDocument();
    expect(screen.getByText("The Quantum")).toBeInTheDocument();
    expect(screen.getByText("Resistant Ledger")).toBeInTheDocument();
    expect(screen.getByAltText("MyQRLWallet")).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toBeEnabled();
  });

  it("should invoke the selectStep method on clicking continue", async () => {
    const mockedSelectStep = vi.fn();
    renderComponent(mockedStore(), { selectStep: mockedSelectStep });

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);
    expect(mockedSelectStep).toHaveBeenCalledTimes(1);
    expect(mockedSelectStep).toHaveBeenCalledWith(
      ONBOARDING_STEPS.SET_PASSWORD,
    );
  });
});
