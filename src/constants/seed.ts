/**
 * The QRL extended seed is exactly 51 bytes.
 *
 * `parseAndValidateSeed` in @theqrl/web3-qrl-accounts rejects any other
 * length outright (`SeedLengthError`), both on the 0x-prefixed string and on
 * the decoded byte array, so every seed the wallet accepts has to match.
 */
export const EXTENDED_SEED_BYTES = 51;

/** Length of the 0x-prefixed hex form: "0x" plus two characters per byte. */
export const EXTENDED_SEED_HEX_LENGTH = 2 + EXTENDED_SEED_BYTES * 2;
