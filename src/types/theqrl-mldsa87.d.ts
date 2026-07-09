/**
 * Minimal ambient declaration for @theqrl/mldsa87 (v0.x/2.0.x ship types at
 * src/index.d.ts but their package.json "exports" map does not point the
 * bundler's resolver at them). Only the members pqSigning uses are declared.
 */
declare module "@theqrl/mldsa87" {
  export const CryptoBytes: number;
  export function cryptoSignSignature(
    sig: Uint8Array,
    m: Uint8Array | string,
    sk: Uint8Array,
    randomizedSigning: boolean,
    ctx: Uint8Array,
  ): number;
  export function cryptoSignVerify(
    sig: Uint8Array,
    m: Uint8Array | string,
    pk: Uint8Array,
    ctx: Uint8Array,
  ): boolean;
}
