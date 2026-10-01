import log from "loglevel";

/**
 * Renders one logger argument as something a console can show.
 *
 * An error crossing the postMessage stream arrives as a serialized
 * `{ code, message, stack }` plain object, so a page that wraps console
 * (x.com does) printed it as "[object Object]". The message and the code
 * are what a reader needs.
 */
const formatLogArgument = (value: unknown): unknown => {
  if (value instanceof Error) return value.message;
  if (value === null || typeof value !== "object") return value;
  const candidate = value as { message?: unknown; code?: unknown };
  if (typeof candidate.message !== "string") return value;
  const { code } = candidate;
  return typeof code === "number" || typeof code === "string"
    ? `${candidate.message} (code ${String(code)})`
    : candidate.message;
};

/**
 * Conditions that mean the node is briefly unreachable.
 *
 * Deliberately network wording only. A bare /disconnected/ also matched
 * the provider's "Disconnected from MyQRLWallet. Page reload required.",
 * which is the one line a dApp developer needs to see when it happens.
 */
const TRANSIENT_CONDITIONS = [
  /failed to fetch/i,
  /fetch failed/i,
  /networkerror/i,
  /network error/i,
  /load failed/i,
  /did not answer/i,
  /connection reset/i,
  /err_(internet|network|connection|name)/i,
  /failed to get initial state/i,
];

const isTransientCondition = (args: unknown[]) =>
  args.some((argument) =>
    TRANSIENT_CONDITIONS.some((pattern) => pattern.test(String(argument))),
  );

/**
 * Logger handed to the injected provider.
 *
 * The provider is upstream MetaMask code and its wording assumes a bug
 * where this wallet usually has a node that is briefly unreachable, so it
 * asked every visitor of every website to report one. Those conditions are
 * logged at debug level here, which loglevel keeps quiet by default, and
 * everything that is still logged is formatted so it reads as text.
 */
export const providerLogger: Pick<
  Console,
  "log" | "warn" | "error" | "debug" | "info" | "trace"
> = {
  log: (...args: unknown[]) => {
    log.info(...args.map(formatLogArgument));
  },
  info: (...args: unknown[]) => {
    log.info(...args.map(formatLogArgument));
  },
  debug: (...args: unknown[]) => {
    log.debug(...args.map(formatLogArgument));
  },
  trace: (...args: unknown[]) => {
    log.trace(...args.map(formatLogArgument));
  },
  warn: (...args: unknown[]) => {
    const formatted = args.map(formatLogArgument);
    if (isTransientCondition(formatted)) {
      log.debug(...formatted);
      return;
    }
    log.warn(...formatted);
  },
  error: (...args: unknown[]) => {
    const formatted = args.map(formatLogArgument);
    if (isTransientCondition(formatted)) {
      log.debug(...formatted);
      return;
    }
    log.error(...formatted);
  },
};
