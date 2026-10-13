import type { KeyStore } from "@theqrl/web3";
import { isRecord } from "@/utilities/storageGuards";
import type { ChangePasswordWorkerResponse } from "./changePasswordWorker";
import type { DecryptedKey, UnlockWorkerResponse } from "./unlockWorker";

function isWorkerKeystore(value: unknown): value is KeyStore {
  if (!isRecord(value) || !isRecord(value.crypto)) return false;
  const crypto = value.crypto;
  if (!isRecord(crypto.cipherparams) || !isRecord(crypto.kdfparams)) {
    return false;
  }
  const params = crypto.kdfparams;
  return (
    value.version === 1 &&
    typeof value.id === "string" &&
    typeof value.address === "string" &&
    crypto.cipher === "aes-256-gcm" &&
    typeof crypto.ciphertext === "string" &&
    typeof crypto.cipherparams.iv === "string" &&
    crypto.kdf === "argon2id" &&
    (typeof params.salt === "string" || params.salt instanceof Uint8Array) &&
    typeof params.m === "number" &&
    typeof params.t === "number" &&
    typeof params.p === "number" &&
    typeof params.dklen === "number"
  );
}

function isDecryptedKey(value: unknown): value is DecryptedKey {
  return (
    isRecord(value) &&
    typeof value.address === "string" &&
    typeof value.mnemonicPhrases === "string"
  );
}

function hasMatchingAddress(
  value: { address: string },
  expected: KeyStore | undefined,
): boolean {
  return (
    expected !== undefined &&
    value.address.toLowerCase() === expected.address.toLowerCase()
  );
}

// Every successful response must account for the complete chunk in its
// original order before callers can persist replacement keystores or keys.
export function isUnlockWorkerResponse(
  value: unknown,
  keystores: readonly KeyStore[],
): value is UnlockWorkerResponse {
  if (!isRecord(value)) return false;
  if (value.success === false) return typeof value.wrongPassword === "boolean";
  if (
    value.success !== true ||
    !Array.isArray(value.keys) ||
    !Array.isArray(value.upgraded)
  ) {
    return false;
  }
  return (
    value.keys.length === keystores.length &&
    value.upgraded.length === keystores.length &&
    Array.from<unknown>(value.keys).every(
      (key, index) =>
        isDecryptedKey(key) && hasMatchingAddress(key, keystores[index]),
    ) &&
    Array.from<unknown>(value.upgraded).every(
      (key, index) =>
        key === null ||
        (isWorkerKeystore(key) && hasMatchingAddress(key, keystores[index])),
    )
  );
}

export function isChangePasswordWorkerResponse(
  value: unknown,
  keystores: readonly KeyStore[],
): value is ChangePasswordWorkerResponse {
  if (!isRecord(value)) return false;
  if (value.success === false) return typeof value.wrongPassword === "boolean";
  if (
    value.success !== true ||
    !Array.isArray(value.newKeys) ||
    !Array.isArray(value.newKeystores)
  ) {
    return false;
  }
  return (
    value.newKeys.length === keystores.length &&
    value.newKeystores.length === keystores.length &&
    Array.from<unknown>(value.newKeys).every(
      (key, index) =>
        isDecryptedKey(key) && hasMatchingAddress(key, keystores[index]),
    ) &&
    Array.from<unknown>(value.newKeystores).every(
      (key, index) =>
        isWorkerKeystore(key) && hasMatchingAddress(key, keystores[index]),
    )
  );
}
