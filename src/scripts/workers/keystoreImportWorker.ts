/**
 * Web Worker that decrypts ONE backup keystore during wallet-file import.
 *
 * A dedicated worker (rather than reusing unlockWorker) because unlockWorker's
 * response is mnemonic-shaped and it opportunistically re-encrypts weak-param
 * keystores under the supplied password, which is wrong for a foreign backup:
 * the import password belongs to the EXPORTING wallet, not this one. No
 * fan-out either: imports process exactly one keystore per submit.
 *
 * The KDF (argon2id via hash-wasm) executes synchronously inside WASM on the
 * calling thread, so running it here keeps the popup responsive.
 */

import { decryptKeystore } from "@/crypto/keystoreCrypto";
import type { KeyStore } from "@theqrl/web3";

export type KeystoreImportWorkerRequest = {
  keystore: KeyStore;
  /** Already NFC-normalised by the caller. */
  password: string;
};

export type KeystoreImportWorkerResponse =
  | { success: true; hexSeed: string }
  | {
      success: false;
      /**
       * true when the AES-GCM auth tag rejected (wrong password / tampered
       * file); false for infrastructure failures so the caller can surface a
       * distinct error instead of blaming the password.
       */
      wrongPassword: boolean;
    };

/** WebCrypto surfaces a failed GCM auth-tag check as an OperationError. */
const isWrongPasswordError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "OperationError";

self.onmessage = async (event: MessageEvent<KeystoreImportWorkerRequest>) => {
  let response: KeystoreImportWorkerResponse;
  try {
    const { seed } = await decryptKeystore(
      event.data.keystore,
      event.data.password,
    );
    response = { success: true, hexSeed: seed };
  } catch (error) {
    response = { success: false, wrongPassword: isWrongPasswordError(error) };
  }
  self.postMessage(response);
};
