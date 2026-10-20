import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import * as ScrollRegion from "@/components/QrlWeb3Wallet/ScrollRegion/ScrollRegion";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transaction, type Web3BaseWalletAccount } from "@theqrl/web3";
import { MemoryRouter } from "react-router-dom";
import ImportAccount from "./ImportAccount";
import ImportMnemonicForm from "./ImportMnemonicForm/ImportMnemonicForm";
import ImportHexSeedForm from "./ImportHexSeedForm/ImportHexSeedForm";
import ImportEncryptedWallet from "./ImportEncryptedWallet/ImportEncryptedWallet";
import * as ZodResolvers from "@hookform/resolvers/zod";

vi.mock("@hookform/resolvers/zod", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hookform/resolvers/zod")>();
  return { ...actual };
});

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess",
  () => ({ default: () => <div>Mocked Account Import Success</div> }),
);

describe("ImportAccount", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ImportAccount />
        </MemoryRouter>
      </StoreProvider>,
    );

  it.each([
    {
      formName: "importAccount",
      Component: ImportMnemonicForm,
      message:
        "There was an error while reading the mnemonic phrases. Error: validation unavailable",
    },
    {
      formName: "importHexSeed",
      Component: ImportHexSeedForm,
      message: "Account could not be imported from the hex seed",
    },
    {
      formName: "importEncryptedWallet",
      Component: ImportEncryptedWallet,
      message: "The account could not be imported from this wallet file",
    },
  ])(
    "reports a rejected form validation for $formName",
    async ({ formName, Component, message }) => {
      const validation = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      const resolver: ReturnType<typeof ZodResolvers.zodResolver> = async (
        values,
      ) => {
        await validation();
        return { values, errors: {} };
      };
      vi.spyOn(ZodResolvers, "zodResolver").mockReturnValue(resolver);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const onImported = vi
        .fn<(account: Web3BaseWalletAccount) => Promise<void>>()
        .mockResolvedValue(undefined);
      render(
        <StoreProvider value={mockedStore()}>
          <Component onImported={onImported} />
        </StoreProvider>,
      );
      await waitFor(() => {
        expect(validation).toHaveBeenCalled();
      });
      validation.mockRejectedValueOnce(new Error("validation unavailable"));

      fireEvent.submit(screen.getByRole("form", { name: formName }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(onImported).not.toHaveBeenCalled();
    },
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
    await waitFor(() => {
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
                  signTransaction: (_tx: Transaction) =>
                    Promise.resolve({
                      messageHash: "",
                      rawTransaction: "",
                      signature: "",
                      transactionHash: "",
                    }),
                  encrypt: () => Promise.reject(new Error("Not implemented")),
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

  describe("re-importing an account the wallet already holds", () => {
    const seededAccount = {
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: "",
      sign: (_data: string | Record<string, unknown>) => ({
        messageHash: "",
        signature: "",
      }),
      signTransaction: (_tx: Transaction) =>
        Promise.resolve({
          messageHash: "",
          rawTransaction: "",
          signature: "",
          transactionHash: "",
        }),
      encrypt: () => Promise.reject(new Error("Not implemented")),
    };

    const renderWithExistingAccount = (storedAddress: string) => {
      const encryptAccount = vi.fn(() => Promise.resolve());
      const setActiveAccount = vi.fn(() => Promise.resolve());
      renderComponent(
        mockedStore({
          qrlStore: {
            setActiveAccount,
            qrlAccounts: {
              isLoading: false,
              accounts: [
                { accountAddress: storedAddress, accountBalance: "0 Quanta" },
              ],
            },
            qrlInstance: {
              accounts: {
                seedToAccount: (_seed: string | Uint8Array) => seededAccount,
              },
            },
          },
          lockStore: { encryptAccount },
        }),
      );
      return { encryptAccount, setActiveAccount };
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

    it("reports the duplicate and leaves the wallet untouched", async () => {
      const { encryptAccount, setActiveAccount } = renderWithExistingAccount(
        seededAccount.address,
      );
      await submitMnemonic();

      await waitFor(() => {
        expect(
          screen.getByText("This account is already in your wallet"),
        ).toBeInTheDocument();
      });
      expect(encryptAccount).not.toHaveBeenCalled();
      expect(setActiveAccount).not.toHaveBeenCalled();
      expect(
        screen.queryByText("Mocked Account Import Success"),
      ).not.toBeInTheDocument();
    });

    it("matches a stored address that differs only in hex casing", async () => {
      const { encryptAccount } = renderWithExistingAccount(
        seededAccount.address.toLowerCase(),
      );
      await submitMnemonic();

      await waitFor(() => {
        expect(
          screen.getByText("This account is already in your wallet"),
        ).toBeInTheDocument();
      });
      expect(encryptAccount).not.toHaveBeenCalled();
    });
  });

  describe("when the unlock session has no password left", () => {
    // Reproduces the second-import bug: after a service-worker restart the
    // decrypted keys self-heal from session storage, so the wallet reads as
    // unlocked and no lock screen is shown, while the memory-only wallet
    // password is gone and ensureWalletPassword rejects.
    const seededAccount = {
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: "",
      sign: (_data: string | Record<string, unknown>) => ({
        messageHash: "",
        signature: "",
      }),
      signTransaction: (_tx: Transaction) =>
        Promise.resolve({
          messageHash: "",
          rawTransaction: "",
          signature: "",
          transactionHash: "",
        }),
      encrypt: () => Promise.reject(new Error("Not implemented")),
    };

    const renderWithExpiredSession = (
      overrides: {
        unlock?: (
          password: string,
        ) => Promise<"success" | "wrong-password" | "failed">;
        ensureWalletPasswordAfterReArm?: () => Promise<void>;
      } = {},
    ) => {
      const setActiveAccount = vi.fn(() => Promise.resolve());
      const encryptAccount = vi.fn(() => Promise.resolve());
      const lock = vi.fn(() => Promise.resolve());
      const unlock =
        overrides.unlock ??
        vi.fn().mockRejectedValue(new Error("unlock not mocked for this test"));
      let ensureWalletPasswordCalls = 0;
      const ensureWalletPassword = vi.fn(async () => {
        ensureWalletPasswordCalls += 1;
        if (
          ensureWalletPasswordCalls === 1 ||
          !overrides.ensureWalletPasswordAfterReArm
        ) {
          throw new Error("WALLET_PASSWORD_UNAVAILABLE");
        }
        return overrides.ensureWalletPasswordAfterReArm();
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
            ensureWalletPassword,
          },
        }),
      );
      return {
        setActiveAccount,
        encryptAccount,
        lock,
        unlock,
        ensureWalletPassword,
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
          unlock: vi.fn().mockResolvedValue("success"),
          ensureWalletPasswordAfterReArm: () => Promise.resolve(),
        });
      await submitMnemonic();
      await screen.findByText(
        "Your unlocked session expired and nothing was saved yet.",
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => {
        // The account alone: the service worker encrypts with the
        // password its unlock session already holds.
        expect(encryptAccount).toHaveBeenCalledWith(seededAccount);
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
      renderWithExpiredSession({
        unlock: vi.fn().mockResolvedValue("wrong-password"),
      });
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

    it("shows an honest 'could not verify' message and keeps the pending import alive on a 'failed' re-arm result (N8)", async () => {
      renderWithExpiredSession({
        unlock: vi.fn().mockResolvedValue("failed"),
      });
      await submitMnemonic();
      await screen.findByText(
        "Your unlocked session expired and nothing was saved yet.",
      );

      await userEvent.type(screen.getByLabelText("Enter password"), "pw");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => {
        expect(
          screen.getByText("Could not verify your password. Please try again."),
        ).toBeInTheDocument();
      });
      // The prompt is still showing (the pending mnemonic/account was not
      // discarded), so the user can just try again without retyping it.
      expect(
        screen.getByRole("button", { name: "Continue" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Mocked Account Import Success"),
      ).not.toBeInTheDocument();
    });
  });

  describe("a non-password-availability encryptAccount failure (N11)", () => {
    const seededAccount = {
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: "",
      sign: (_data: string | Record<string, unknown>) => ({
        messageHash: "",
        signature: "",
      }),
      signTransaction: (_tx: Transaction) =>
        Promise.resolve({
          messageHash: "",
          rawTransaction: "",
          signature: "",
          transactionHash: "",
        }),
      encrypt: () => Promise.reject(new Error("Not implemented")),
    };

    const mnemonic =
      "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage";

    it("retries persistence in order with the same account and store receivers", async () => {
      const steps: string[] = [];
      const ensureWalletPassword = vi.fn<
        StoreType["lockStore"]["ensureWalletPassword"]
      >(() => {
        steps.push("password");
        return Promise.resolve();
      });
      const encryptAccount = vi
        .fn<StoreType["lockStore"]["encryptAccount"]>()
        .mockImplementationOnce(() => {
          steps.push("encrypt");
          return Promise.reject(new Error("storage unavailable"));
        })
        .mockImplementation(() => {
          steps.push("encrypt");
          return Promise.resolve();
        });
      const ensureLabel = vi.fn<StoreType["accountLabelsStore"]["ensureLabel"]>(
        () => {
          steps.push("label");
          return Promise.resolve();
        },
      );
      const setActiveAccount = vi.fn<StoreType["qrlStore"]["setActiveAccount"]>(
        () => {
          steps.push("active");
          return Promise.resolve();
        },
      );
      const seedToAccount = vi.fn(() => seededAccount);
      const store = mockedStore({
        qrlStore: {
          qrlInstance: { accounts: { seedToAccount } },
          setActiveAccount,
        },
        lockStore: { ensureWalletPassword, encryptAccount },
        accountLabelsStore: { ensureLabel },
      });
      renderComponent(store);
      await userEvent.type(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        mnemonic,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Import account" }),
      );

      expect(
        await screen.findByText("storage unavailable"),
      ).toBeInTheDocument();
      expect(steps).toEqual(["password", "encrypt"]);
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(
        await screen.findByText("Mocked Account Import Success"),
      ).toBeInTheDocument();
      expect(steps).toEqual([
        "password",
        "encrypt",
        "password",
        "encrypt",
        "label",
        "active",
      ]);
      expect(seedToAccount).toHaveBeenCalledTimes(1);
      expect(encryptAccount).toHaveBeenNthCalledWith(1, seededAccount);
      expect(encryptAccount).toHaveBeenNthCalledWith(2, seededAccount);
      expect(ensureLabel).toHaveBeenCalledWith(seededAccount.address);
      expect(setActiveAccount).toHaveBeenCalledWith(seededAccount.address);
      expect(ensureWalletPassword.mock.contexts).toEqual([
        store.lockStore,
        store.lockStore,
      ]);
      expect(encryptAccount.mock.contexts).toEqual([
        store.lockStore,
        store.lockStore,
      ]);
      expect(setActiveAccount.mock.contexts).toEqual([store.qrlStore]);
    });

    it("reports an unexpected retry rejection and keeps the pending import", async () => {
      vi.spyOn(ScrollRegion, "scrollShellToTop")
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error("scroll unavailable");
        })
        .mockImplementation(() => {});
      const encryptAccount = vi
        .fn<StoreType["lockStore"]["encryptAccount"]>()
        .mockRejectedValueOnce(new Error("storage unavailable"))
        .mockResolvedValue(undefined);
      const seedToAccount = vi.fn(() => seededAccount);
      renderComponent(
        mockedStore({
          qrlStore: { qrlInstance: { accounts: { seedToAccount } } },
          lockStore: { encryptAccount },
        }),
      );
      await userEvent.type(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        mnemonic,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Import account" }),
      );
      await screen.findByText("storage unavailable");

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("scroll unavailable")).toBeInTheDocument();
      expect(encryptAccount).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(
        await screen.findByText("Mocked Account Import Success"),
      ).toBeInTheDocument();
      expect(encryptAccount).toHaveBeenCalledTimes(2);
      expect(seedToAccount).toHaveBeenCalledTimes(1);
    });

    it("reports mnemonic derivation errors before persistence", async () => {
      const encryptAccount = vi
        .fn<StoreType["lockStore"]["encryptAccount"]>()
        .mockResolvedValue(undefined);
      renderComponent(
        mockedStore({
          qrlStore: {
            qrlInstance: {
              accounts: {
                seedToAccount: () => {
                  throw new Error("invalid mnemonic");
                },
              },
            },
          },
          lockStore: { encryptAccount },
        }),
      );
      await userEvent.type(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        mnemonic,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Import account" }),
      );

      expect(
        await screen.findByText(
          "There was an error while reading the mnemonic phrases. Error: invalid mnemonic",
        ),
      ).toBeInTheDocument();
      expect(encryptAccount).not.toHaveBeenCalled();
    });

    it.each([
      {
        failure: new Error("import unavailable"),
        detail: "Error: import unavailable",
      },
      { failure: "import unavailable", detail: "import unavailable" },
    ])(
      "preserves mnemonic import rejection text: $detail",
      async ({ failure, detail }) => {
        const onImported = vi
          .fn<(account: Web3BaseWalletAccount) => Promise<void>>()
          .mockRejectedValue(failure);
        render(
          <StoreProvider
            value={mockedStore({
              qrlStore: {
                qrlInstance: {
                  accounts: { seedToAccount: () => seededAccount },
                },
              },
            })}
          >
            <ImportMnemonicForm onImported={onImported} />
          </StoreProvider>,
        );
        await userEvent.type(
          screen.getByRole("textbox", { name: "mnemonicPhrases" }),
          mnemonic,
        );
        await userEvent.click(
          screen.getByRole("button", { name: "Import account" }),
        );

        expect(
          await screen.findByText(
            `There was an error while reading the mnemonic phrases. ${detail}`,
          ),
        ).toBeInTheDocument();
        expect(onImported).toHaveBeenCalledWith(seededAccount);
        expect(
          screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        ).toHaveValue(mnemonic);
      },
    );

    it("shows the real error and does not offer a re-arm prompt", async () => {
      const encryptAccount = vi
        .fn()
        .mockRejectedValue(
          new Error("The wallet contains a keystore with an invalid address"),
        );
      renderComponent(
        mockedStore({
          qrlStore: {
            qrlInstance: {
              accounts: {
                seedToAccount: (_seed: string | Uint8Array) => seededAccount,
              },
            },
          },
          lockStore: { encryptAccount },
        }),
      );

      await userEvent.type(
        screen.getByRole("textbox", { name: "mnemonicPhrases" }),
        "knight paddy india glow play chew lame mature sock ill deadly olive blink marble breach hey mile mature tacit mean polo crawl khaya stud number speed viking windy jump subtle mildew sewage",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Import account" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "The wallet contains a keystore with an invalid address",
          ),
        ).toBeInTheDocument();
      });
      // ensureWalletPassword() already succeeded (default mock), so this is
      // not a password-availability problem: no re-arm prompt.
      expect(
        screen.queryByRole("button", { name: "Continue" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Enter password")).not.toBeInTheDocument();
    });
  });
});
