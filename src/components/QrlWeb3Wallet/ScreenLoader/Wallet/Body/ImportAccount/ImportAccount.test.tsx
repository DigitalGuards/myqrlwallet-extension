import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transaction } from "@theqrl/web3";
import { MemoryRouter } from "react-router-dom";
import ImportAccount from "./ImportAccount";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess",
  () => ({ default: () => <div>Mocked Account Import Success</div> }),
);

describe("ImportAccount", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ImportAccount />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the import account component with field and button", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
        "Import an existing account",
      );
      expect(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Paste the mnemonic phrases"),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Mnemonic Phrases"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Import account" }),
      ).toBeInTheDocument();
    });
  });

  it("should render the import account button disabled initially and should be enabled when the input is entered", async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Import account" }),
      ).toBeDisabled();
    });
    await userEvent.type(
      screen.getByRole("textbox", { name: "mnemonicPhrases" }),
      "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage",
    );
    expect(
      screen.getByRole("button", { name: "Import account" }),
    ).toBeEnabled();
  });

  it("should call the submit callback on clicking the import account button", async () => {
    renderComponent();

    const handleOnSubmitMock = vi.fn();
    await userEvent.type(
      screen.getByRole("textbox", { name: "mnemonicPhrases" }),
      "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage",
    );
    screen.getByRole("form", { name: "importAccount" }).onsubmit =
      handleOnSubmitMock;
    const button = screen.getByRole("button", { name: "Import account" });
    await userEvent.click(button);
    await waitFor(async () => {
      expect(handleOnSubmitMock).toHaveBeenCalledTimes(1);
    });
  });

  it("should display the account import success component on successful submit", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          qrlInstance: {
            accounts: {
              seedToAccount: (_seed: string | Uint8Array) => {
                return {
                  address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
                  seed: "",
                  sign: (_data: string | Record<string, unknown>) => {
                    return { messageHash: "", signature: "" };
                  },
                  signTransaction: async (_tx: Transaction) => {
                    return {
                      messageHash: "",
                      rawTransaction: "",
                      signature: "",
                      transactionHash: "",
                    };
                  },
                  encrypt: async () => {
                    throw new Error("Not implemented");
                  },
                };
              },
            },
          },
        },
      }),
    );

    const handleOnSubmitMock = vi.fn();
    await userEvent.type(
      screen.getByRole("textbox", { name: "mnemonicPhrases" }),
      "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage",
    );
    screen.getByRole("form", { name: "importAccount" }).onsubmit =
      handleOnSubmitMock;
    const button = screen.getByRole("button", { name: "Import account" });
    await userEvent.click(button);
    await waitFor(() => {
      expect(handleOnSubmitMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Mocked Account Import Success"),
      ).toBeInTheDocument();
    });
  });

  describe("when the unlock session has no password left", () => {
    // Reproduces the second-import bug: after a service-worker restart the
    // decrypted keys self-heal from session storage, so the wallet reads as
    // unlocked and no lock screen is shown, while the memory-only wallet
    // password is gone and getWalletPassword rejects.
    const seededAccount = {
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: "",
      sign: (_data: string | Record<string, unknown>) => ({
        messageHash: "",
        signature: "",
      }),
      signTransaction: async (_tx: Transaction) => ({
        messageHash: "",
        rawTransaction: "",
        signature: "",
        transactionHash: "",
      }),
      encrypt: async () => {
        throw new Error("Not implemented");
      },
    };

    const renderWithExpiredSession = (
      overrides: {
        unlock?: (password: string) => Promise<boolean>;
        getWalletPasswordAfterReArm?: () => Promise<string>;
      } = {},
    ) => {
      const setActiveAccount = vi.fn(async () => {});
      const encryptAccount = vi.fn(async () => {});
      const lock = vi.fn(async () => {});
      const unlock =
        overrides.unlock ??
        vi.fn(async () => {
          throw new Error("unlock not mocked for this test");
        });
      let getWalletPasswordCalls = 0;
      const getWalletPassword = vi.fn(async () => {
        getWalletPasswordCalls += 1;
        if (
          getWalletPasswordCalls === 1 ||
          !overrides.getWalletPasswordAfterReArm
        ) {
          throw new Error("WALLET_PASSWORD_UNAVAILABLE");
        }
        return overrides.getWalletPasswordAfterReArm();
      });
      renderComponent(
        mockedStore({
          qrlStore: {
            setActiveAccount,
            qrlInstance: {
              accounts: {
                seedToAccount: (_seed: string | Uint8Array) => seededAccount,
              },
            },
          },
          lockStore: {
            encryptAccount,
            lock,
            unlock,
            getWalletPassword,
          },
        }),
      );
      return {
        setActiveAccount,
        encryptAccount,
        lock,
        unlock,
        getWalletPassword,
      };
    };

    const submitMnemonic = async () => {
      await userEvent.type(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Import account" }),
      );
    };

    it("should not write the account pointer or the keystore", async () => {
      const { setActiveAccount, encryptAccount } = renderWithExpiredSession();
      await submitMnemonic();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Your unlocked session expired and nothing was saved yet.",
          ),
        ).toBeInTheDocument();
      });
      expect(setActiveAccount).not.toHaveBeenCalled();
      expect(encryptAccount).not.toHaveBeenCalled();
      expect(
        screen.queryByText("Mocked Account Import Success"),
      ).not.toBeInTheDocument();
    });

    it("shows an inline password field to re-enter the session in place (F1)", async () => {
      renderWithExpiredSession();
      await submitMnemonic();

      await screen.findByText(
        "Your unlocked session expired and nothing was saved yet.",
      );
      expect(
        screen.getByRole("button", { name: "Continue" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Enter password")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Unlock wallet" }),
      ).not.toBeInTheDocument();
    });

    it("re-arms the session and completes the import in place, without losing the entered mnemonic", async () => {
      const { setActiveAccount, encryptAccount, unlock } =
        renderWithExpiredSession({
          unlock: vi.fn(async () => true),
          getWalletPasswordAfterReArm: async () => "the-password",
        });
      await submitMnemonic();
      await screen.findByText(
        "Your unlocked session expired and nothing was saved yet.",
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => {
        expect(encryptAccount).toHaveBeenCalledWith(
          seededAccount,
          "the-password",
        );
      });
      expect(unlock).toHaveBeenCalledWith("pw");
      expect(setActiveAccount).toHaveBeenCalledWith(seededAccount.address);
      await waitFor(() => {
        expect(
          screen.getByText("Mocked Account Import Success"),
        ).toBeInTheDocument();
      });
    });

    it("shows the normal wrong-password error when the re-arm password is wrong", async () => {
      renderWithExpiredSession({ unlock: vi.fn(async () => false) });
      await submitMnemonic();
      await screen.findByText(
        "Your unlocked session expired and nothing was saved yet.",
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "wrong");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => {
        expect(
          screen.getByText("The entered password is incorrect"),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByText("Mocked Account Import Success"),
      ).not.toBeInTheDocument();
    });
  });
});
