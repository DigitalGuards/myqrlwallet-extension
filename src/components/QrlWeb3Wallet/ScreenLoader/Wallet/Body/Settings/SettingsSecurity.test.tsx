import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SettingsSecurity from "./SettingsSecurity";
import * as unlockAttempts from "@/utilities/unlockAttemptLimiter";
import { deferred } from "@/test-utils/deferred";
import * as resolvers from "@hookform/resolvers/zod";

vi.mock("@hookform/resolvers/zod", async () => ({
  ...(await vi.importActual<typeof import("@hookform/resolvers/zod")>(
    "@hookform/resolvers/zod",
  )),
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SettingsSecurity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <SettingsSecurity />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the Security & Privacy heading", () => {
    renderComponent();

    expect(screen.getByText("Security & Privacy")).toBeInTheDocument();
  });

  it("should render the auto-lock select trigger", () => {
    renderComponent();

    expect(
      screen.getByRole("combobox", { name: "Auto-lock timeout" }),
    ).toBeInTheDocument();
  });

  it("should call setAutoLockMinutes when selecting an option", async () => {
    const setAutoLockMinutes = vi.fn(() => Promise.resolve());
    renderComponent(mockedStore({ settingsStore: { setAutoLockMinutes } }));

    await userEvent.click(
      screen.getByRole("combobox", { name: "Auto-lock timeout" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "5 minutes" }));

    expect(setAutoLockMinutes).toHaveBeenCalledWith(5);
  });

  it("should call setAutoLockMinutes with 0 for Never", async () => {
    const setAutoLockMinutes = vi.fn(() => Promise.resolve());
    renderComponent(mockedStore({ settingsStore: { setAutoLockMinutes } }));

    await userEvent.click(
      screen.getByRole("combobox", { name: "Auto-lock timeout" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Never" }));

    expect(setAutoLockMinutes).toHaveBeenCalledWith(0);
  });

  it("should render the show balance and price checkbox", () => {
    renderComponent();

    expect(
      screen.getByLabelText("Show balance and token price"),
    ).toBeInTheDocument();
  });

  it("should render CoinGecko privacy notice", () => {
    renderComponent();

    expect(screen.getByText(/CoinGecko API/)).toBeInTheDocument();
  });

  it("should call setShowBalanceAndPrice when toggling checkbox", async () => {
    const setShowBalanceAndPrice = vi.fn(() => Promise.resolve());
    const setRefreshEnabled = vi.fn();
    renderComponent(
      mockedStore({
        settingsStore: { showBalanceAndPrice: true, setShowBalanceAndPrice },
        priceStore: { setRefreshEnabled },
      }),
    );

    // Click to uncheck (currently checked because showBalanceAndPrice: true)
    await userEvent.click(
      screen.getByLabelText("Show balance and token price"),
    );

    expect(setShowBalanceAndPrice).toHaveBeenCalledWith(false);
  });

  it("should start auto-refresh when enabling balance display", async () => {
    const setShowBalanceAndPrice = vi.fn(() => Promise.resolve());
    const setRefreshEnabled = vi.fn();
    renderComponent(
      mockedStore({
        settingsStore: { showBalanceAndPrice: false, setShowBalanceAndPrice },
        priceStore: { setRefreshEnabled },
      }),
    );

    // Click to check (currently unchecked because showBalanceAndPrice: false)
    await userEvent.click(
      screen.getByLabelText("Show balance and token price"),
    );

    expect(setShowBalanceAndPrice).toHaveBeenCalledWith(true);
    expect(setRefreshEnabled).toHaveBeenCalledWith(true);
  });

  it("should stop auto-refresh when disabling balance display", async () => {
    const setShowBalanceAndPrice = vi.fn(() => Promise.resolve());
    const setRefreshEnabled = vi.fn();
    renderComponent(
      mockedStore({
        settingsStore: { showBalanceAndPrice: true, setShowBalanceAndPrice },
        priceStore: { setRefreshEnabled },
      }),
    );

    await userEvent.click(
      screen.getByLabelText("Show balance and token price"),
    );

    expect(setShowBalanceAndPrice).toHaveBeenCalledWith(false);
    expect(setRefreshEnabled).toHaveBeenCalledWith(false);
  });

  describe("Change Password", () => {
    it("should render the Change Password button", () => {
      renderComponent();

      expect(
        screen.getByRole("button", { name: /Change Password/i }),
      ).toBeInTheDocument();
    });

    it("should open the dialog when clicking Change Password", async () => {
      renderComponent();

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      expect(
        screen.getByText("Enter your current password and choose a new one."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Current password")).toBeInTheDocument();
      expect(screen.getByLabelText("New password")).toBeInTheDocument();
      expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    });

    it("should keep the submit button disabled until all fields are valid", async () => {
      renderComponent();

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      const dialog = screen.getByRole("dialog");
      const submitButton = within(dialog).getByRole("button", {
        name: /Change Password/i,
      });
      expect(submitButton).toBeDisabled();

      // Fill only current password - still disabled
      await userEvent.type(
        screen.getByLabelText("Current password"),
        "oldpass12345",
      );
      expect(submitButton).toBeDisabled();

      // Fill new password but not confirm - still disabled
      await userEvent.type(
        screen.getByLabelText("New password"),
        "newpass12345",
      );
      expect(submitButton).toBeDisabled();

      // Fill confirm with matching password - now enabled
      await userEvent.type(
        screen.getByLabelText("Confirm new password"),
        "newpass12345",
      );
      await waitFor(() => {
        expect(submitButton).toBeEnabled();
      });
    });

    it("should show validation error when new passwords don't match", async () => {
      renderComponent();

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      await userEvent.type(
        screen.getByLabelText("Current password"),
        "oldpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("New password"),
        "newpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("Confirm new password"),
        "different123",
      );

      await waitFor(() => {
        expect(screen.getByText("Passwords doesn't match")).toBeInTheDocument();
      });
    });

    it("should call changePassword and show success on correct password", async () => {
      const changePassword = vi.fn(() => Promise.resolve("success" as const));
      renderComponent(mockedStore({ lockStore: { changePassword } }));

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      await userEvent.type(
        screen.getByLabelText("Current password"),
        "oldpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("New password"),
        "newpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("Confirm new password"),
        "newpass12345",
      );

      const dialog = screen.getByRole("dialog");
      const submitButton = within(dialog).getByRole("button", {
        name: /Change Password/i,
      });
      await waitFor(() => {
        expect(submitButton).toBeEnabled();
      });

      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(changePassword).toHaveBeenCalledWith(
          "oldpass12345",
          "newpass12345",
        );
        expect(
          screen.getByText("Password changed successfully"),
        ).toBeInTheDocument();
      });
    });

    it("should show error when current password is incorrect", async () => {
      const changePassword = vi.fn(() =>
        Promise.resolve("wrong-password" as const),
      );
      renderComponent(mockedStore({ lockStore: { changePassword } }));

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      await userEvent.type(
        screen.getByLabelText("Current password"),
        "wrongpass123",
      );
      await userEvent.type(
        screen.getByLabelText("New password"),
        "newpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("Confirm new password"),
        "newpass12345",
      );

      const dialog = screen.getByRole("dialog");
      const submitButton = within(dialog).getByRole("button", {
        name: /Change Password/i,
      });
      await waitFor(() => {
        expect(submitButton).toBeEnabled();
      });

      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(changePassword).toHaveBeenCalledWith(
          "wrongpass123",
          "newpass12345",
        );
        expect(
          screen.getByText("Current password is incorrect"),
        ).toBeInTheDocument();
      });
    });

    it("shows an honest 'could not verify' message for a 'failed' result, distinct from a wrong password (N1/N2)", async () => {
      const changePassword = vi.fn(() => Promise.resolve("failed" as const));
      renderComponent(mockedStore({ lockStore: { changePassword } }));

      await userEvent.click(
        screen.getByRole("button", { name: /Change Password/i }),
      );

      await userEvent.type(
        screen.getByLabelText("Current password"),
        "oldpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("New password"),
        "newpass12345",
      );
      await userEvent.type(
        screen.getByLabelText("Confirm new password"),
        "newpass12345",
      );

      const dialog = screen.getByRole("dialog");
      const submitButton = within(dialog).getByRole("button", {
        name: /Change Password/i,
      });
      await waitFor(() => {
        expect(submitButton).toBeEnabled();
      });

      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("Could not verify your password. Please try again."),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByText("Current password is incorrect"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Password changed successfully"),
      ).not.toBeInTheDocument();
    });
  });

  it("reports a rejected auto-lock save", async () => {
    const error = new Error("storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        settingsStore: { setAutoLockMinutes: vi.fn().mockRejectedValue(error) },
      }),
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Auto-lock timeout" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "5 minutes" }));
    expect(report).toHaveBeenCalledWith(
      "Failed to save auto-lock timeout:",
      error,
    );
  });

  it.each([
    {
      label: "Show balance and token price",
      message: "Failed to save balance display preference:",
    },
    {
      label: "Transaction notifications",
      message: "Failed to save notification preference:",
    },
    {
      label: "Phishing detection",
      message: "Failed to save phishing detection preference:",
    },
  ])("reports a rejected $label save", async ({ label, message }) => {
    const error = new Error("storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const setRefreshEnabled = vi.fn();
    renderComponent(
      mockedStore({
        settingsStore: {
          setShowBalanceAndPrice: save,
          setNotificationsEnabled: save,
          setPhishingDetectionEnabled: save,
        },
        priceStore: { setRefreshEnabled },
      }),
    );
    await userEvent.click(screen.getByLabelText(label));
    expect(save).toHaveBeenCalledWith(false);
    expect(report).toHaveBeenCalledWith(message, error);
    if (label === "Show balance and token price")
      expect(setRefreshEnabled).toHaveBeenCalledWith(false);
  });

  it("updates price polling while preference persistence is still pending", async () => {
    const save = deferred<undefined>();
    const setShowBalanceAndPrice = vi.fn().mockReturnValue(save.promise);
    const setRefreshEnabled = vi.fn();
    renderComponent(
      mockedStore({
        settingsStore: { setShowBalanceAndPrice },
        priceStore: { setRefreshEnabled },
      }),
    );
    await userEvent.click(
      screen.getByLabelText("Show balance and token price"),
    );
    expect(setShowBalanceAndPrice).toHaveBeenCalledWith(false);
    expect(setRefreshEnabled).toHaveBeenCalledWith(false);
    expect(setShowBalanceAndPrice.mock.invocationCallOrder[0]).toBeLessThan(
      setRefreshEnabled.mock.invocationCallOrder[0] ?? 0,
    );
    save.resolve(undefined);
    await save.promise;
  });

  it("reports an unreadable unlock-attempt counter before changing a password", async () => {
    const read = vi
      .spyOn(unlockAttempts, "getUnlockAttemptState")
      .mockResolvedValue({ failedAttempts: 0, waitUntil: 0 });
    const changePassword = vi.fn();
    renderComponent(mockedStore({ lockStore: { changePassword } }));
    await userEvent.click(
      screen.getByRole("button", { name: /Change Password/i }),
    );
    await userEvent.type(
      screen.getByLabelText("Current password"),
      "old-password-123",
    );
    await userEvent.type(
      screen.getByLabelText("New password"),
      "new-password-123",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm new password"),
      "new-password-123",
    );
    read.mockRejectedValueOnce(new Error("Attempt counter unavailable"));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Change Password/i,
      }),
    );
    expect(
      await screen.findByText("Attempt counter unavailable"),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("reports a rejected password form submission", async () => {
    const error = new Error("validation unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolver = vi.fn(() => Promise.resolve({ values: {}, errors: {} }));
    vi.spyOn(resolvers, "zodResolver").mockReturnValue(resolver);
    const changePassword = vi.fn();
    renderComponent(mockedStore({ lockStore: { changePassword } }));
    await userEvent.click(
      screen.getByRole("button", { name: /Change Password/i }),
    );
    const form = screen.getByRole("dialog").querySelector("form");
    if (!form) throw new Error("Missing password form");
    await waitFor(() => {
      expect(resolver).toHaveBeenCalled();
    });
    resolver.mockRejectedValueOnce(error);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to submit password change:",
        error,
      );
    });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
