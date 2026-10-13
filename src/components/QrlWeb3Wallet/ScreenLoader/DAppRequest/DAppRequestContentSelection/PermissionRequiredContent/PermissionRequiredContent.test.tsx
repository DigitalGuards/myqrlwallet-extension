import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import PermissionRequiredContent from "./PermissionRequiredContent";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge",
  () => ({ default: () => <div>Mocked Chain Badge</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestWebsite",
  () => ({ default: () => <div>Mocked DApp Request Website</div> }),
);

describe("PermissionRequiredContent", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <PermissionRequiredContent />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the permission required content component", () => {
    renderComponent();

    expect(screen.getByText("Mocked Chain Badge")).toBeInTheDocument();
    expect(screen.getByText("Your permission required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Here is a request coming in. Go through the details and decide if it needs to be allowed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked DApp Request Website")).toBeInTheDocument();
    expect(
      screen.getByText("Do you trust and want to allow this?"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Transaction running")).not.toBeInTheDocument();
    const noButton = screen.getByRole("button", { name: "No" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeDisabled();
  });

  it("should call onPermission with false if request is rejected", async () => {
    const mockedOnPermission = vi.fn(async () => {});
    renderComponent(
      mockedStore({ dAppRequestStore: { onPermission: mockedOnPermission } }),
    );

    const noButton = screen.getByRole("button", { name: "No" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    await userEvent.click(noButton);
    expect(mockedOnPermission).toHaveBeenCalledTimes(1);
    expect(mockedOnPermission).toHaveBeenCalledWith(false);
  });

  it("should call onPermission with true if request is approved", async () => {
    const mockedOnPermission = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          onPermission: mockedOnPermission,
          canProceed: true,
        },
      }),
    );

    const yesButton = screen.getByRole("button", { name: "Yes" });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
    await userEvent.click(yesButton);
    expect(mockedOnPermission).toHaveBeenCalledTimes(1);
    expect(mockedOnPermission).toHaveBeenCalledWith(true);
  });

  it("should display the transaction running component while processing the request", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          approvalProcessingStatus: { isProcessing: true },
        },
      }),
    );

    expect(screen.getByText("Transaction running")).toBeInTheDocument();
    expect(
      screen.getByText("Please wait. This may take a while."),
    ).toBeInTheDocument();
  });
});
