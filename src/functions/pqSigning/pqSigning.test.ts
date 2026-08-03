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
import { toChecksumAddress } from "@theqrl/web3-utils";
import canonical from "./__fixtures__/canonical.json";
import { bytesToHex, concatBytes, hexToBytes } from "./bytes";
import { SCHEME_VERSION_MSG, SCHEME_VERSION_TYPED } from "./ctx";
import { computeMessageDigest } from "./messageDigest";
import { computeTypedDataDigest, type TypedDataPayload } from "./typedData";
import { signMessage, signTypedData } from "./sign";

interface MessageVector {
  label: string;
  messageHex: string;
  digestHex: string;
}

interface TypedVector {
  label: string;
  payload: TypedDataPayload;
  digestHex: string;
}

interface SignMessageVector {
  label: string;
  hexSeed: string;
  messageHex: string;
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
}

interface SignTypedVector {
  label: string;
  hexSeed: string;
  payload: TypedDataPayload;
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
}

function signerFromDescriptorAndPublicKey(
  descriptor: string,
  publicKey: string,
): string {
  const identityHash = shake256(
    concatBytes(hexToBytes(descriptor), hexToBytes(publicKey)),
    { dkLen: 20 },
  );
  return toChecksumAddress(`Q${bytesToHex(identityHash).slice(2)}`);
}

describe("pqSigning parity with canonical fixtures", () => {
  it("pins the scheme versions", () => {
    expect(SCHEME_VERSION_MSG).toBe(canonical.schemeVersionMsg);
    expect(SCHEME_VERSION_TYPED).toBe(canonical.schemeVersionTyped);
  });

  it.each(canonical.messageVectors as MessageVector[])(
    "message digest: $label",
    ({ messageHex, digestHex }) => {
      expect(bytesToHex(computeMessageDigest(hexToBytes(messageHex)))).toBe(
        digestHex,
      );
    },
  );

  it.each(canonical.typedVectors as unknown as TypedVector[])(
    "typed-data digest: $label",
    ({ payload, digestHex }) => {
      expect(bytesToHex(computeTypedDataDigest(payload))).toBe(digestHex);
    },
  );

  it("reproduces the deterministic signMessage vector byte-for-byte", () => {
    const [vector] = canonical.signingVectors as unknown as [
      SignMessageVector,
      SignTypedVector,
    ];
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

  it("reproduces the deterministic signTypedData vector byte-for-byte", () => {
    const [, vector] = canonical.signingVectors as unknown as [
      SignMessageVector,
      SignTypedVector,
    ];
    const result = signTypedData(vector.payload, vector.hexSeed, {
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
    expect(result.schemeVersion).toBe(canonical.schemeVersionTyped);
    expect(result.domain).toEqual(vector.payload.domain);
  });

  it("hedged signing (production default) still verifies structurally", () => {
    const [vector] = canonical.signingVectors as unknown as [
      SignMessageVector,
      SignTypedVector,
    ];
    const a = signMessage(vector.messageHex, vector.hexSeed);
    const b = signMessage(vector.messageHex, vector.hexSeed);
    expect(a.digest).toBe(vector.digest);
    expect(a.publicKey).toBe(vector.publicKey);
    // Hedged: same digest, different signatures across runs.
    expect(a.signature).not.toBe(b.signature);
  });
});
