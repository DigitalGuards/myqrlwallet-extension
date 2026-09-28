import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import CreateAccount from "./CreateAccount";

// The real backup flow is covered by SeedBackup.test; here it is a stub
// that exposes the confirm and back callbacks plus the persist error.
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Shared/SeedBackup/SeedBackup",
  () => ({
    default: ({
      account,
      onConfirmed,
      onBack,
      error,
    }: {
      account: Web3BaseWalletAccount;
      onConfirmed: () => void;
      onBack?: () => void;
      error?: string;
    }) => (
      <div>
        <h3>Mocked Seed Backup</h3>
        <div>{account.address}</div>
        {error && <div>{error}</div>}
        <button onClick={onConfirmed}>Confirm backup</button>
        <button onClick={onBack}>Back</button>
      </div>
    ),
  }),
);

const ADDRESS = "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1";
const createdAccount = () => ({
  address: ADDRESS,
  seed: "",
  sign: () => ({ messageHash: "", signature: "", message: "" }),
  signTransaction: async () => ({
    messageHash: "",
    rawTransaction: "",
    signature: "",
    transactionHash: "",
  }),
  encrypt: async () => {
    throw new Error("Not implemented");
  },
});
const storeWithCreate = (overrides = {}) =>
  mockedStore({
    qrlStore: { qrlInstance: { accounts: { create: createdAccount } } },
    ...overrides,
  });

