// @vitest-environment node
// The upstream encrypt/decrypt calls require the Node Uint8Array realm.

/**
 * Byte-compatibility suite for the hash-wasm-backed keystore crypto.
 *
 * The whole point of src/crypto/keystoreCrypto.ts is that it is a drop-in
 * replacement for @theqrl/web3-qrl-accounts encrypt()/decrypt(): existing
 * keystores (written via the pure-JS @noble/hashes argon2id) must decrypt,
 * and keystores we write must decrypt with the upstream library. These
 * tests pin that equivalence with small-but-valid KDF parameters so the
 * suite stays fast (the production m=262144 would take seconds per case).
 */

import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  decrypt as upstreamDecrypt,
  encrypt as upstreamEncrypt,
} from "@theqrl/web3-qrl-accounts";
import { argon2id as nobleArgon2id } from "@theqrl/qrl-cryptography/argon2id.js";
import { argon2id as wasmArgon2id } from "hash-wasm";
import {
  decryptKeystore,
  encryptKeystore,
  validateKdfParams,
} from "./keystoreCrypto";

// Extended-seed vector from the @theqrl/web3-qrl-accounts docs.
const SEED_HEX =
  "0x010000cea755979937e2dc6137c0e51ba0d1eb2a44920cefffb1a860cf194ea7d23d694045fd2c8a72ec5aecf1e7e5bb591ff2";
const PASSWORD = "correct horse battery staple";
// Smallest parameters the current wallet.js 6 kdf_policy allows.
const FAST_KDF = { m: 19456, t: 2, p: 1, dklen: 32 };
const LEGACY_READ_KDF = { m: 4096, t: 2, p: 1, dklen: 32 };
const FIXED_SALT =
  "210d0ec956787d865358ac45716e6dd42e68d48e346d795746509523aeb477dd";
const ENVELOPE = {
  version: 1,
  address: `Q${"a".repeat(128)}`,
  crypto: {
    cipher: "aes-256-gcm",
    kdf: "argon2id",
    kdfparams: { ...LEGACY_READ_KDF, salt: FIXED_SALT },
    cipherparams: { iv: "00".repeat(12) },
    ciphertext: "00".repeat(67),
  },
};

const SLOW_TEST_TIMEOUT = 30000;

