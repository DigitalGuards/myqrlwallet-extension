import { BigNumber } from "bignumber.js";

BigNumber.config({
  DECIMAL_PLACES: 18,
  EXPONENTIAL_AT: 1e9,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
  FORMAT: {
    decimalSeparator: ".",
    groupSeparator: ",",
    groupSize: 3,
  },
});

/**
 * Display rule for a native account balance, shared with the web wallet
 * (myqrlwallet-frontend `src/utils/formatting/balance.ts`). Both surfaces
 * must render the same account at the same width, so keep the two in step.
 *
 * The rule:
 *   1. Thousands are grouped with commas.
 *   2. A balance of 1 or more shows exactly `decimals` (default 2) fraction
 *      digits, padded with zeros: 40500 renders as "40,500.00".
 *   3. A balance below 1 gets up to 6 fraction digits so 0.249 is not
 *      truncated to 0.24, then trailing zeros beyond the 2nd digit are
 *      dropped: 0.240000 renders as "0.24", 0.249000 as "0.249".
 *   4. A non-zero balance that still rounds to zero at 6 digits falls back to
 *      its first 4 significant digits, so dust never reads as "0.00".
 *   5. Truncation is always toward zero, so no balance is ever shown larger
 *      than it is.
 *
 * Token balances keep `getOptimalTokenBalance`, which trims trailing zeros,
 * because token decimals vary.
 */
const toBigNumber = (value: string | number | BigNumber): BigNumber | null => {
  try {
    const bn = value instanceof BigNumber ? value : new BigNumber(value);
    return bn.isNaN() ? null : bn;
  } catch {
    // bignumber.js 4.x throws on unparseable input where 9.x returns NaN.
    return null;
  }
};

export const formatBalance = (
  balance: string | number | BigNumber,
  decimals: number = 2,
  useThousandSeparator: boolean = true,
): string => {
  const bn = toBigNumber(balance);

  if (bn === null) return "0";

  const subUnit = bn.abs().lt(1);
  const effectiveDecimals = subUnit ? Math.max(decimals, 6) : decimals;

  let formatted = bn.toFixed(effectiveDecimals, BigNumber.ROUND_DOWN);

  if (!bn.isZero() && parseFloat(formatted) === 0) {
    // Dust: keep the first four significant digits so it never reads as zero.
    formatted = new BigNumber(
      bn.toPrecision(4, BigNumber.ROUND_DOWN),
    ).toString();
  } else if (effectiveDecimals > decimals) {
    const trimRe = new RegExp(`(\\.\\d{${decimals}}\\d*?)0+$`);
    formatted = formatted.replace(trimRe, "$1");
  }

  if (useThousandSeparator) {
    const parts = formatted.split(".");
    parts[0] = (parts[0] ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    formatted = parts.join(".");
  }

  return formatted;
};

/**
 * Splits a store balance string ("40500.25 Quanta") into the amount rendered
 * by the rule above and its unit, so the unit can sit on its own line.
 */
export const splitFormattedBalance = (
  formattedBalance: string,
): { amount: string; unit: string } => {
  const spaceIndex = formattedBalance.indexOf(" ");
  const rawAmount =
    spaceIndex === -1 ? formattedBalance : formattedBalance.slice(0, spaceIndex);
  const unit = spaceIndex === -1 ? "" : formattedBalance.slice(spaceIndex + 1);
  const numeric = toBigNumber(rawAmount.replace(/,/g, ""));

  return {
    amount: numeric === null ? rawAmount : formatBalance(numeric),
    unit,
  };
};
