// One spelling per NFT token id. The wallet's identity for a token is the
// decimal form of an integer in the uint256 range. Input is checked as text
// before any conversion: decimal digits (at most 78) or 0x plus at most 64
// hex digits, with no whitespace, sign or other radix prefix.
const DECIMAL_ID = /^\d{1,78}$/;
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

export const toCanonicalTokenId = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  if (!DECIMAL_ID.test(raw) && !HEX_ID.test(raw)) return null;
  const id = BigInt(raw);
  return id < 1n << 256n ? id.toString() : null;
};
