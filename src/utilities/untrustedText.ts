/**
 * Text that arrives from outside the wallet (an explorer row, a token or
 * collection contract) is shown as plain text, but it still needs bounds:
 * control characters and bidirectional overrides can reorder or hide what
 * the user reads, and a multi-kilobyte name can push the real content out
 * of a 360px panel or into storage.
 */

// Control (Cc) and format (Cf) characters: C0 and C1 controls, soft hyphen,
// zero-width and bidirectional marks, the BOM, the tag characters (U+E0000
// range). Plus what looks blank but is a letter or mark: the Hangul fillers
// (U+115F, U+1160, U+3164, U+FFA0), the Mongolian vowel separator (U+180E,
// Cf in current Unicode, a space in older tables) and the variation
// selectors. Each becomes a plain space; runs of whitespace collapse.
const HIDDEN_CHARACTERS =
  /[\p{Cc}\p{Cf}\u115f\u1160\u3164\uffa0\u180e\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;

export const MAX_UNTRUSTED_NAME_LENGTH = 50;
export const MAX_UNTRUSTED_SYMBOL_LENGTH = 20;

/**
 * Strips hidden and control characters, collapses whitespace and cuts the
 * result to `maxLength` code points (an ellipsis marks a cut).
 */
export const cleanUntrustedText = (
  value: string,
  maxLength: number,
): string => {
  const flat = value
    .replace(HIDDEN_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(flat);
  if (points.length <= maxLength) return flat;
  const head = points
    .slice(0, Math.max(0, maxLength - 1))
    .join("")
    .trimEnd();
  return `${head}\u2026`;
};
