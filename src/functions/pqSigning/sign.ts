/**
 * ML-DSA-87 signing for the post-quantum dApp methods `qrl_signMessage`
 * and `qrl_signTypedData`.
 *
 * The digest/ctx scheme is the canonical one shared byte-for-byte by
 * @qrlwallet/connect (src/signing/) and the qrlwallet.com wallet
 * (src/utils/signing/); the vendored fixtures in __fixtures__/canonical.json
 * pin parity in pqSigning.test.ts. Caller supplies the 40-byte hex extended
 * seed (already unlocked); this module owns key derivation, hedged signing,
 * and the rich response shape the SDK verifiers expect.
 */

import * as mldsa from "@theqrl/mldsa87";
import { MLDSA87, ExtendedSeed } from "@theqrl/wallet.js";
import { parseAndValidateSeed } from "@theqrl/web3-qrl-accounts";
import { toChecksumAddress } from "@theqrl/web3-utils";
import {
  SCHEME_TAG_MSG,
  SCHEME_TAG_TYPED,
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
} from "./ctx";
import { computeMessageDigest } from "./messageDigest";
import { computeTypedDataDigest, type TypedDataPayload } from "./typedData";
import { bytesToHex, hexToBytes } from "./bytes";

export interface SignWithSchemeParams {
  /** SHAKE256 digest (64 bytes) produced by the per-scheme hasher. */
  digest: Uint8Array;
  /** Per-scheme domain-separation `ctx` (well under FIPS 204's 255-byte cap). */
  ctx: Uint8Array;
  /** 40-byte hex extended seed (`0x...` or bare hex). */
  hexSeed: string;
  /**
   * FIPS 204 §3.4 hedged signing. Default true. Tests force `false` to lock
   * deterministic vectors; production callers should never set this to false.
   */
  randomized?: boolean;
}

export interface SignWithSchemeResult {
  signature: Uint8Array;
  publicKey: Uint8Array;
  signer: string;
}

// ArrayBuffer.isView rather than `instanceof Uint8Array`: the scheme tags
// come from a module-level TextEncoder, which under some bundler/test realms
// is a different Uint8Array constructor than the caller's.
function ensureDigest(digest: Uint8Array): Uint8Array {
  if (!ArrayBuffer.isView(digest) || digest.length !== 64) {
    throw new Error("digest must be a 64-byte Uint8Array");
  }
  return digest;
}

/**
 * Shared signing core: derive the ML-DSA-87 keypair from the hex seed,
 * produce a signature over `digest` with the per-scheme `ctx`, and return
 * everything a stateless verifier needs (signature, public key, signer).
 * The secret key buffer is zeroized on every exit path.
 */
export function signWithScheme({
  digest,
  ctx,
  hexSeed,
  randomized = true,
}: SignWithSchemeParams): SignWithSchemeResult {
  ensureDigest(digest);
  if (!ArrayBuffer.isView(ctx) || ctx.length > 255) {
    throw new Error("ctx must be a Uint8Array under 256 bytes");
  }
  const seedBytes = parseAndValidateSeed(hexSeed);
  const wallet = MLDSA87.newWalletFromExtendedSeed(new ExtendedSeed(seedBytes));
  const sk = wallet.getSK();
  try {
    const sigBuf = new Uint8Array(mldsa.CryptoBytes);
    // Copy every buffer through the local Uint8Array constructor: mldsa87
    // enforces `instanceof Uint8Array`, and ctx (module TextEncoder output)
    // can otherwise be a foreign-realm view under some bundlers.
    mldsa.cryptoSignSignature(
      sigBuf,
      Uint8Array.from(digest),
      Uint8Array.from(sk),
      randomized,
      Uint8Array.from(ctx),
    );
    // The on-chain Q-address is the first 20 bytes of the wallet identity
    // with EIP-55 checksum casing (same derivation as the web wallet).
    const signer = toChecksumAddress(`Q${wallet.getAddressStr().slice(1, 41)}`);
    return {
      signature: sigBuf,
      publicKey: new Uint8Array(wallet.getPK()),
      signer,
    };
  } finally {
    sk.fill(0);
    seedBytes.fill(0);
  }
}

/** Result shape for `qrl_signMessage` (what the SDK's verifyMessage expects). */
export interface SignMessageResult {
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
  schemeVersion: typeof SCHEME_VERSION_MSG;
}

export function signMessage(
  messageHex: string,
  hexSeed: string,
  opts?: { randomized?: boolean },
): SignMessageResult {
  const messageBytes = hexToBytes(messageHex);
  const digest = computeMessageDigest(messageBytes);
  const { signature, publicKey, signer } = signWithScheme({
    digest,
    ctx: SCHEME_TAG_MSG,
    hexSeed,
    randomized: opts?.randomized,
  });
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(publicKey),
    signer,
    digest: bytesToHex(digest),
    schemeVersion: SCHEME_VERSION_MSG,
  };
}

/** Result shape for `qrl_signTypedData` (verifyTypedData expects these). */
export interface SignTypedDataResult {
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
  schemeVersion: typeof SCHEME_VERSION_TYPED;
  domain: TypedDataPayload["domain"];
}

export function signTypedData(
  payload: TypedDataPayload,
  hexSeed: string,
  opts?: { randomized?: boolean },
): SignTypedDataResult {
  const digest = computeTypedDataDigest(payload);
  const { signature, publicKey, signer } = signWithScheme({
    digest,
    ctx: SCHEME_TAG_TYPED,
    hexSeed,
    randomized: opts?.randomized,
  });
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(publicKey),
    signer,
    digest: bytesToHex(digest),
    schemeVersion: SCHEME_VERSION_TYPED,
    domain: payload.domain,
  };
}
