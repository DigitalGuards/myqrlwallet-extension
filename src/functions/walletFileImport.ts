// Decrypt path for MyQRLWallet encrypted wallet files.
//
// Ported from the web wallet (myqrlwallet-frontend/src/utils/crypto/
// walletEncryption.ts). WebCrypto only, no extra crypto dependencies. The file
// is WebCrypto AES-256-GCM with a PBKDF2-SHA256 derived key; the decrypted
// payload is JSON holding the account mnemonic and hex seed. We only need the
// decrypt direction here (import), so encryption is intentionally not ported.

const PBKDF2_ITERATIONS = 600000; // must match the web wallet exporter
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface EncryptedWalletFile {
  address: string;
  encryptedData: string;
  salt: string;
  iv: string;
  version: string;
  timestamp: number;
}

export interface DecryptedWalletData {
  address: string;
  mnemonic: string;
  hexSeed: string;
}

export class WalletFileFormatError extends Error {
  constructor(message = "Invalid wallet file format") {
    super(message);
    this.name = "WalletFileFormatError";
  }
}

export class WalletFileDecryptError extends Error {
  constructor(
    message = "Failed to decrypt wallet. Invalid password or corrupted data.",
  ) {
    super(message);
    this.name = "WalletFileDecryptError";
  }
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (
    typeof hex !== "string" ||
    hex.length % 2 !== 0 ||
    /[^0-9a-fA-F]/.test(hex)
  ) {
    throw new WalletFileFormatError("Invalid hex string in wallet file");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveAesGcmKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

/**
 * Parse and shape-validate raw wallet-file text. Throws WalletFileFormatError
 * when the text is not JSON or is missing the AES-GCM envelope fields that a
 * MyQRLWallet encrypted wallet file carries.
 */
export function parseEncryptedWalletFile(text: string): EncryptedWalletFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WalletFileFormatError();
  }
  if (!parsed || typeof parsed !== "object") {
    throw new WalletFileFormatError();
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.encryptedData !== "string" ||
    typeof candidate.salt !== "string" ||
    typeof candidate.iv !== "string"
  ) {
    throw new WalletFileFormatError();
  }
  return {
    address: typeof candidate.address === "string" ? candidate.address : "",
    encryptedData: candidate.encryptedData,
    salt: candidate.salt,
    iv: candidate.iv,
    version: typeof candidate.version === "string" ? candidate.version : "",
    timestamp:
      typeof candidate.timestamp === "number" ? candidate.timestamp : 0,
  };
}

/**
 * Authenticated-decrypt a MyQRLWallet encrypted wallet file. Throws
 * WalletFileDecryptError on a wrong password or tampered ciphertext (the GCM
 * tag check fails), and WalletFileFormatError when the decrypted payload does
 * not carry a usable seed.
 */
export async function decryptWalletFile(
  encryptedWallet: EncryptedWalletFile,
  password: string,
): Promise<DecryptedWalletData> {
  const salt = hexToBytes(encryptedWallet.salt);
  const iv = hexToBytes(encryptedWallet.iv);

  let json: string;
  try {
    const key = await deriveAesGcmKey(password, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      hexToBytes(encryptedWallet.encryptedData),
    );
    json = textDecoder.decode(plaintext);
  } catch {
    throw new WalletFileDecryptError();
  }

  let payload: { mnemonic?: unknown; hexSeed?: unknown };
  try {
    payload = JSON.parse(json);
  } catch {
    throw new WalletFileDecryptError();
  }

  const hexSeed = typeof payload.hexSeed === "string" ? payload.hexSeed : "";
  const mnemonic = typeof payload.mnemonic === "string" ? payload.mnemonic : "";
  if (!hexSeed && !mnemonic) {
    throw new WalletFileFormatError("Wallet file contained no seed");
  }

  return {
    address: encryptedWallet.address,
    mnemonic,
    hexSeed,
  };
}
