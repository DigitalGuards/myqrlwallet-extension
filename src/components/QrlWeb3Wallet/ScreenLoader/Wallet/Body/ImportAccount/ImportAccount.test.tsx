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

    const renderWithExpiredSession = () => {
      const setActiveAccount = vi.fn(async () => {});
      const encryptAccount = vi.fn(async () => {});
      const lock = vi.fn(async () => {});
      renderComponent(
        mockedStore({
          qrlStore: {
            setActiveAccount,
            qrlInstance: {
              accounts: { seedToAccount: (_seed: string | Uint8Array) => seededAccount },
            },
          },
          lockStore: {
            encryptAccount,
            lock,
            getWalletPassword: async () => {
              throw new Error("WALLET_PASSWORD_UNAVAILABLE");
            },
          },
        }),
      );
      return { setActiveAccount, encryptAccount, lock };
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
            "Your unlocked session expired. Nothing was saved. Unlock the wallet again and retry.",
          ),
        ).toBeInTheDocument();
      });
      expect(setActiveAccount).not.toHaveBeenCalled();
      expect(encryptAccount).not.toHaveBeenCalled();
      expect(
        screen.queryByText("Mocked Account Import Success"),
      ).not.toBeInTheDocument();
    });

    it("should offer a route to the unlock screen and take it", async () => {
      const { lock } = renderWithExpiredSession();
      await submitMnemonic();

      const unlockButton = await screen.findByRole("button", {
        name: "Unlock wallet",
      });
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(lock).toHaveBeenCalledTimes(1);
      });
    });
  });
});