describe("CreateAccount", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <CreateAccount />
        </MemoryRouter>
      </StoreProvider>,
    );

  const clickCreate = async () => {
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Create account" }),
      );
    });
  };

  it("should render the account creation form for creating account if the account is not yet created", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
        "Create a new account",
      );
      expect(
        screen.getByText(
          "You can add a new account to this wallet. After creating the account, ensure you keep the account recovery phrases safe.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create account" }),
      ).toBeInTheDocument();
    });
  });

  it("should show the seed backup once the account is created, without persisting it yet", async () => {
    const encryptAccount = vi.fn(async () => {});
    renderComponent(storeWithCreate({ lockStore: { encryptAccount } }));

    await clickCreate();

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Mocked Seed Backup",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(encryptAccount).not.toHaveBeenCalled();
  });

  it("should show an error and not reveal the seed when the password is unavailable", async () => {
    renderComponent(
      storeWithCreate({
        lockStore: {
          getWalletPassword: async () => {
            throw new Error("WALLET_PASSWORD_UNAVAILABLE");
          },
        },
      }),
    );

    await clickCreate();

    expect(
      await screen.findByText("Your unlocked session expired."),
    ).toBeInTheDocument();
    // F1: an inline re-entry replaces the old alert's dead-end instruction
    // to go lock and unlock the wallet.
    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mocked Seed Backup")).not.toBeInTheDocument();
  });

  it("should discard the account when backing out of the seed backup", async () => {
    const encryptAccount = vi.fn(async () => {});
    renderComponent(storeWithCreate({ lockStore: { encryptAccount } }));

    await clickCreate();
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Create a new account",
    );
    expect(encryptAccount).not.toHaveBeenCalled();
  });

  it("should persist the account and show the success screen once the backup is confirmed", async () => {
    const encryptAccount = vi.fn(async () => {});
    const setActiveAccount = vi.fn(async () => {});
    renderComponent(
      storeWithCreate({
        lockStore: { encryptAccount },
        qrlStore: {
          qrlInstance: { accounts: { create: createdAccount } },
          setActiveAccount,
        },
      }),
    );

    await clickCreate();
    await act(async () => {
      await userEvent.click(
        await screen.findByRole("button", { name: "Confirm backup" }),
      );
    });

    expect(encryptAccount).toHaveBeenCalledTimes(1);
    expect(setActiveAccount).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Account created",
    );
    expect(screen.getByText("Account public address:")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20504 6e6A6 E159e D6ACe dE46A 36CAD 6D449 C80A1"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("should stay on the backup with an error when persisting fails at confirm time", async () => {
    const getWalletPassword = vi
      .fn()
      .mockResolvedValueOnce("password")
      .mockRejectedValueOnce(new Error("WALLET_PASSWORD_UNAVAILABLE"));
    const encryptAccount = vi.fn(async () => {});
    renderComponent(
      storeWithCreate({ lockStore: { getWalletPassword, encryptAccount } }),
    );

    await clickCreate();
    await act(async () => {
      await userEvent.click(
        await screen.findByRole("button", { name: "Confirm backup" }),
      );
    });

    expect(
      await screen.findByText("Your unlocked session expired."),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked Seed Backup")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(encryptAccount).not.toHaveBeenCalled();
    expect(screen.queryByText("Account created")).not.toBeInTheDocument();
  });

  describe("session re-arm (F1)", () => {
    it("continues onto the seed backup after the inline password re-arms the session", async () => {
      // First getWalletPassword call (pre-reveal check) fails; the second,
      // made by the retry after a successful inline unlock, succeeds.
      const getWalletPassword = vi
        .fn()
        .mockRejectedValueOnce(new Error("WALLET_PASSWORD_UNAVAILABLE"))
        .mockResolvedValue("password");
      const unlock = vi.fn(async () => "success" as const);
      renderComponent(
        storeWithCreate({ lockStore: { getWalletPassword, unlock } }),
      );

      await clickCreate();
      expect(
        await screen.findByText("Your unlocked session expired."),
      ).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      });

      expect(unlock).toHaveBeenCalledWith("pw");
      // The same generated account carries through: no regeneration, and
      // the backup screen (not another error) is now showing.
      expect(
        await screen.findByRole("heading", {
          level: 3,
          name: "Mocked Seed Backup",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    });

    it("shows the normal wrong-password error inline when the re-arm password is wrong", async () => {
      const getWalletPassword = vi
        .fn()
        .mockRejectedValue(new Error("WALLET_PASSWORD_UNAVAILABLE"));
      const unlock = vi.fn(async () => "wrong-password" as const);
      renderComponent(
        storeWithCreate({ lockStore: { getWalletPassword, unlock } }),
      );

      await clickCreate();
      await screen.findByText("Your unlocked session expired.");

      await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      });

      expect(
        await screen.findByText("The entered password is incorrect"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Mocked Seed Backup")).not.toBeInTheDocument();
    });

    it("retries encryptAccount in place after re-arming at the confirm-backup step", async () => {
      const getWalletPassword = vi
        .fn()
        .mockResolvedValueOnce("password")
        .mockRejectedValueOnce(new Error("WALLET_PASSWORD_UNAVAILABLE"))
        .mockResolvedValue("password");
      const encryptAccount = vi.fn(async () => {});
      const setActiveAccount = vi.fn(async () => {});
      const unlock = vi.fn(async () => "success" as const);
      renderComponent(
        storeWithCreate({
          lockStore: { getWalletPassword, encryptAccount, unlock },
          qrlStore: {
            qrlInstance: { accounts: { create: createdAccount } },
            setActiveAccount,
          },
        }),
      );

      await clickCreate();
      await act(async () => {
        await userEvent.click(
          await screen.findByRole("button", { name: "Confirm backup" }),
        );
      });
      await screen.findByText("Your unlocked session expired.");
      expect(encryptAccount).not.toHaveBeenCalled();

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      });

      expect(unlock).toHaveBeenCalledWith("pw");
      expect(encryptAccount).toHaveBeenCalledTimes(1);
      expect(setActiveAccount).toHaveBeenCalledWith(ADDRESS);
      expect(
        await screen.findByRole("heading", { level: 3 }),
      ).toHaveTextContent("Account created");
    });

    it("keeps the backup screen and the generated account up on a 'failed' re-arm result (N8)", async () => {
      const getWalletPassword = vi
        .fn()
        .mockResolvedValueOnce("password")
        .mockRejectedValueOnce(new Error("WALLET_PASSWORD_UNAVAILABLE"));
      const encryptAccount = vi.fn(async () => {});
      const unlock = vi.fn(async () => "failed" as const);
      renderComponent(
        storeWithCreate({
          lockStore: { getWalletPassword, encryptAccount, unlock },
        }),
      );

      await clickCreate();
      await act(async () => {
        await userEvent.click(
          await screen.findByRole("button", { name: "Confirm backup" }),
        );
      });
      await screen.findByText("Your unlocked session expired.");

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      });

      await waitFor(() => {
        expect(
          screen.getByText("Could not verify your password. Please try again."),
        ).toBeInTheDocument();
      });
      // The generated account (and its backup screen) is still here, not
      // discarded by an incorrect lockStore.isLocked flip.
      expect(screen.getByText("Mocked Seed Backup")).toBeInTheDocument();
      expect(screen.getByText(ADDRESS)).toBeInTheDocument();
      expect(encryptAccount).not.toHaveBeenCalled();
    });
  });

  describe("a non-password-availability encryptAccount failure (N11)", () => {
    it("shows the real error and does not offer a re-arm prompt", async () => {
      const encryptAccount = vi.fn(async () => {
        throw new Error(
          "The wallet contains a keystore with an invalid address",
        );
      });
      const setActiveAccount = vi.fn(async () => {});
      renderComponent(
        storeWithCreate({
          lockStore: { encryptAccount },
          qrlStore: {
            qrlInstance: { accounts: { create: createdAccount } },
            setActiveAccount,
          },
        }),
      );

      await clickCreate();
      await act(async () => {
        await userEvent.click(
          await screen.findByRole("button", { name: "Confirm backup" }),
        );
      });

      await waitFor(() => {
        expect(
          screen.getByText(
            "The wallet contains a keystore with an invalid address",
          ),
        ).toBeInTheDocument();
      });
      // getWalletPassword() already succeeded (default mock), so this is
      // not a password-availability problem: no re-arm prompt.
      expect(
        screen.queryByRole("button", { name: "Continue" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Enter password")).not.toBeInTheDocument();
      expect(setActiveAccount).not.toHaveBeenCalled();
    });
  });
});
