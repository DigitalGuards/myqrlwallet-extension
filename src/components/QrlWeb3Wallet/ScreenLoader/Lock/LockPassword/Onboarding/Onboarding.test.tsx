import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StorageUtil from "@/utilities/storageUtil";
import Onboarding from "./Onboarding";

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getAllAccounts: vi.fn().mockResolvedValue(["QExisting"]),
    setAllAccounts: vi.fn().mockResolvedValue(undefined),
    clearActiveAccount: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/Welcome/Welcome",
  () => ({
    default: ({ selectStep }: { selectStep: (step: string) => void }) => (
      <div>
        Mocked Welcome
        <button onClick={() => selectStep("ADD_OR_IMPORT_ACCOUNT")}>
          skip to accounts
        </button>
      </div>
    ),
  }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/AddOrImportAccount/AddOrImportAccount",
  () => ({
    default: ({
      addAnAccountToWallet,
    }: {
      addAnAccountToWallet: (account: {
        address: string;
        seed: string;
      }) => Promise<void>;
    }) => (
      <button
        onClick={() =>
          addAnAccountToWallet({ address: "QNew", seed: "0xseed" }).catch(
            () => {},
          )
        }
      >
        add account
      </button>
    ),
  }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/LockPasswordSetup/LockPasswordSetup",
  () => ({ default: () => <div>Mocked Lock Password Setup</div> }),
);

describe("Onboarding", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the welcome screen as the first step", async () => {
    renderComponent(
      mockedStore({
        lockStore: { encryptAccount: async () => {} },
        qrlStore: {
          setActiveAccount: async (_accountAddress: string) => {},
        },
      }),
    );

    expect(screen.getByText("Mocked Welcome")).toBeInTheDocument();
  });

  it("points the active account before the keystore write, so the service worker never sees keystores without an account", async () => {
    const calls: string[] = [];
    const encryptAccount = vi.fn(async () => {
      calls.push("encrypt");
    });
    const setActiveAccount = vi.fn(async () => {
      calls.push("activate");
    });
    renderComponent(
      mockedStore({
        lockStore: { encryptAccount },
        qrlStore: { setActiveAccount, clearAccountState: () => {} },
        accountLabelsStore: { ensureLabel: async () => {} },
      }),
    );

    await userEvent.click(screen.getByText("skip to accounts"));
    await userEvent.click(screen.getByText("add account"));

    await waitFor(() => expect(setActiveAccount).toHaveBeenCalledWith("QNew"));
    expect(calls).toEqual(["activate", "encrypt"]);
  });

  it("rolls the account pointer back when the keystore write fails", async () => {
    const setActiveAccount = vi.fn(async () => {});
    const clearAccountState = vi.fn();
    renderComponent(
      mockedStore({
        lockStore: {
          encryptAccount: async () => {
            throw new Error("service worker unreachable");
          },
        },
        qrlStore: { setActiveAccount, clearAccountState },
      }),
    );

    await userEvent.click(screen.getByText("skip to accounts"));
    await userEvent.click(screen.getByText("add account"));

    await waitFor(() => expect(clearAccountState).toHaveBeenCalled());
    expect(setActiveAccount).toHaveBeenCalledWith("QNew");
    expect(StorageUtil.setAllAccounts).toHaveBeenCalledWith(["QExisting"]);
    expect(StorageUtil.clearActiveAccount).toHaveBeenCalled();
  });
});
