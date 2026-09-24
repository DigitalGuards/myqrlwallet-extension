/**
 * Display formatting for transaction amounts.
 *
 * History entries carry the amount as a decimal string already scaled to
 * display units, so a round value arrives as "40500.000000000000000000" and
 * renders every one of its 18 zeros. The rule mirrors the block explorer's
 * Latest Transactions list (ExplorerFrontend/app/lib/transactionAmount.ts):
 * group the whole part in thousands, keep at most six fraction digits, drop
 * trailing zeros, and collapse anything below the last visible digit to
 * "<0.000001" so a dust transfer never reads as zero.
 *
 * Parsing is string arithmetic throughout. Floating point would round away
 * digits an 18-decimal value depends on, and the exact form is what the list
 * offers on hover and what the detail screen prints.
 */

const COMPACT_FRACTION_DIGITS = 6;
const BELOW_THRESHOLD = `<0.${"0".repeat(COMPACT_FRACTION_DIGITS - 1)}1`;
const MAX_INPUT_LENGTH = 128;
const MAX_EXPONENT = 128;

const DECIMAL_PATTERN =
  /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

export type TransactionAmountDisplay = {
  /** Grouped and trimmed for lists, e.g. "40,500" or "1,234.567891". */
  compact: string;
  /** Every supplied digit with trailing zeros removed, e.g. "40500". */
  exact: string;
};

type DecimalParts = { sign: string; whole: string; fraction: string };

/** Splits a decimal literal into sign, whole and fraction, applying any exponent. */
function parseDecimal(input: string): DecimalParts | null {
  const match = DECIMAL_PATTERN.exec(input);
  if (!match) return null;

  const [, sign, leading, trailing, bare, exponent] = match;
  const whole = leading ?? "0";
  const fraction = (leading === undefined ? bare : trailing) ?? "";
  const shift = exponent === undefined ? 0 : Number(exponent);
  if (!Number.isInteger(shift) || Math.abs(shift) > MAX_EXPONENT) return null;

  const digits = whole + fraction;
  const pointIndex = whole.length + shift;

  let shiftedWhole: string;
  let shiftedFraction: string;
  if (pointIndex <= 0) {
    shiftedWhole = "0";
    shiftedFraction = "0".repeat(-pointIndex) + digits;
  } else if (pointIndex >= digits.length) {
    shiftedWhole = digits + "0".repeat(pointIndex - digits.length);
    shiftedFraction = "";
  } else {
    shiftedWhole = digits.slice(0, pointIndex);
    shiftedFraction = digits.slice(pointIndex);
  }

  return {
    sign: sign === "-" ? "-" : "",
    whole: shiftedWhole.replace(/^0+(?=\d)/, ""),
    fraction: shiftedFraction.replace(/0+$/, ""),
  };
}

/** Inserts thousands separators into a run of digits. */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Returns the compact and exact renderings of an amount, or null when the
 * value cannot be parsed. Callers show "-" for null.
 */
export function formatTransactionAmount(
  amount: string | number | null | undefined,
): TransactionAmountDisplay | null {
  if (amount === null || amount === undefined) return null;
  const input = String(amount).trim();
  if (!input || input.length > MAX_INPUT_LENGTH) return null;

  const parts = parseDecimal(input);
  if (parts === null) return null;

  const { sign, whole, fraction } = parts;
  const isZero = whole === "0" && fraction === "";
  const signPrefix = isZero ? "" : sign;

  const exact = signPrefix + (fraction ? `${whole}.${fraction}` : whole);

  const compactFraction = fraction
    .slice(0, COMPACT_FRACTION_DIGITS)
    .replace(/0+$/, "");
  const roundsToZero = whole === "0" && compactFraction === "";
  const compact =
    !isZero && roundsToZero
      ? signPrefix + BELOW_THRESHOLD
      : signPrefix +
        groupThousands(whole) +
        (compactFraction ? `.${compactFraction}` : "");

  return { compact, exact };
}
