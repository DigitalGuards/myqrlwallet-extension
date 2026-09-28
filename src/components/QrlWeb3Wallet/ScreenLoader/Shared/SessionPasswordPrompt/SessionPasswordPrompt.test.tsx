import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionPasswordPrompt from "./SessionPasswordPrompt";

describe("SessionPasswordPrompt (F1)", () => {
  afterEach(cleanup);

  const renderComponent = (
    onUnlocked: () => void | Promise<void>,
    mockedStoreValues = mockedStore(),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <SessionPasswordPrompt onUnlocked={onUnlocked} />
      </StoreProvider>,
    );

  it("renders a password field and a Continue button", () => {
    renderComponent(vi.fn());

    expect(screen.getByLabelText("Enter password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Enter your password to continue without losing your progress.",
      ),
    ).toBeInTheDocument();
  });

  it("disables the submit button until a password is entered", () => {
    renderComponent(vi.fn());

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("verifies the password through lockStore.unlock and calls onUnlocked on success", async () => {
    const unlock = vi.fn(async () => "success" as const);
    const onUnlocked = vi.fn();
    renderComponent(onUnlocked, mockedStore({ lockStore: { unlock } }));

    await userEvent.type(
      screen.getByLabelText("Enter password"),
      "correct-password",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(unlock).toHaveBeenCalledWith("correct-password");
    });
    await waitFor(() => {
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the normal wrong-password error and does not call onUnlocked", async () => {
    const unlock = vi.fn(async () => "wrong-password" as const);
    const onUnlocked = vi.fn();
    renderComponent(onUnlocked, mockedStore({ lockStore: { unlock } }));

    await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText("The entered password is incorrect"),
      ).toBeInTheDocument();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("shows an honest 'could not verify' message for a 'failed' result and does not flip lockStore.isLocked (N2/N8)", async () => {
    // A "failed" result is not a confirmed wrong password (e.g. the final
    // IS_LOCKED re-check inside unlock() could not confirm in time). The
    // caller here is mid-Import/Create with lockStore.isLocked already
    // false; onUnlocked must not fire (nothing to retry yet) and the
    // pending screen must not be torn down by a locked flip.
    const unlock = vi.fn(async () => "failed" as const);
    const onUnlocked = vi.fn();
    const store = mockedStore({ lockStore: { unlock, isLocked: false } });
    renderComponent(onUnlocked, store);

    await userEvent.type(screen.getByLabelText("Enter password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not verify your password. Please try again."),
      ).toBeInTheDocument();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(store.lockStore.isLocked).toBe(false);
  });

  it("surfaces the specific error unlock() throws, e.g. the legacy-address migration guard (N7)", async () => {
    const unlock = vi.fn(async () => {
      throw new Error(
        "Legacy Z-prefixed addresses require migration before unlocking.",
      );
    });
    const onUnlocked = vi.fn();
    renderComponent(onUnlocked, mockedStore({ lockStore: { unlock } }));

    await userEvent.type(screen.getByLabelText("Enter password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Legacy Z-prefixed addresses require migration before unlocking.",
        ),
      ).toBeInTheDocument();
    });
    // Not flattened to the generic copy.
    expect(
      screen.queryByText("Failed to unlock wallet. Please try again."),
    ).not.toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("falls back to the generic error message when unlock() throws a non-Error value", async () => {
    const unlock = vi.fn(async () => {
      throw "SW unreachable";
    });
    const onUnlocked = vi.fn();
    renderComponent(onUnlocked, mockedStore({ lockStore: { unlock } }));

    await userEvent.type(screen.getByLabelText("Enter password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to unlock wallet. Please try again."),
      ).toBeInTheDocument();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("toggles the password field between hidden and revealed", async () => {
    renderComponent(vi.fn());

    const passwordField = screen.getByLabelText("Enter password");
    expect(passwordField).toHaveAttribute("type", "password");

    await userEvent.click(
      screen.getByRole("button", { name: "Toggle password visibility" }),
    );

    expect(passwordField).toHaveAttribute("type", "text");
  });
});
