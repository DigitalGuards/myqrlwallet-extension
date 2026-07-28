import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { WalletFileDecryptError } from "@/functions/walletFileImport";
import { decryptBackupKeystore } from "@/functions/walletBackupImport";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportEncryptedWallet from "./ImportEncryptedWallet";

// Stub ONLY the KDF-heavy decrypt: parse/detection stays real (pure JS,
// jsdom-safe), while the stub avoids Worker-in-jsdom and the web3-validator
// cross-realm Uint8Array problem.
vi.mock("@/functions/walletBackupImport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/functions/walletBackupImport")>();
  return { ...actual, decryptBackupKeystore: vi.fn() };
});

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

  it("shows the chosen filename instead of the native file control", async () => {
    // The native "Choose File / No file chosen" chrome cannot be themed, so
    // the real input is visually hidden and driven by our own button.
    renderComponent();

    expect(screen.getByText("No file selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Choose file/i }),
    ).toBeInTheDocument();

    const file = new File(["{}"], "my-backup.json", {
      type: "application/json",
    });
    await userEvent.upload(screen.getByLabelText("walletFile"), file);

    expect(screen.getByText("my-backup.json")).toBeInTheDocument();
    expect(screen.queryByText("No file selected")).not.toBeInTheDocument();
  });

  it("opens the file dialog from the themed button", async () => {
    // The filename test drives the hidden input directly, so it would stay
    // green even if the button were wired to nothing. Assert the actual
    // button -> fileInputRef.click() path.
    renderComponent();

    const input = screen.getByLabelText("walletFile");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    await userEvent.click(screen.getByRole("button", { name: /Choose file/i }));

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("keeps the hidden input out of the tab order", () => {
    // sr-only clips instead of hiding, so without this the input is a
    // focusable stop with no visible focus ring.
    renderComponent();

    expect(screen.getByLabelText("walletFile")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});

// Extension backup envelope support (qrl-wallet-backup-*.json).
const SEED_HEX = "0x0105000cf3d735daf68908cc31e7c990";

function makeBackupKeystore(address: string, id: string) {
  return {
    version: 1,
    id,
    address,
    crypto: {
      ciphertext: "00".repeat(67),
      cipherparams: { iv: "00".repeat(12) },
      cipher: "aes-256-gcm",
      kdf: "argon2id",
      kdfparams: { m: 8192, t: 2, p: 1, dklen: 32, salt: "00".repeat(32) },
    },
  };
}

const KEYSTORE_A = makeBackupKeystore(
  "Qcfec0cbee560cbd6ed89580204af71448f1fb8c5",
  "aaaaaaaa-0000-0000-0000-000000000001",
);
const KEYSTORE_B = makeBackupKeystore(
  "Q1111111111222222222233333333334444444444",
  "aaaaaaaa-0000-0000-0000-000000000002",
);

function makeBackupFileText(keystores: unknown[]): string {
  return JSON.stringify({
    version: "0.1.1",
    exportedAt: "2026-07-28T00:00:00.000Z",
    keystores,
    accounts: [],
    activeChain: { chainId: "0x539", chainName: "QRL Zond Testnet v2" },
  });
}

function makeUploadFile(text: string, name = "qrl-wallet-backup.json"): File {
  const file = new File([text], name, { type: "application/json" });
  // jsdom's File.text() does not return the blob content, so shim it with the
  // known text. Real browsers implement File.text() natively.
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

describe("ImportEncryptedWallet backup envelope", () => {
  afterEach(cleanup);

  const renderComponent = (onImported = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            qrlInstance: {
              accounts: {
                seedToAccount: (_seed: string | Uint8Array) => ({
                  address: "Qcfec0cbee560cbd6ed89580204af71448f1fb8c5",
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

  it("shows the account picker and note for a multi-account backup only", async () => {
    renderComponent();
    const file = makeUploadFile(makeBackupFileText([KEYSTORE_A, KEYSTORE_B]));

    await userEvent.upload(screen.getByLabelText("walletFile"), file);

    expect(
      await screen.findByText(
        "This backup contains 2 accounts. Import them one at a time; run the import again for the others.",
      ),
    ).toBeInTheDocument();
    // First account preselected, shown truncated (trigger + Radix's hidden
    // native option both render the text).
    expect(
      screen.getAllByText("Qcfec0cbee...8f1fb8c5").length,
    ).toBeGreaterThan(0);

    cleanup();
    renderComponent();
    const single = makeUploadFile(makeBackupFileText([KEYSTORE_A]));
    await userEvent.upload(screen.getByLabelText("walletFile"), single);
    expect(
      await screen.findByText(
        "Extension backups are encrypted with the unlock password of the wallet that exported them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("walletFileAccount")).not.toBeInTheDocument();
  });

  it("decrypts the selected backup keystore and imports the derived account", async () => {
    vi.mocked(decryptBackupKeystore).mockResolvedValue(SEED_HEX);
    const onImported = renderComponent();
    const file = makeUploadFile(makeBackupFileText([KEYSTORE_A, KEYSTORE_B]));

    await userEvent.upload(screen.getByLabelText("walletFile"), file);
    await userEvent.type(screen.getByLabelText("walletFilePassword"), "hunter22");
    await userEvent.click(screen.getByRole("button", { name: "Import account" }));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    // Default selection is the first keystore; password passed through.
    expect(vi.mocked(decryptBackupKeystore)).toHaveBeenCalledWith(
      expect.objectContaining({ id: KEYSTORE_A.id }),
      "hunter22",
    );
    expect(onImported.mock.calls[0][0]).toMatchObject({ seed: SEED_HEX });
  });

  it("shows the backup-specific message when decryption fails", async () => {
    vi.mocked(decryptBackupKeystore).mockRejectedValue(
      new WalletFileDecryptError(),
    );
    const onImported = renderComponent();
    const file = makeUploadFile(makeBackupFileText([KEYSTORE_A]));

    await userEvent.upload(screen.getByLabelText("walletFile"), file);
    await userEvent.type(screen.getByLabelText("walletFilePassword"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Import account" }));

    expect(
      await screen.findByText(
        "Could not decrypt the backup. Check the unlock password of the wallet that exported it and try again.",
      ),
    ).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("rejects invalid files at selection time and keeps submit disabled", async () => {
    renderComponent();
    const file = makeUploadFile('{"foo": 1}', "garbage.json");

    await userEvent.upload(screen.getByLabelText("walletFile"), file);

    expect(
      await screen.findByText(
        "This is not a valid MyQRLWallet encrypted wallet file",
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("walletFilePassword"), "anything");
    expect(screen.getByRole("button", { name: "Import account" })).toBeDisabled();
  });

  it("reports an empty backup at selection time", async () => {
    renderComponent();
    const file = makeUploadFile(makeBackupFileText([]));

    await userEvent.upload(screen.getByLabelText("walletFile"), file);

    expect(
      await screen.findByText("No accounts were found in the wallet file"),
    ).toBeInTheDocument();
  });
});
