import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import LockPasswordCheck from "./LockPasswordCheck";

const {
  mockGetUnlockAttemptState,
  mockRecordFailedUnlockAttempt,
  mockClearUnlockAttempts,
} = vi.hoisted(() => ({
  mockGetUnlockAttemptState: vi.fn(),
  mockRecordFailedUnlockAttempt: vi.fn(),
  mockClearUnlockAttempts: vi.fn(),
}));

// F7: the component only needs to react to this module's answers; the
// storage plumbing itself is covered by unlockAttemptLimiter.test.ts.
vi.mock("@/utilities/unlockAttemptLimiter", () => ({
  getUnlockAttemptState: mockGetUnlockAttemptState,
  recordFailedUnlockAttempt: mockRecordFailedUnlockAttempt,
  clearUnlockAttempts: mockClearUnlockAttempts,
}));

describe("LockPasswordCheck", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockGetUnlockAttemptState.mockReset().mockResolvedValue({
      failedAttempts: 0,
      waitUntil: 0,
    });
    mockRecordFailedUnlockAttempt.mockReset().mockResolvedValue({
      failedAttempts: 1,
      waitUntil: 0,
    });
    mockClearUnlockAttempts.mockReset().mockResolvedValue(undefined);
  });

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
    expect(
      screen.queryByText("Enter the wallet password"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Enter password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("should display the field error if password validation fails", async () => {
    renderComponent(
      mockedStore({
        lockStore: {
          unlock: async (_password: string) => {
            return "wrong-password" as const;
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

  it("does not show the account address on the lock screen", () => {
    const address = "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1";
    renderComponent(
      mockedStore({
        qrlStore: { activeAccount: { accountAddress: address } },
      }),
    );

    expect(
      screen.queryByText(formatQrlAddressFingerprint(address)),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(address)).not.toBeInTheDocument();
  });

  describe("unlock attempt limiting (F7)", () => {
    it("records a failed attempt and shows a wait message once one is imposed", async () => {
      mockRecordFailedUnlockAttempt.mockResolvedValue({
        failedAttempts: 6,
        waitUntil: Date.now() + 5_000,
      });
      renderComponent(
        mockedStore({
          lockStore: {
            unlock: async () => "wrong-password" as const,
          },
        }),
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
      await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

      await waitFor(() => {
        expect(mockRecordFailedUnlockAttempt).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Try again in \d+s\./,
        );
      });
      expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
      expect(screen.getByLabelText("Enter password")).toBeDisabled();
    });

    it("does not show a wait message or disable the form for the first few failures", async () => {
      mockRecordFailedUnlockAttempt.mockResolvedValue({
        failedAttempts: 2,
        waitUntil: 0,
      });
      renderComponent(
        mockedStore({
          lockStore: {
            unlock: async () => "wrong-password" as const,
          },
        }),
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
      await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

      await waitFor(() => {
        expect(
          screen.getByText("The entered password is incorrect"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Enter password")).toBeEnabled();
    });

    it("restores an in-progress wait on mount (survives a reload)", async () => {
      mockGetUnlockAttemptState.mockResolvedValue({
        failedAttempts: 7,
        waitUntil: Date.now() + 10_000,
      });
      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
      });
      expect(screen.getByLabelText("Enter password")).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Try again in \d+s\./,
      );
    });

    it("disables the unlock button once a wait is imposed, so a second click cannot retry early", async () => {
      const unlock = vi.fn(async () => "wrong-password" as const);
      mockRecordFailedUnlockAttempt.mockResolvedValue({
        failedAttempts: 6,
        waitUntil: Date.now() + 10_000,
      });
      renderComponent(mockedStore({ lockStore: { unlock } }));

      await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
      const unlockButton = screen.getByRole("button", { name: "Unlock" });
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(unlockButton).toBeDisabled();
      });
      expect(unlock).toHaveBeenCalledTimes(1);

      // The button is disabled: a real user cannot click it again, and
      // userEvent respects that the same way a browser would.
      await userEvent.click(unlockButton);
      expect(unlock).toHaveBeenCalledTimes(1);
    });

    it("clears the attempt counter on a successful unlock", async () => {
      renderComponent(
        mockedStore({
          lockStore: {
            unlock: async () => "success" as const,
          },
        }),
      );

      await userEvent.type(
        screen.getByLabelText("Enter password"),
        "correct-password",
      );
      await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

      await waitFor(() => {
        expect(mockClearUnlockAttempts).toHaveBeenCalledTimes(1);
      });
      expect(mockRecordFailedUnlockAttempt).not.toHaveBeenCalled();
    });

    it("does not record a failed attempt for an inconclusive 'failed' result (N2)", async () => {
      // e.g. the final IS_LOCKED re-check inside unlock() could not confirm
      // in time - the worker already verified the password, so this must
      // never count against the limiter the way a confirmed wrong password
      // does.
      renderComponent(
        mockedStore({
          lockStore: {
            unlock: async () => "failed" as const,
          },
        }),
      );

      await userEvent.type(
        screen.getByLabelText("Enter password"),
        "correct-password",
      );
      await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

      await waitFor(() => {
        expect(
          screen.getByText("Could not verify your password. Please try again."),
        ).toBeInTheDocument();
      });
      expect(mockRecordFailedUnlockAttempt).not.toHaveBeenCalled();
      expect(mockClearUnlockAttempts).not.toHaveBeenCalled();
    });
  });
});
