import {
  ADDRESS_SIZE,
  isValidAddress,
  toChecksumAddress,
} from "@theqrl/wallet.js";

export const QRL_ADDRESS_BYTES = ADDRESS_SIZE;
export const QRL_ADDRESS_HEX_LENGTH = QRL_ADDRESS_BYTES * 2;
export const QRL_ADDRESS_LENGTH = QRL_ADDRESS_HEX_LENGTH + 1;
export const LEGACY_QRL_ADDRESS_HEX_LENGTH = 40;
export const QRL_ADDRESS_FINGERPRINT_SEGMENT_LENGTH = 8;
export const LEGACY_QRL_ADDRESS_MIGRATION_ERROR =
  "This wallet contains pre-QIP-55 addresses. Its encrypted seeds were preserved, and an explicit seed-aware migration is required before unlock.";

const QRL_ADDRESS_PATTERN = new RegExp(
  `^Q[0-9a-fA-F]{${QRL_ADDRESS_HEX_LENGTH}}$`,
);
const LEGACY_QRL_ADDRESS_PATTERN = new RegExp(
  `^Q[0-9a-fA-F]{${LEGACY_QRL_ADDRESS_HEX_LENGTH}}$`,
);

/**
 * Accept the canonical QIP-55 address width and wallet.js checksum rules.
 * The public form always carries an uppercase Q prefix. Case-uniform bodies
 * remain valid compatibility forms; mixed-case bodies must have a valid
 * SHAKE256 checksum.
 */
export const isQrlAddress = (value: unknown): value is string =>
  typeof value === "string" &&
  QRL_ADDRESS_PATTERN.test(value) &&
  isValidAddress(value);

/** Require the exact uppercase-Q checksummed representation. */
export const isCanonicalQrlAddress = (value: unknown): value is string =>
  isQrlAddress(value) && toChecksumAddress(value) === value;

/** Identify a pre-QIP-55 address without treating it as usable. */
export const isLegacyQrlAddress = (value: unknown): value is string =>
  typeof value === "string" && LEGACY_QRL_ADDRESS_PATTERN.test(value);

/**
 * Normalize Q, q, or 0x input to the canonical checksummed QIP-55 form.
 */
export const toCanonicalQrlAddress = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("QRL address must be a string");
  }

  const candidate =
    value.startsWith("0x") || value.startsWith("0X")
      ? `Q${value.slice(2)}`
      : value.startsWith("q")
        ? `Q${value.slice(1)}`
        : value;

  if (!isQrlAddress(candidate)) {
    throw new Error(
      `QRL address must be Q followed by ${QRL_ADDRESS_HEX_LENGTH} hexadecimal characters with a valid checksum`,
    );
  }
  return toChecksumAddress(candidate);
};

export const areAddressesEquivalent = (
  first: unknown,
  second: unknown,
): boolean =>
  isQrlAddress(first) &&
  isQrlAddress(second) &&
  first.toLowerCase() === second.toLowerCase();

/**
 * Create the compact address identity used by passive wallet surfaces.
 * The first, middle, and final segments are sampled from the full body so
 * visually similar prefixes and suffixes still expose a middle comparison.
 * Character casing is preserved exactly as supplied. Unsupported widths and
 * invalid current addresses stay complete so abbreviation cannot conceal an
 * invalid value.
 */
export const formatQrlAddressFingerprint = (address: string): string => {
  if (!isQrlAddress(address) && !isLegacyQrlAddress(address)) {
    return address;
  }

  const prefix = address.slice(0, 1);
  const body = address.slice(1);
  const segmentLength = QRL_ADDRESS_FINGERPRINT_SEGMENT_LENGTH;

  if (body.length <= segmentLength * 3) {
    return address;
  }

  const middleStart = Math.floor((body.length - segmentLength) / 2);
  return `${prefix}${body.slice(0, segmentLength)}...${body.slice(
    middleStart,
    middleStart + segmentLength,
  )}...${body.slice(-segmentLength)}`;
};
