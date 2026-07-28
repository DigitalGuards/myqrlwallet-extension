/**
 * Backup-envelope side of the wallet-file import: parses and decrypts the
 * extension's own Settings > Data backup (qrl-wallet-backup-*.json) so it can
 * be imported back, alongside the web wallet's v2 file which stays handled by
 * walletFileImport.ts (that module is a byte-faithful port of the web app's
 * decrypt path and is deliberately left untouched).
 *
 * Mirrors myqrlwallet-frontend src/utils/crypto/keystoreBackup.ts (PR #256).
 * Behavior parity is the contract: the frontend repo pins a fixture generated
 * and decrypt-verified by THIS extension's keystoreCrypto, and this module
 * reuses that same keystoreCrypto for decryption, so the two importers cannot
 * drift without a test failing on one side.
 */
import type { KeyStore } from "@theqrl/web3";
import { decryptKeystore } from "@/crypto/keystoreCrypto";
import {
  parseEncryptedWalletFile,
  WalletFileDecryptError,
  WalletFileFormatError,
  type EncryptedWalletFile,
} from "@/functions/walletFileImport";
import { runWorkerJob } from "@/scripts/workers/keystoreWorkerPool";
import type {
  KeystoreImportWorkerRequest,
  KeystoreImportWorkerResponse,
} from "@/scripts/workers/keystoreImportWorker";

/** A structurally valid backup whose keystores array is empty. */
export class WalletBackupEmptyError extends WalletFileFormatError {
  constructor() {
    super("The backup file contains no keystores");
    this.name = "WalletBackupEmptyError";
  }
}

export type ParsedWalletImportFile =
  | { kind: "v2"; wallet: EncryptedWalletFile }
  | { kind: "backup"; keystores: KeyStore[] };

// Same bounds keystoreCrypto's validateKdfParams enforces. Checking at parse
// time surfaces a bad file on selection, before any password entry, and keeps
// an attacker-controlled m (an allocation bomb) from ever reaching the KDF.
const KDF_BOUNDS: Record<"m" | "t" | "p" | "dklen", [number, number]> = {
  m: [4096, 1048576],
  t: [2, 50],
  p: [1, 16],
  dklen: [16, 64],
};
const IV_HEX_CHARS = 24; // 12 bytes
// Exactly one 51-byte extended seed + the 16-byte GCM tag. Pinning the
// length here (rather than post-decrypt like the frontend) rejects
// wrong-era files (e.g. future 64-byte QIP-55 seeds) at selection time as a
// format error instead of a confusing failure after a correct password.
const CIPHERTEXT_HEX_CHARS = (51 + 16) * 2;
// argon2 implementations reject salts under 8 bytes; catching it here keeps
// a bad file from burning a KDF attempt and firing the misleading
// WASM-unavailable fallback warning in keystoreCrypto.
const MIN_SALT_HEX_CHARS = 8 * 2;

const isHexString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length % 2 === 0 &&
  !/[^0-9a-fA-F]/.test(value);

const inBounds = (value: unknown, [min, max]: [number, number]): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

function validateKeystore(candidate: unknown, index: number): KeyStore {
  const label = `keystore #${index + 1}`;
  if (!candidate || typeof candidate !== "object") {
    throw new WalletFileFormatError(`Invalid ${label}: not an object`);
  }
  const ks = candidate as Record<string, unknown>;
  if (ks.version !== 1) {
    throw new WalletFileFormatError(`Unsupported ${label} version`);
  }
  const cryptoField = ks.crypto;
  if (!cryptoField || typeof cryptoField !== "object") {
    throw new WalletFileFormatError(`Invalid ${label}: missing crypto section`);
  }
  const c = cryptoField as Record<string, unknown>;
  if (c.cipher !== "aes-256-gcm") {
    throw new WalletFileFormatError(`Unsupported cipher in ${label}`);
  }
  if (c.kdf !== "argon2id") {
    throw new WalletFileFormatError(`Unsupported KDF in ${label}`);
  }
  const cipherparams = c.cipherparams;
  if (!cipherparams || typeof cipherparams !== "object") {
    throw new WalletFileFormatError(`Invalid ${label}: missing cipherparams`);
  }
  const iv = (cipherparams as Record<string, unknown>).iv;
  if (!isHexString(iv) || iv.length !== IV_HEX_CHARS) {
    throw new WalletFileFormatError(`Invalid IV in ${label}`);
  }
  const ciphertext = c.ciphertext;
  if (!isHexString(ciphertext) || ciphertext.length !== CIPHERTEXT_HEX_CHARS) {
    throw new WalletFileFormatError(`Invalid ciphertext in ${label}`);
  }
  const kdfparams = c.kdfparams;
  if (!kdfparams || typeof kdfparams !== "object") {
    throw new WalletFileFormatError(`Invalid ${label}: missing kdfparams`);
  }
  const kp = kdfparams as Record<string, unknown>;
  if (
    !inBounds(kp.m, KDF_BOUNDS.m) ||
    !inBounds(kp.t, KDF_BOUNDS.t) ||
    !inBounds(kp.p, KDF_BOUNDS.p) ||
    !inBounds(kp.dklen, KDF_BOUNDS.dklen)
  ) {
    throw new WalletFileFormatError(
      `KDF parameters in ${label} are outside the accepted bounds`,
    );
  }
  const salt = kp.salt;
  if (!isHexString(salt) || salt.length < MIN_SALT_HEX_CHARS) {
    throw new WalletFileFormatError(`Invalid salt in ${label}`);
  }
  return {
    version: 1,
    id: typeof ks.id === "string" ? ks.id : crypto.randomUUID(),
    address: typeof ks.address === "string" ? ks.address : "",
    crypto: {
      ciphertext,
      cipherparams: { iv },
      cipher: "aes-256-gcm",
      kdf: "argon2id",
      kdfparams: { m: kp.m, t: kp.t, p: kp.p, dklen: kp.dklen, salt },
    },
  };
}

