// @vitest-environment node
//
// Node environment (same as keystoreCrypto.test.ts): fixture building calls
// encryptKeystore -> @theqrl/web3-qrl-accounts, whose validator rejects
// jsdom-realm Uint8Arrays. This also means `Worker` is undefined here, so
// decryptBackupKeystore exercises its inline fallback path by default.
// Worker-boundary tests install a worker stub for response validation.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyStore } from "@theqrl/web3";
import { encryptKeystore } from "@/crypto/keystoreCrypto";
import {
  WalletFileDecryptError,
  WalletFileFormatError,
} from "@/functions/walletFileImport";
import {
  decryptBackupKeystore,
  looksLikeKeystoreBackup,
  parseKeystoreBackup,
  parseWalletImportFile,
  WalletBackupEmptyError,
} from "@/functions/walletBackupImport";

// Same 51-byte extended-seed vector as keystoreCrypto.test.ts.
const SEED_HEX =
  "0x010000cea755979937e2dc6137c0e51ba0d1eb2a44920cefffb1a860cf194ea7d23d694045fd2c8a72ec5aecf1e7e5bb591ff2";
const PASSWORD = "correct horse battery staple";
// Fast-but-in-bounds params so tests stay quick while round-tripping the
// real production crypto (recommended write params are m=262144/t=8).
const FAST_KDF = { m: 8192, t: 2, p: 1, dklen: 32 };

async function makeBackupFile(
  count: number,
  password: string,
  kdf: Partial<typeof FAST_KDF> = {},
): Promise<{ text: string; keystores: KeyStore[] }> {
  const keystores: KeyStore[] = [];
  for (let i = 0; i < count; i++) {
    keystores.push(
      await encryptKeystore(SEED_HEX, password, { ...FAST_KDF, ...kdf }),
    );
  }
  const envelope = {
    version: "0.1.1",
    exportedAt: new Date().toISOString(),
    keystores,
    accounts: keystores.map((ks) => ks.address),
    activeChain: { chainId: "0x539", chainName: "QRL Zond Testnet v2" },
  };
  return { text: JSON.stringify(envelope, null, 2), keystores };
}

function mutateFirstKeystore(
  keystores: KeyStore[],
  mutate: (ks: KeyStore) => unknown,
): string {
  return JSON.stringify({
    keystores: keystores.map((ks, index) => (index === 0 ? mutate(ks) : ks)),
  });
}

const V2_FILE = JSON.stringify({
  address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
  encryptedData: "aabbcc",
  salt: "00112233445566778899aabbccddeeff",
  iv: "00112233445566778899aabb",
  version: "v2",
  timestamp: 1,
});

describe("parseWalletImportFile routing", () => {
  it("routes a backup envelope with all keystores validated", async () => {
    const { text, keystores } = await makeBackupFile(2, PASSWORD);
    const parsed = parseWalletImportFile(text);
    expect(parsed.kind).toBe("backup");
    if (parsed.kind === "backup") {
      expect(parsed.keystores).toEqual(keystores);
    }
  });

  it("routes a single bare keystore object as a 1-entry backup", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const parsed = parseWalletImportFile(JSON.stringify(keystores[0]));
    expect(parsed.kind).toBe("backup");
    if (parsed.kind === "backup") {
      expect(parsed.keystores).toHaveLength(1);
    }
  });

  it("routes a v2 wallet file to the v2 branch", () => {
    const parsed = parseWalletImportFile(V2_FILE);
    expect(parsed.kind).toBe("v2");
  });

  it("rejects non-JSON and neither-format JSON", () => {
    expect(() => parseWalletImportFile("not json")).toThrow(
      WalletFileFormatError,
    );
    expect(() => parseWalletImportFile('{"foo": 1}')).toThrow(
      WalletFileFormatError,
    );
  });

  it("rejects an empty keystores array with WalletBackupEmptyError", () => {
    expect(() => parseWalletImportFile('{"keystores": []}')).toThrow(
      WalletBackupEmptyError,
    );
  });
});

