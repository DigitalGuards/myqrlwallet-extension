import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import BackButton from "./BackButton";

const { mockedNavigateFunction } = vi.hoisted(() => ({
  mockedNavigateFunction: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const originalModule =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    __esModule: true,
    ...originalModule,
    useNavigate: () => mockedNavigateFunction,
  };
});

describe("BackButton", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <BackButton />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the back button", () => {
    renderComponent();

    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("exposes a real button with a translated accessible name", () => {
    renderComponent();

    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toBeInTheDocument();
    expect(backButton).toHaveAttribute("type", "button");
  });

  it("is reachable by keyboard and activates on Enter", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.tab();
    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(mockedNavigateFunction).toHaveBeenCalledTimes(1);
  });

  it("should call the navigate function to return back on clicking the button", async () => {
    renderComponent();

    const backButton = screen.getByTestId("backButtonTestId");
    await waitFor(() => {
      backButton.click();
    });
    expect(mockedNavigateFunction).toHaveBeenCalledTimes(1);
  });
});
