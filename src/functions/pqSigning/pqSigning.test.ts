/**
 * Cross-repo parity tests for the vendored PQ signing module.
 *
 * canonical.json is byte-identical with @qrlwallet/connect
 * (src/signing/__fixtures__) and the qrlwallet.com wallet
 * (src/utils/signing/__fixtures__). If any digest or deterministic
 * signature here drifts, this extension no longer signs what those
 * verifiers verify: fix the code, never the fixtures.
 */

import { describe, expect, it } from "vitest";
import { shake256 } from "@noble/hashes/sha3.js";
import { toChecksumAddress } from "@theqrl/wallet.js";
import canonical from "./__fixtures__/canonical.json";
import { bytesToHex, concatBytes, hexToBytes } from "./bytes";
import {
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
  SCHEME_VERSION_TYPED_V2,
} from "./ctx";
import { computeMessageDigest } from "./messageDigest";
import {
  computeTypedDataDigest,
  encodeType,
  hashStruct,
  typedDataSchemeVersion,
  typeHash,
} from "./typedData";
import { signMessage, signTypedData } from "./sign";

function messageSigningVector() {
  const vector = canonical.signingVectors.find(
    (candidate) => candidate.messageHex !== undefined,
  );
  if (!vector || typeof vector.messageHex !== "string") {
    throw new Error(
      "canonical fixtures are missing the message signing vector",
    );
  }
  return { ...vector, messageHex: vector.messageHex };
}

function signerFromDescriptorAndPublicKey(
  descriptor: string,
  publicKey: string,
): string {
  const identityHash = shake256(
    concatBytes(hexToBytes(descriptor), hexToBytes(publicKey)),
    { dkLen: 64 },
  );
  return toChecksumAddress(`Q${bytesToHex(identityHash).slice(2)}`);
}

describe("pqSigning parity with canonical fixtures", () => {
  it("pins the scheme versions", () => {
    expect(SCHEME_VERSION_MSG).toBe(canonical.schemeVersionMsg);
    expect(SCHEME_VERSION_TYPED).toBe(canonical.schemeVersionTyped);
    expect(SCHEME_VERSION_TYPED_V2).toBe(canonical.schemeVersionTypedV2);
  });

  it.each(canonical.messageVectors)(
    "message digest: $label",
    ({ messageHex, digestHex }) => {
      expect(bytesToHex(computeMessageDigest(hexToBytes(messageHex)))).toBe(
        digestHex,
      );
    },
  );

  it.each(canonical.typedVectors)(
    "rejects the 20-byte legacy address payload: $label",
    ({ payload }) => {
      expect(() => computeTypedDataDigest(payload)).toThrow(/address/i);
    },
  );

  it.each(canonical.schemeVectors)("scheme vector: $label", (v) => {
    const { payload } = v;
    const schemeVersion = typedDataSchemeVersion(payload);
    expect(schemeVersion).toBe(v.schemeVersion);
    expect(encodeType(payload.primaryType, payload.types)).toBe(
      v.encodeTypeString,
    );
    expect(bytesToHex(typeHash(payload.primaryType, payload.types))).toBe(
      v.typeHashHex,
    );
    expect(
      bytesToHex(
        hashStruct("QRLDomain", payload.domain, payload.types, schemeVersion),
      ),
    ).toBe(v.domainHashHex);
    expect(
      bytesToHex(
        hashStruct(
          payload.primaryType,
          payload.message,
          payload.types,
          schemeVersion,
        ),
      ),
    ).toBe(v.messageHashHex);
    expect(bytesToHex(computeTypedDataDigest(payload))).toBe(v.digestHex);
  });

  it("covers both typed-data schemes", () => {
    const schemes = new Set(
      canonical.schemeVectors.map((v) => v.schemeVersion),
    );
    expect(schemes).toEqual(
      new Set([SCHEME_VERSION_TYPED, SCHEME_VERSION_TYPED_V2]),
    );
  });

  it.each(canonical.schemeSigningVectors)(
    "deterministic typed-data signature reproduces byte for byte: $label",
    (v) => {
      const signed = signTypedData(v.payload, v.hexSeed, { randomized: false });
      expect(signed).toEqual({
        signature: v.signature,
        publicKey: v.publicKey,
        signer: v.signer,
        descriptor: v.descriptor,
        digest: v.digest,
        schemeVersion: v.schemeVersion,
        domain: v.payload.domain,
      });
      expect(signerFromDescriptorAndPublicKey(v.descriptor, v.publicKey)).toBe(
        v.signer,
      );
    },
  );

  it("reproduces the deterministic signMessage vector byte-for-byte", () => {
    const vector = messageSigningVector();
    const result = signMessage(vector.messageHex, vector.hexSeed, {
      randomized: false,
    });
    expect(result.digest).toBe(vector.digest);
    expect(result.publicKey).toBe(vector.publicKey);
    expect(result.descriptor).toBe(vector.hexSeed.slice(0, 8));
    expect(result.signer).toBe(vector.signer);
    expect(
      signerFromDescriptorAndPublicKey(result.descriptor, result.publicKey),
    ).toBe(result.signer);
    expect(result.signature).toBe(vector.signature);
    expect(result.schemeVersion).toBe(canonical.schemeVersionMsg);
  });

  it("hedged signing (production default) still verifies structurally", () => {
    const vector = messageSigningVector();
    const a = signMessage(vector.messageHex, vector.hexSeed);
    const b = signMessage(vector.messageHex, vector.hexSeed);
    expect(a.digest).toBe(vector.digest);
    expect(a.publicKey).toBe(vector.publicKey);
    // Hedged: same digest, different signatures across runs.
    expect(a.signature).not.toBe(b.signature);
  });
});
