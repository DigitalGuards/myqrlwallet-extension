import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import userEvent from "@testing-library/user-event";
import AddOrImportAccount from "./AddOrImportAccount";
import { ONBOARDING_STEPS } from "../Onboarding";

vi.mock("@theqrl/web3", () => ({
  default: vi.fn().mockImplementation(() => ({
    qrl: {
      accounts: {
        create: vi.fn().mockReturnValue({
          address: "MockedNewAddress",
          seed: "MockedNewSeed",
        }),
        seedToAccount: vi.fn().mockReturnValue({
          address: "MockedAddress",
          seed: "MockedSeed",
        }),
      },
    },
  })),
  Web3BaseWalletAccount: class {},
}));
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/AddOrImportAccount/AccountAddressDisplay/AccountAddressDisplay",
  () => ({ default: () => <div>Mocked Account Address Display</div> }),
);
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
        <div>Mocked Seed Backup for {account.address}</div>
        {error && <div>{error}</div>}
        <button onClick={onConfirmed}>Confirm backup</button>
        <button onClick={onBack}>Back</button>
      </div>
    ),
  }),
);

describe("AddOrImportAccount", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AddOrImportAccount> = {
      selectStep: () => {},
      addAnAccountToWallet: async (_account: Web3BaseWalletAccount) => {},
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AddOrImportAccount {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  const noAccountStore = () =>
    mockedStore({ qrlStore: { activeAccount: { accountAddress: "" } } });

  it("should render the choose screen when the wallet has no account", () => {
    renderComponent(noAccountStore());

    expect(
      screen.getByRole("heading", { level: 3, name: "Add your first account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a new account" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Import an existing account" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
  });

  it("should persist a new account only after the backup is confirmed", async () => {
    const mockedSelectStep = vi.fn();
    const mockedAddAnAccountToWallet = vi.fn(async () => {});
    renderComponent(noAccountStore(), {
      selectStep: mockedSelectStep,
      addAnAccountToWallet: mockedAddAnAccountToWallet,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Create a new account" }),
    );

    expect(
      screen.getByText("Mocked Seed Backup for MockedNewAddress"),
    ).toBeInTheDocument();
    expect(mockedAddAnAccountToWallet).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Confirm backup" }),
    );

    await waitFor(() =>
      expect(mockedAddAnAccountToWallet).toHaveBeenCalledWith({
        address: "MockedNewAddress",
        seed: "MockedNewSeed",
      }),
    );
    expect(mockedSelectStep).toHaveBeenCalledWith(ONBOARDING_STEPS.COMPLETED);
  });

  it("should discard the new account when backing out of the backup", async () => {
    const mockedAddAnAccountToWallet = vi.fn(async () => {});
    renderComponent(noAccountStore(), {
      selectStep: () => {},
      addAnAccountToWallet: mockedAddAnAccountToWallet,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Create a new account" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Add your first account" }),
    ).toBeInTheDocument();
    expect(mockedAddAnAccountToWallet).not.toHaveBeenCalled();
  });

  it("should surface a persist failure on the backup step and stay there", async () => {
    const mockedSelectStep = vi.fn();
    renderComponent(noAccountStore(), {
      selectStep: mockedSelectStep,
      addAnAccountToWallet: vi.fn(async () => {
        throw new Error("storage full");
      }),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Create a new account" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm backup" }),
    );

    expect(
      await screen.findByText(/The account could not be saved\./),
    ).toBeInTheDocument();
    expect(mockedSelectStep).not.toHaveBeenCalled();
  });

  it("should import an account from a mnemonic inline", async () => {
    const mockedAddAnAccountToWallet = vi.fn(async () => {});
    renderComponent(noAccountStore(), {
      selectStep: () => {},
      addAnAccountToWallet: mockedAddAnAccountToWallet,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Import an existing account" }),
    );

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Import an existing account",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mnemonic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Hex seed" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Wallet file" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const mnemonicPhrasesField = await screen.findByRole("textbox", {
      name: "mnemonicPhrases",
    });
    const importButton = screen.getByRole("button", { name: "Import account" });
    expect(importButton).toBeDisabled();
    await userEvent.type(
      mnemonicPhrasesField,
      "harsh altar congo heater chilly spade buy pore money swiss trendy stable decade bosom ironic maxim slab grill chosen text pouch recent eric text injury cheese trek tsar fish rogue tempo differ",
    );
    await userEvent.click(importButton);

    await waitFor(() =>
      expect(mockedAddAnAccountToWallet).toHaveBeenCalledWith({
        address: "MockedAddress",
        seed: "MockedSeed",
      }),
    );
  });

  it("should return from the import card to the choose screen", async () => {
    renderComponent(noAccountStore());

    await userEvent.click(
      screen.getByRole("button", { name: "Import an existing account" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Add your first account" }),
    ).toBeInTheDocument();
  });

  it("should display the account address if account is available", async () => {
    const mockedSelectStep = vi.fn();
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q208318ecd68f26726CE7C54b29CaBA94584969B6",
          },
        },
      }),
      {
        selectStep: mockedSelectStep,
        addAnAccountToWallet: async () => {},
      },
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Account ready" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Account Address Display"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(mockedSelectStep).toHaveBeenCalledWith(ONBOARDING_STEPS.COMPLETED);
  });
});
