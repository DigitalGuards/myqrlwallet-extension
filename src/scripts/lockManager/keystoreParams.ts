import { isRecord } from "@/utilities/storageGuards";

// Recommended Argon2id parameters used when encrypting / re-encrypting
// keystores. Raise these in lockstep with hardware capability; on the next
// successful unlock, every keystore weaker than this set is transparently
// re-encrypted with the user's password.
export const RECOMMENDED_KEYSTORE_KDF_PARAMS = Object.freeze({
  m: 262144,
  t: 8,
  p: 1,
  dklen: 32,
});

export const shouldUpgradeKeystoreParams = (keystore: unknown): boolean => {
  if (!isRecord(keystore)) return false;
  // Real keystores (the KeyStore type, upstream encrypt(), our
  // encryptKeystore()) nest kdf/kdfparams under `crypto`; tolerate a flat
  // shape too so foreign inputs can be evaluated.
  const k = keystore.crypto === undefined ? keystore : keystore.crypto;
  if (!isRecord(k) || (k.kdf !== undefined && typeof k.kdf !== "string")) {
    return false;
  }
  if (k.kdf && k.kdf !== "argon2id") {
    // Anything that is not argon2id (e.g. legacy scrypt) should be upgraded.
    return true;
  }
  const params = k.kdfparams;
  if (!isRecord(params)) return false;
  const target = RECOMMENDED_KEYSTORE_KDF_PARAMS;
  return (
    (typeof params.m === "number" && params.m < target.m) ||
    (typeof params.t === "number" && params.t < target.t) ||
    (typeof params.dklen === "number" && params.dklen < target.dklen)
  );
};
