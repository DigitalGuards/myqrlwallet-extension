import { BigNumber } from "bignumber.js";

/** Preserve the entered decimal amount until conversion to integer base units. */
export function toTokenBaseUnits(
  value: string | number,
  decimals: number,
): bigint {
  const text = String(value);
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !/^(?:\d+\.?\d*|\.\d+)$/.test(text)
  ) {
    throw new Error("Enter a valid decimal amount");
  }
  const scaled = new BigNumber(text).times(new BigNumber(10).pow(decimals));
  if (!scaled.isFinite() || !scaled.isInteger()) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places`);
  }
  return BigInt(scaled.toFixed(0));
}
