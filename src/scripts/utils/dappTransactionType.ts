/**
 * QRL 2.0 has a single transaction type, 0x2, and the library signs nothing
 * else. A dApp request names that type or leaves the type out.
 */
export const isSupportedTransactionType = (type: unknown): boolean =>
  type === undefined ||
  type === null ||
  type === 2 ||
  (typeof type === "string" && /^0x0*2$/i.test(type));

/**
 * The type as text for the message below. JSON.stringify throws for a
 * bigint and gives no text for a function or a symbol; a request read from
 * storage holds none of these, but naming the type must never be what
 * fails.
 */
const describeType = (type: unknown): string => {
  if (typeof type === "bigint") return `${type.toString()}n`;
  try {
    const text: unknown = JSON.stringify(type);
    return typeof text === "string" ? text : String(type);
  } catch {
    return String(type);
  }
};

/** What a request that names another type is told. */
export const unsupportedTransactionTypeMessage = (type: unknown): string =>
  `QRL transactions are of type 0x2. Received type: ${describeType(type)}`;