describe("parseKeystoreBackup validation", () => {
  it("rejects malformed backup shapes without changing the input", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const [ks] = keystores;
    for (const value of [null, [], "invalid", 1, false]) {
      for (const candidate of [
        value,
        { ...ks, crypto: value },
        { ...ks, crypto: { ...ks.crypto, cipherparams: value } },
        { ...ks, crypto: { ...ks.crypto, kdfparams: value } },
      ]) {
        const backup = { keystores: [ks, candidate, ks] };
        const original = structuredClone(backup);
        expect(() => parseKeystoreBackup(backup)).toThrow(
          WalletFileFormatError,
        );
        expect(backup).toEqual(original);
      }
    }
  });

  it("preserves every valid keystore and its position", async () => {
    const { keystores } = await makeBackupFile(2, PASSWORD);
    const envelope = { keystores };
    const original = structuredClone(envelope);
    expect(parseKeystoreBackup(envelope)).toEqual(keystores);
    expect(envelope).toEqual(original);
  });

  it("rejects unsupported version, cipher, and kdf", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    for (const mutate of [
      (ks: KeyStore) => ({ ...ks, version: 2 }),
      (ks: KeyStore) => ({
        ...ks,
        crypto: { ...ks.crypto, cipher: "aes-128-gcm" },
      }),
      (ks: KeyStore) => ({
        ...ks,
        crypto: { ...ks.crypto, kdf: "pbkdf2" },
      }),
    ]) {
      const mutated = mutateFirstKeystore(keystores, mutate);
      expect(() => parseWalletImportFile(mutated)).toThrow(
        WalletFileFormatError,
      );
    }
  });

  it("rejects out-of-bounds kdfparams at parse time", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    for (const params of [
      { m: 2048 },
      { m: 2097152 },
      { t: 1 },
      { t: 51 },
      { p: 0 },
      { p: 17 },
      { dklen: 8 },
      { m: 8192.5 },
    ]) {
      const mutated = mutateFirstKeystore(keystores, (ks) => ({
        ...ks,
        crypto: {
          ...ks.crypto,
          kdfparams: { ...ks.crypto.kdfparams, ...params },
        },
      }));
      expect(() => parseWalletImportFile(mutated)).toThrow(
        WalletFileFormatError,
      );
    }
  });

  it("rejects a wrong-length IV and non-hex ciphertext", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const badIv = mutateFirstKeystore(keystores, (ks) => ({
      ...ks,
      crypto: {
        ...ks.crypto,
        cipherparams: { iv: "00112233445566778899aabbccdd" },
      },
    }));
    expect(() => parseWalletImportFile(badIv)).toThrow(WalletFileFormatError);
    const badCiphertext = mutateFirstKeystore(keystores, (ks) => ({
      ...ks,
      crypto: { ...ks.crypto, ciphertext: "zz" + "00".repeat(66) },
    }));
    expect(() => parseWalletImportFile(badCiphertext)).toThrow(
      WalletFileFormatError,
    );
  });

  it("rejects a ciphertext that is not exactly seed+tag sized", async () => {
    // 51-byte seed + 16-byte GCM tag = 67 bytes; anything else is a
    // wrong-era or corrupt file and must fail at selection.
    const { keystores } = await makeBackupFile(1, PASSWORD);
    for (const bytes of [66, 68, 80]) {
      const mutated = mutateFirstKeystore(keystores, (ks) => ({
        ...ks,
        crypto: { ...ks.crypto, ciphertext: "00".repeat(bytes) },
      }));
      expect(() => parseWalletImportFile(mutated)).toThrow(
        WalletFileFormatError,
      );
    }
  });

  it("rejects a salt below argon2's 8-byte minimum at parse time", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const mutated = mutateFirstKeystore(keystores, (ks) => ({
      ...ks,
      crypto: {
        ...ks.crypto,
        kdfparams: { ...ks.crypto.kdfparams, salt: "abcd" },
      },
    }));
    expect(() => parseWalletImportFile(mutated)).toThrow(WalletFileFormatError);
  });

  it("defaults missing id/address", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const stripped = mutateFirstKeystore(keystores, (ks) => {
      const { id: _id, address: _address, ...rest } = ks;
      return rest;
    });
    const parsed = parseKeystoreBackup(JSON.parse(stripped));
    expect(parsed[0]?.id).toBeTruthy();
    expect(parsed[0]?.address).toBe("");
  });
});

describe("looksLikeKeystoreBackup", () => {
  it("does not claim v2 files or non-objects", () => {
    expect(looksLikeKeystoreBackup(JSON.parse(V2_FILE))).toBe(false);
    expect(looksLikeKeystoreBackup(null)).toBe(false);
    expect(looksLikeKeystoreBackup("string")).toBe(false);
  });
});

