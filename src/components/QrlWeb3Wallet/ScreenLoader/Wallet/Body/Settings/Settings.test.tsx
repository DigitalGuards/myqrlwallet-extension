import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";

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

describe("Settings", () => {
  afterEach(() => {
    cleanup();
    mockedNavigateFunction.mockClear();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

  it("should render the Settings heading", () => {
    renderComponent();

    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("should render all menu items", () => {
    renderComponent();

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("renders every menu row as a button with its own accessible name", () => {
    renderComponent();

    for (const name of [
      "Appearance",
      "Security",
      "Preferences",
      "Data",
      "About",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "type",
        "button",
      );
    }
  });

  it("reaches the first row by keyboard and activates it with Space", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.tab();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveFocus();

    await user.keyboard(" ");
    expect(mockedNavigateFunction).toHaveBeenCalledTimes(1);
  });
});
