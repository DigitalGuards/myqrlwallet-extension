import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import Welcome from "./Welcome";
import { ONBOARDING_STEPS } from "../Onboarding";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/LockPasswordSetup/LockPasswordSetup",
  () => ({ default: () => <div>Mocked Lock Password Setup</div> }),
);

const hasLegacyWalletData = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@/utilities/legacyWalletData", () => ({ hasLegacyWalletData }));

const LEGACY_NOTICE =
  "This release uses a separate v3 Private wallet. Existing v2 wallet records remain stored. Create a new v3 account or explicitly import your backup for v3.";

describe("Welcome", () => {
  afterEach(cleanup);

  beforeEach(() => {
    hasLegacyWalletData.mockResolvedValue(false);
  });

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
      screen.getByRole("heading", { level: 2, name: "Your wallet for QRL 2.0" }),
    ).toBeInTheDocument();
    for (const text of [
      "Your keys stay on this device",
      "They are created here and stored encrypted with your password.",
      "Post-quantum signatures",
      "Every transaction is signed with ML-DSA-87.",
      "Connect to dApps",
      "Each request is shown to you for approval.",
      "Open source. Currently on the QRL 2.0 test network.",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText("We are")).not.toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toBeEnabled();
  });

  it("should keep the v3 storage notice off a fresh install", async () => {
    renderComponent();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Your wallet for QRL 2.0" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(hasLegacyWalletData).toHaveBeenCalled();
    });
    expect(screen.queryByText(LEGACY_NOTICE)).not.toBeInTheDocument();
  });

  it("should show the v3 storage notice when pre-v3 wallet records exist", async () => {
    hasLegacyWalletData.mockResolvedValue(true);
    renderComponent();

    expect(await screen.findByText(LEGACY_NOTICE)).toBeInTheDocument();
  });

  it("should still render the welcome screen when legacy detection rejects", async () => {
    hasLegacyWalletData.mockRejectedValue(new Error("storage unavailable"));
    renderComponent();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Your wallet for QRL 2.0" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(LEGACY_NOTICE)).not.toBeInTheDocument();
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