describe("decryptBackupKeystore", () => {
  it("round-trips a keystore encrypted by the extension's own crypto", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    await expect(decryptBackupKeystore(keystores[0], PASSWORD)).resolves.toBe(
      SEED_HEX,
    );
  }, 30000);

  it("honors non-default in-bounds kdf params", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD, {
      m: 4096,
      t: 3,
      p: 2,
    });
    await expect(decryptBackupKeystore(keystores[0], PASSWORD)).resolves.toBe(
      SEED_HEX,
    );
  }, 30000);

  it("rejects in-bounds dklen other than 32 before running the KDF", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const ks = structuredClone(keystores[0]);
    ks.crypto.kdfparams.dklen = 16;
    await expect(decryptBackupKeystore(ks, PASSWORD)).rejects.toThrow(
      WalletFileFormatError,
    );
  });

  it("maps a wrong password to WalletFileDecryptError", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    await expect(
      decryptBackupKeystore(keystores[0], "wrong-password"),
    ).rejects.toThrow(WalletFileDecryptError);
  }, 30000);

  it("maps tampered ciphertext to the SAME error as a wrong password", async () => {
    // Wrong password and tampering must stay indistinguishable (the GCM tag
    // is the sole check); this pins both the class and the message.
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const ks = structuredClone(keystores[0]);
    const flipped =
      (parseInt(ks.crypto.ciphertext.slice(0, 2), 16) ^ 0x01)
        .toString(16)
        .padStart(2, "0") + ks.crypto.ciphertext.slice(2);
    ks.crypto.ciphertext = flipped;
    const tampered = await decryptBackupKeystore(ks, PASSWORD).catch(
      (error: unknown) => error,
    );
    const wrongPw = await decryptBackupKeystore(
      keystores[0],
      "wrong-password",
    ).catch((error: unknown) => error);
    expect(tampered).toBeInstanceOf(WalletFileDecryptError);
    expect(wrongPw).toBeInstanceOf(WalletFileDecryptError);
    if (!(tampered instanceof Error) || !(wrongPw instanceof Error)) {
      throw new Error("Expected both decryptions to fail with an Error");
    }
    expect(tampered.message).toBe(wrongPw.message);
  }, 60000);

  it("decrypts with an NFD-normalized variant of an NFC password", async () => {
    const nfcPassword = "pässwörd-café".normalize("NFC");
    const { keystores } = await makeBackupFile(1, nfcPassword);
    await expect(
      decryptBackupKeystore(keystores[0], nfcPassword.normalize("NFD")),
    ).resolves.toBe(SEED_HEX);
  }, 30000);
});

describe("decryptBackupKeystore worker responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWorker(response: unknown, fail = false) {
    const state = { requests: new Array<unknown>(), terminations: 0 };
    class ImportWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: (() => void) | null = null;

      postMessage(request: unknown) {
        state.requests.push(request);
        queueMicrotask(() => {
          if (fail) {
            this.onerror?.();
          } else {
            this.onmessage?.(
              new MessageEvent<unknown>("message", { data: response }),
            );
          }
        });
      }

      terminate() {
        state.terminations += 1;
      }
    }
    vi.stubGlobal("Worker", ImportWorker);
    return state;
  }

  it("returns the seed, normalizes the password, and terminates the worker", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    const password = "pässwörd-café".normalize("NFD");
    const state = stubWorker({ success: true, hexSeed: SEED_HEX });
    await expect(decryptBackupKeystore(keystores[0], password)).resolves.toBe(
      SEED_HEX,
    );
    expect(state.requests).toEqual([
      { keystore: keystores[0], password: password.normalize("NFC") },
    ]);
    expect(state.terminations).toBe(1);
  });

  it("preserves password and worker failure errors", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    stubWorker({ success: false, wrongPassword: true });
    await expect(decryptBackupKeystore(keystores[0], PASSWORD)).rejects.toThrow(
      WalletFileDecryptError,
    );
    for (const fail of [false, true]) {
      const state = stubWorker({ success: false, wrongPassword: false }, fail);
      await expect(
        decryptBackupKeystore(keystores[0], PASSWORD),
      ).rejects.toThrow(new Error("Keystore decryption failed"));
      expect(state.terminations).toBe(1);
    }
  });

  it("rejects malformed worker replies as decryption failures", async () => {
    const { keystores } = await makeBackupFile(1, PASSWORD);
    for (const response of [
      null,
      undefined,
      [],
      "invalid",
      {},
      { success: "true", hexSeed: SEED_HEX },
      { success: true },
      { success: true, hexSeed: 123 },
      { success: false },
      { success: false, wrongPassword: "false" },
    ]) {
      const state = stubWorker(response);
      await expect(
        decryptBackupKeystore(keystores[0], PASSWORD),
      ).rejects.toThrow(new Error("Keystore decryption failed"));
      expect(state.terminations).toBe(1);
    }
  });
});
