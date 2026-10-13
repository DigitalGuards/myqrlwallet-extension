// This helper exists only so tests can feed invalid data to typed functions.
export function malformed<T>(value: unknown): T {
  return value as T;
}