/**
 * Cheap shape test for file-format routing: does this parsed JSON look like a
 * backup envelope (or a single bare keystore) rather than the v2 file?
 */
export function looksLikeKeystoreBackup(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.keystores)) return true;
  return obj.version === 1 && typeof obj.crypto === "object" && obj.crypto !== null;
}

/**
 * Validate a backup envelope (or a single bare keystore object) and return
 * its keystores. Throws WalletFileFormatError / WalletBackupEmptyError.
 */
export function parseKeystoreBackup(parsed: unknown): KeyStore[] {
  if (!parsed || typeof parsed !== "object") {
    throw new WalletFileFormatError();
  }
  const obj = parsed as Record<string, unknown>;
  const rawList = Array.isArray(obj.keystores) ? obj.keystores : [obj];
  if (rawList.length === 0) {
    throw new WalletBackupEmptyError();
  }
  return rawList.map((entry, i) => validateKeystore(entry, i));
}

/**
 * Single entry point for the import component: route a selected file's text
 * to whichever format it is. Backup detection runs first so a hybrid or
 * garbage object cannot be misrouted into the v2 path.
 */
export function parseWalletImportFile(text: string): ParsedWalletImportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WalletFileFormatError();
  }
  if (looksLikeKeystoreBackup(parsed)) {
    return { kind: "backup", keystores: parseKeystoreBackup(parsed) };
  }
  return { kind: "v2", wallet: parseEncryptedWalletFile(text) };
}

/** WebCrypto surfaces a failed GCM auth-tag check as an OperationError. */
const isWrongPasswordError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "OperationError";

/**
 * Decrypt one backup keystore with the unlock password of the wallet that
 * exported it; resolves to the 0x-prefixed hex extended seed. Runs in a
 * dedicated worker (argon2id executes synchronously inside WASM and would
 * freeze the popup ~2s, or tens of seconds on the pure-JS fallback); falls
 * back to inline decryption where Worker does not exist (node unit tests).
 * Wrong password and tampered ciphertext are indistinguishable by design
 * (the GCM tag is the sole check), both surfacing as WalletFileDecryptError.
 */
export async function decryptBackupKeystore(
  keystore: KeyStore,
  password: string,
): Promise<string> {
  // dklen 16..64 passes the parity bounds, but AES-256 needs exactly 32 and
  // every real writer emits 32. Fail up front as a format error instead of
  // burning a multi-second KDF run into a generic key-length error.
  if (keystore.crypto.kdfparams.dklen !== 32) {
    throw new WalletFileFormatError("Unsupported derived-key length");
  }
  // Callers of decryptKeystore normalize, not the crypto itself; match the
  // unlock path (unlockWorker) and the frontend importer.
  const normalised = password.normalize("NFC");

  if (typeof Worker === "undefined") {
    try {
      const { seed } = await decryptKeystore(keystore, normalised);
      return seed;
    } catch (error) {
      if (isWrongPasswordError(error)) {
        throw new WalletFileDecryptError();
      }
      throw error;
    }
  }

  const response = await runWorkerJob<
    KeystoreImportWorkerRequest,
    KeystoreImportWorkerResponse
  >(
    () =>
      new Worker(
        new URL("../scripts/workers/keystoreImportWorker.ts", import.meta.url),
        { type: "module" },
      ),
    { keystore, password: normalised },
    { success: false, wrongPassword: false },
  );
  if (!response.success) {
    if (response.wrongPassword) {
      throw new WalletFileDecryptError();
    }
    throw new Error("Keystore decryption failed");
  }
  return response.hexSeed;
}
