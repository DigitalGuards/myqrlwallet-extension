import { describe, expect, it } from "vitest";
import { seedToAccount } from "@theqrl/web3-qrl-accounts";
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
  plaintext = JSON.stringify({
    mnemonic: data.mnemonic,
    hexSeed: data.hexSeed,
  }),
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
      textEncoder.encode(plaintext),
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

  it("rejects malformed envelopes and preserves metadata defaults", () => {
    for (const value of [null, [], false, 1, {}]) {
      expect(() => parseEncryptedWalletFile(JSON.stringify(value))).toThrow(
        WalletFileFormatError,
      );
      for (const field of ["encryptedData", "salt", "iv"]) {
        expect(() =>
          parseEncryptedWalletFile(
            JSON.stringify({
              encryptedData: "aa",
              salt: "bb",
              iv: "cc",
              [field]: value,
            }),
          ),
        ).toThrow(WalletFileFormatError);
      }
    }
    expect(
      parseEncryptedWalletFile('{"encryptedData":"aa","salt":"bb","iv":"cc"}'),
    ).toEqual({
      address: "",
      encryptedData: "aa",
      salt: "bb",
      iv: "cc",
      version: "",
      timestamp: 0,
    });
  });

  it.each([
    { plaintext: "null" },
    { plaintext: "[]" },
    { plaintext: "true" },
    { plaintext: "123" },
    { plaintext: '"text"' },
    { plaintext: '{"hexSeed":12,"mnemonic":false}' },
    { plaintext: "{}" },
  ])(
    "rejects decrypted payload $plaintext with a format error",
    async ({ plaintext }) => {
      const text = await makeEncryptedWalletFile(WALLET, PASSWORD, plaintext);
      await expect(
        decryptWalletFile(parseEncryptedWalletFile(text), PASSWORD),
      ).rejects.toThrow(
        new WalletFileFormatError("Wallet file contained no seed"),
      );
    },
  );

  it("keeps invalid decrypted JSON mapped to WalletFileDecryptError", async () => {
    const text = await makeEncryptedWalletFile(WALLET, PASSWORD, "not JSON");
    await expect(
      decryptWalletFile(parseEncryptedWalletFile(text), PASSWORD),
    ).rejects.toThrow(WalletFileDecryptError);
  });

  it.each([
    {
      payload: { mnemonic: WALLET.mnemonic },
      mnemonic: WALLET.mnemonic,
      hexSeed: "",
    },
    {
      payload: { hexSeed: WALLET.hexSeed },
      mnemonic: "",
      hexSeed: WALLET.hexSeed,
    },
  ])(
    "preserves a payload with one seed field: $payload",
    async ({ payload, mnemonic, hexSeed }) => {
      const text = await makeEncryptedWalletFile(
        WALLET,
        PASSWORD,
        JSON.stringify(payload),
      );
      await expect(
        decryptWalletFile(parseEncryptedWalletFile(text), PASSWORD),
      ).resolves.toEqual({ address: WALLET.address, mnemonic, hexSeed });
    },
  );

  // The web wallet's importer reads the seed with or without 0x, and
  // @theqrl/web3 1.0.3 did too; 2.0.0 parses only a lowercase 0x prefix.
  const EXTENDED_SEED_BODY =
    "0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
  it.each([
    { form: "0x-prefixed", stored: `0x${EXTENDED_SEED_BODY}` },
    { form: "unprefixed", stored: EXTENDED_SEED_BODY },
    { form: "0X-prefixed", stored: `0X${EXTENDED_SEED_BODY}` },
  ])("returns a $form hex seed in the form web3 parses", async ({ stored }) => {
    const text = await makeEncryptedWalletFile(
      WALLET,
      PASSWORD,
      JSON.stringify({ hexSeed: stored }),
    );
    const { hexSeed } = await decryptWalletFile(
      parseEncryptedWalletFile(text),
      PASSWORD,
    );
    expect(hexSeed).toBe(`0x${EXTENDED_SEED_BODY}`);
    expect(seedToAccount(hexSeed).address).toBe(
      seedToAccount(`0x${EXTENDED_SEED_BODY}`).address,
    );
  });
});
