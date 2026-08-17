export const areAddressesEquivalent = (
  first: unknown,
  second: unknown,
): boolean =>
  typeof first === "string" &&
  first.length > 0 &&
  typeof second === "string" &&
  second.length > 0 &&
  first.toLowerCase() === second.toLowerCase();
