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
      await screen.findByText(
        "Your unlocked session expired. Lock the wallet and unlock it again, then retry.",
      ),
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
      await screen.findByText(
        "Your unlocked session expired. Lock the wallet and unlock it again, then retry.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Mocked Seed Backup")).toBeInTheDocument();
    expect(encryptAccount).not.toHaveBeenCalled();
    expect(screen.queryByText("Account created")).not.toBeInTheDocument();
  });
});
