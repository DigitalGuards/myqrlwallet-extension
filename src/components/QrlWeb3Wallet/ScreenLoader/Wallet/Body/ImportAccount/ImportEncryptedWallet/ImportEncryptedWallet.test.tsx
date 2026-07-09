import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportEncryptedWallet from "./ImportEncryptedWallet";

const PBKDF2_ITERATIONS = 600000;
const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

async function makeEncryptedWalletFile(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      textEncoder.encode(
        JSON.stringify({
          mnemonic: "knight paddy india glow",
          hexSeed: "0x0105000cf3d735daf68908cc31e7c990",
        }),
      ),
    ),
  );
  return JSON.stringify({
    address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
    encryptedData: bytesToHex(ciphertext),
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    version: "v2",
    timestamp: Date.now(),
  });
}

const PASSWORD = "Str0ng!Pass";

describe("ImportEncryptedWallet", () => {
  afterEach(cleanup);

  const renderComponent = (onImported = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            qrlInstance: {
              accounts: {
                seedToAccount: (_seed: string | Uint8Array) => ({
                  address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
                  seed: typeof _seed === "string" ? _seed : "",
                  sign: () => ({ messageHash: "", signature: "" }),
                  signTransaction: async () => ({
                    messageHash: "",
                    rawTransaction: "",
                    signature: "",
                    transactionHash: "",
                  }),
                  encrypt: async () => {
                    throw new Error("Not implemented");
                  },
                }),
              },
            },
          },
        })}
      >
        <MemoryRouter>
          <ImportEncryptedWallet onImported={onImported} />
        </MemoryRouter>
      </StoreProvider>,
    );
    return onImported;
  };

  it("decrypts an uploaded wallet file and imports the account", async () => {
    const onImported = renderComponent();
    const fileText = await makeEncryptedWalletFile(PASSWORD);
    const file = new File([fileText], "encrypted-wallet.json", {
      type: "application/json",
    });
    // jsdom's File.text() does not return the blob content, so shim it with the
    // known text. Real browsers implement File.text() natively.
    Object.defineProperty(file, "text", { value: async () => fileText });

    await userEvent.upload(screen.getByLabelText("walletFile"), file);
    await userEvent.type(
      screen.getByLabelText("walletFilePassword"),
      PASSWORD,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    expect(onImported.mock.calls[0][0]).toMatchObject({
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: "0x0105000cf3d735daf68908cc31e7c990",
    });
  });

  it("shows an error for a wrong password", async () => {
    const onImported = renderComponent();
    const fileText = await makeEncryptedWalletFile(PASSWORD);
    const file = new File([fileText], "encrypted-wallet.json", {
      type: "application/json",
    });
    // jsdom's File.text() does not return the blob content, so shim it with the
    // known text. Real browsers implement File.text() natively.
    Object.defineProperty(file, "text", { value: async () => fileText });

    await userEvent.upload(screen.getByLabelText("walletFile"), file);
    await userEvent.type(
      screen.getByLabelText("walletFilePassword"),
      "wrong-password",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Could not decrypt the wallet file. Check the password and try again.",
        ),
      ).toBeInTheDocument();
    });
    expect(onImported).not.toHaveBeenCalled();
  });
});
