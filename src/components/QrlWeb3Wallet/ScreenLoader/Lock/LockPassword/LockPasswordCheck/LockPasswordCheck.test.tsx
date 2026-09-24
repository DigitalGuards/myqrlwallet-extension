import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import LockPasswordCheck from "./LockPasswordCheck";

describe("LockPasswordCheck", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <LockPasswordCheck />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the lock password check component", () => {
    renderComponent();

    // The unlock screen stays minimal: no heading or helper copy, the
    // field's placeholder doubles as its accessible name.
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Unlock the wallet with your password"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Enter the wallet password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Enter password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("should display the field error if password validation fails", async () => {
    renderComponent(
      mockedStore({
        lockStore: {
          unlock: async (_password: string) => {
            return false;
          },
        },
      }),
    );

    const passwordField = screen.getByLabelText("Enter password");
    await userEvent.type(passwordField, "pass");
    expect(passwordField).toHaveValue("pass");
    const unlockButton = screen.getByRole("button", { name: "Unlock" });
    await userEvent.click(unlockButton);
    await waitFor(() => {
      expect(
        screen.getByText("The entered password is incorrect"),
      ).toBeInTheDocument();
    });
    await userEvent.type(passwordField, "{backspace}".repeat("pass".length));
    expect(passwordField).toHaveValue("");
    await waitFor(() => {
      expect(screen.getByText("Enter your password")).toBeInTheDocument();
    });
  });

  it("should not display the field error if password validation succeeds", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
          },
        },
      }),
    );

    const passwordField = screen.getByLabelText("Enter password");
    await userEvent.type(passwordField, "test123456");
    await waitFor(() => {
      expect(
        screen.queryByText("Password must be at least 12 characters"),
      ).not.toBeInTheDocument();
    });
  });

  it("should render the unlock button disabled if the password field is empty", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
          },
        },
      }),
    );

    const unlockButton = screen.getByRole("button", { name: "Unlock" });
    expect(unlockButton).toBeDisabled();
  });

  it("should render the unlock button enabled if the password field is filled", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
          },
        },
      }),
    );

    const unlockButton = screen.getByRole("button", { name: "Unlock" });
    const passwordField = screen.getByLabelText("Enter password");
    await userEvent.type(passwordField, "test123456");
    await waitFor(() => {
      expect(unlockButton).toBeEnabled();
    });
  });

  it("toggles the password field between hidden and revealed", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
          },
        },
      }),
    );

    const passwordField = screen.getByLabelText("Enter password");
    expect(passwordField).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", {
      name: "Toggle password visibility",
    });
    // Keyboard-reachable and state-annotated for assistive tech.
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);
    expect(passwordField).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    expect(passwordField).toHaveAttribute("type", "password");
  });

  it("shows the account identity chip with the abbreviated address", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
          },
        },
      }),
    );

    const address = "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1";
    expect(
      screen.getByText(formatQrlAddressFingerprint(address)),
    ).toBeInTheDocument();
    expect(screen.getByText(address)).toHaveClass("sr-only");
  });
});
