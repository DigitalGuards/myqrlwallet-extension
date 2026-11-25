/**
 * Text that arrives from outside the wallet (an explorer row, a token or
 * collection contract) is shown as plain text, but it still needs bounds:
 * control characters and bidirectional overrides can reorder or hide what
 * the user reads, and a multi-kilobyte name can push the real content out
 * of a 360px panel or into storage.
 */

// C0 and C1 controls, soft hyphen, zero-width and bidirectional formatting
// characters, line and paragraph separators, BOM and the interlinear
// annotation marks. Each becomes a plain space; runs of whitespace collapse.
const HIDDEN_CHARACTERS = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb]",
  "g",
);

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
