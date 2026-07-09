import { describe, expect, it } from "vitest";
import {
  decryptWalletFile,
  parseEncryptedWalletFile,
  WalletFileDecryptError,
  WalletFileFormatError,
} from "./walletFileImport";

// Rebuild the exact envelope the web wallet exporter writes
// (WebCrypto AES-256-GCM + PBKDF2-SHA256, 600000 iterations) so the ported
// decrypt path is exercised against a real, matching file.
const PBKDF2_ITERATIONS = 600000;
const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

async function makeEncryptedWalletFile(
  data: { address: string; mnemonic: string; hexSeed: string },
  password: string,
): Promise<string> {
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
        JSON.stringify({ mnemonic: data.mnemonic, hexSeed: data.hexSeed }),
      ),
    ),
  );
  return JSON.stringify({
    address: data.address,
    encryptedData: bytesToHex(ciphertext),
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    version: "v2",
    timestamp: Date.now(),
  });
}

const WALLET = {
  address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
  mnemonic: "knight paddy india glow play chew lame mature sock ill deadly",
  hexSeed: "0x0105000cf3d735daf68908cc31e7c9901234567890abcdef",
};
const PASSWORD = "Str0ng!Pass";

describe("walletFileImport", () => {
  it("decrypts a valid encrypted wallet file", async () => {
    const text = await makeEncryptedWalletFile(WALLET, PASSWORD);
    const parsed = parseEncryptedWalletFile(text);
    const decrypted = await decryptWalletFile(parsed, PASSWORD);
    expect(decrypted).toEqual({
      address: WALLET.address,
      mnemonic: WALLET.mnemonic,
      hexSeed: WALLET.hexSeed,
    });
  });

  it("throws WalletFileDecryptError on a wrong password", async () => {
    const text = await makeEncryptedWalletFile(WALLET, PASSWORD);
    const parsed = parseEncryptedWalletFile(text);
    await expect(decryptWalletFile(parsed, "wrong-password")).rejects.toThrow(
      WalletFileDecryptError,
    );
  });

  it("throws WalletFileFormatError on non-JSON text", () => {
    expect(() => parseEncryptedWalletFile("not json")).toThrow(
      WalletFileFormatError,
    );
  });

  it("throws WalletFileFormatError when envelope fields are missing", () => {
    expect(() =>
      parseEncryptedWalletFile(JSON.stringify({ address: "Q..." })),
    ).toThrow(WalletFileFormatError);
  });
});
