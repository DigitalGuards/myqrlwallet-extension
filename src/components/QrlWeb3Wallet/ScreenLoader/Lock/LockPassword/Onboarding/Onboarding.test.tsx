import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Onboarding from "./Onboarding";

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

  it("writes the keystore before pointing the active account at it", async () => {
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
    expect(calls).toEqual(["encrypt", "activate"]);
  });

  it("leaves the active account untouched when the keystore write fails", async () => {
    const setActiveAccount = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        lockStore: {
          encryptAccount: async () => {
            throw new Error("service worker unreachable");
          },
        },
        qrlStore: { setActiveAccount, clearAccountState: () => {} },
      }),
    );

    await userEvent.click(screen.getByText("skip to accounts"));
    await userEvent.click(screen.getByText("add account"));

    await waitFor(() =>
      expect(screen.getByText("add account")).toBeInTheDocument(),
    );
    expect(setActiveAccount).not.toHaveBeenCalled();
  });
});