describe("keystoreCrypto", () => {
  it(
    "round-trips its own keystores",
    async () => {
      const keystore = await encryptKeystore(SEED_HEX, PASSWORD, FAST_KDF);
      expect(keystore.version).toBe(1);
      expect(keystore.crypto.kdf).toBe("argon2id");
      expect(keystore.address).toMatch(/^Q[0-9a-f]{128}$/);

      const preserved = structuredClone(keystore);
      const { address, seed } = await decryptKeystore(keystore, PASSWORD);
      expect(seed).toBe(SEED_HEX);
      expect(address.toLowerCase()).toBe(keystore.address.toLowerCase());
      expect(keystore).toEqual(preserved);
    },
    SLOW_TEST_TIMEOUT,
  );

  it.each([null, undefined, [], "keystore", 42])(
    "rejects a non-object keystore: %j",
    async (keystore) => {
      await expect(decryptKeystore(keystore, PASSWORD)).rejects.toThrow(
        "keystoreCrypto: invalid keystore",
      );
    },
  );

  it.each([
    {
      keystore: { ...ENVELOPE, version: 2 },
      error: "unsupported keystore version",
    },
    {
      keystore: { ...ENVELOPE, crypto: null },
      error: "invalid crypto section",
    },
    { keystore: { ...ENVELOPE, crypto: [] }, error: "invalid crypto section" },
    {
      keystore: {
        ...ENVELOPE,
        crypto: { ...ENVELOPE.crypto, cipher: "aes-128-gcm" },
      },
      error: "unsupported cipher",
    },
    {
      keystore: { ...ENVELOPE, crypto: { ...ENVELOPE.crypto, kdf: "scrypt" } },
      error: "unsupported kdf",
    },
    {
      keystore: {
        ...ENVELOPE,
        crypto: { ...ENVELOPE.crypto, cipherparams: null },
      },
      error: "invalid cipher parameters",
    },
    {
      keystore: {
        ...ENVELOPE,
        crypto: { ...ENVELOPE.crypto, cipherparams: { iv: 42 } },
      },
      error: "invalid cipher parameters",
    },
    {
      keystore: { ...ENVELOPE, crypto: { ...ENVELOPE.crypto, ciphertext: [] } },
      error: "invalid ciphertext",
    },
  ])("rejects malformed envelopes with $error", async ({ keystore, error }) => {
    const preserved = structuredClone(keystore);
    await expect(decryptKeystore(keystore, PASSWORD)).rejects.toThrow(
      `keystoreCrypto: ${error}`,
    );
    expect(keystore).toEqual(preserved);
  });

  it.each([
    null,
    [],
    {},
    { ...ENVELOPE.crypto.kdfparams, m: "4096" },
    { ...ENVELOPE.crypto.kdfparams, t: null },
    { ...ENVELOPE.crypto.kdfparams, p: {} },
    { ...ENVELOPE.crypto.kdfparams, dklen: undefined },
    { ...ENVELOPE.crypto.kdfparams, salt: [] },
  ])("rejects malformed KDF fields: %j", async (kdfparams) => {
    await expect(
      decryptKeystore(
        {
          ...ENVELOPE,
          crypto: { ...ENVELOPE.crypto, kdfparams },
        },
        PASSWORD,
      ),
    ).rejects.toThrow("keystoreCrypto: invalid kdf parameters");
  });

  it.each([
    { ...LEGACY_READ_KDF, m: 1048577 },
    { ...LEGACY_READ_KDF, t: 2.5 },
    { ...LEGACY_READ_KDF, p: Number.POSITIVE_INFINITY },
    { ...LEGACY_READ_KDF, dklen: Number.NaN },
  ])("enforces KDF bounds on incoming keystores: %j", async (kdfparams) => {
    await expect(
      decryptKeystore(
        {
          ...ENVELOPE,
          crypto: {
            ...ENVELOPE.crypto,
            kdfparams: { ...kdfparams, salt: FIXED_SALT },
          },
        },
        PASSWORD,
      ),
    ).rejects.toThrow("outside");
  });

  it("continues to accept byte-array salts", async () => {
    const keystore = await encryptKeystore(SEED_HEX, PASSWORD, {
      ...LEGACY_READ_KDF,
      salt: FIXED_SALT,
    });
    await expect(
      decryptKeystore(
        {
          ...keystore,
          crypto: {
            ...keystore.crypto,
            kdfparams: {
              ...keystore.crypto.kdfparams,
              salt: new Uint8Array(Buffer.from(FIXED_SALT, "hex")),
            },
          },
        },
        PASSWORD,
      ),
    ).resolves.toMatchObject({ seed: SEED_HEX });
  });

  it.each([
    ["Uint8Array", "new Uint8Array(bytes)"],
    [
      "Uint8Array subview",
      "new Uint8Array([255, ...bytes, 255]).subarray(1, bytes.length + 1)",
    ],
    [
      "Uint8Array with a custom tag",
      'Object.defineProperty(new Uint8Array(bytes), Symbol.toStringTag, { value: "SaltBytes" })',
    ],
  ])(
    "accepts a cross-realm %s salt without mutation",
    async (_, expression) => {
      const salt: unknown = runInNewContext(expression, {
        bytes: Array.from(Buffer.from(FIXED_SALT, "hex")),
      });
      expect(salt).not.toBeInstanceOf(Uint8Array);
      expect(ArrayBuffer.isView(salt)).toBe(true);

      const keystore = await encryptKeystore(SEED_HEX, PASSWORD, {
        ...LEGACY_READ_KDF,
        salt: FIXED_SALT,
      });
      const expected = await decryptKeystore(keystore, PASSWORD);
      const input = {
        ...keystore,
        crypto: {
          ...keystore.crypto,
          kdfparams: { ...keystore.crypto.kdfparams, salt },
        },
      };
      const preserved = structuredClone(input);

      await expect(decryptKeystore(input, PASSWORD)).resolves.toEqual(expected);
      await expect(decryptKeystore(input, "wrong password")).rejects.toThrow();
      expect(input.crypto.kdfparams.salt).toBe(salt);
      expect(structuredClone(input)).toEqual(preserved);
    },
  );

  it.each([
    ["DataView", new DataView(new ArrayBuffer(32))],
    ["Uint16Array", new Uint16Array(32)],
    ["Int8Array", new Int8Array(32)],
    ["Uint8ClampedArray", new Uint8ClampedArray(32)],
    [
      "object with a forged tag",
      { [Symbol.toStringTag]: "Uint8Array", length: 32 },
    ],
    [
      "Uint16Array with a forged tag",
      Object.defineProperty(new Uint16Array(32), Symbol.toStringTag, {
        value: "Uint8Array",
      }),
    ],
  ])("rejects a %s salt", async (_, salt) => {
    await expect(
      decryptKeystore(
        {
          ...ENVELOPE,
          crypto: {
            ...ENVELOPE.crypto,
            kdfparams: { ...ENVELOPE.crypto.kdfparams, salt },
          },
        },
        PASSWORD,
      ),
    ).rejects.toThrow("keystoreCrypto: invalid kdf parameters");
  });

  it(
    "decrypts keystores written by the upstream pure-JS implementation",
    async () => {
      const upstreamKeystore = await upstreamEncrypt(SEED_HEX, PASSWORD, {
        salt: FIXED_SALT,
        ...FAST_KDF,
      });

      const { seed } = await decryptKeystore(upstreamKeystore, PASSWORD);
      expect(seed).toBe(SEED_HEX);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "writes keystores the upstream implementation can decrypt",
    async () => {
      const keystore = await encryptKeystore(SEED_HEX, PASSWORD, FAST_KDF);

      const account = await upstreamDecrypt(keystore, PASSWORD);
      expect(account.seed).toBe(SEED_HEX);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "produces a byte-identical crypto envelope for an upstream IV",
    async () => {
      const theirs = await upstreamEncrypt(SEED_HEX, PASSWORD, {
        salt: FIXED_SALT,
        ...FAST_KDF,
      });
      const ours = await encryptKeystore(SEED_HEX, PASSWORD, {
        salt: FIXED_SALT,
        iv: theirs.crypto.cipherparams.iv,
        ...FAST_KDF,
      });

      expect(ours.crypto).toEqual(theirs.crypto);
      expect(ours.address).toBe(theirs.address);
      expect(ours.version).toBe(theirs.version);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "rejects a wrong password via the GCM auth tag",
    async () => {
      const keystore = await encryptKeystore(SEED_HEX, PASSWORD, FAST_KDF);
      await expect(
        decryptKeystore(keystore, "not the password"),
      ).rejects.toThrow();
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "reads a preserved legacy address but rejects a mismatched QIP-55 address",
    async () => {
      const keystore = await encryptKeystore(
        SEED_HEX,
        PASSWORD,
        LEGACY_READ_KDF,
      );
      const legacyKeystore = {
        ...keystore,
        address: `Q${"c".repeat(40)}`,
      };
      const mismatchedKeystore = {
        ...keystore,
        address: `Q${"0".repeat(128)}`,
      };

      await expect(
        decryptKeystore(legacyKeystore, PASSWORD),
      ).resolves.toMatchObject({ seed: SEED_HEX });
      await expect(
        decryptKeystore(mismatchedKeystore, PASSWORD),
      ).rejects.toThrow("stored address does not match seed");
    },
    SLOW_TEST_TIMEOUT,
  );

  it("rejects out-of-bounds kdf parameters", () => {
    expect(() => {
      validateKdfParams({ m: 2048, t: 2, p: 1, dklen: 32 });
    }).toThrow();
    expect(() => {
      validateKdfParams({ m: 4096, t: 1, p: 1, dklen: 32 });
    }).toThrow();
    expect(() => {
      validateKdfParams({ m: 4096, t: 2, p: 0, dklen: 32 });
    }).toThrow();
    expect(() => {
      validateKdfParams({ m: 4096, t: 2, p: 1, dklen: 8 });
    }).toThrow();
    expect(() => {
      validateKdfParams({ m: 4096, t: 2, p: 1, dklen: 32 });
    }).not.toThrow();
  });

  it(
    "hash-wasm and @noble argon2id stay byte-identical (dependency drift guard)",
    async () => {
      const encoder = new TextEncoder();
      const vectors = [
        { password: PASSWORD, salt: FIXED_SALT },
        // Unicode password, NFC-normalised the way every caller does it.
        { password: "pässwörd-café-🔑".normalize("NFC"), salt: FIXED_SALT },
      ];
      for (const vector of vectors) {
        const passwordBytes = encoder.encode(vector.password);
        const saltBytes = new Uint8Array(
          vector.salt.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [],
        );
        const wasm = await wasmArgon2id({
          password: passwordBytes,
          salt: saltBytes,
          iterations: FAST_KDF.t,
          memorySize: FAST_KDF.m,
          parallelism: FAST_KDF.p,
          hashLength: FAST_KDF.dklen,
          outputType: "binary",
        });
        const noble = await nobleArgon2id(
          passwordBytes,
          saltBytes,
          FAST_KDF.t,
          FAST_KDF.m,
          FAST_KDF.p,
          FAST_KDF.dklen,
        );
        expect(Buffer.from(wasm).toString("hex")).toBe(
          Buffer.from(noble).toString("hex"),
        );
      }
    },
    SLOW_TEST_TIMEOUT,
  );
});
