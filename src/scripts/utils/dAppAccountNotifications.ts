type StorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

type NotificationStream = {
  write: (message: unknown) => unknown;
};

type ConnectedDApp = {
  accounts?: unknown;
};

type SenderIdentity = {
  origin?: string;
  url?: string;
};

type DAppsStorage = {
  ALL_DAPPS?: Record<string, ConnectedDApp>;
};

const streamsByOrigin = new Map<string, Set<NotificationStream>>();

const normalizeOrigin = (url: string): string | undefined => {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
};

export const resolveTrustedSenderOrigin = ({
  origin,
  url,
}: SenderIdentity): string | undefined => {
  if (origin !== undefined) return normalizeOrigin(origin);
  return url ? normalizeOrigin(url) : undefined;
};

const accountsByOrigin = (value: unknown): Map<string, string[]> => {
  const allDApps = (value as DAppsStorage | undefined)?.ALL_DAPPS;
  if (!allDApps || typeof allDApps !== "object") return new Map();

  const result = new Map<string, string[]>();
  for (const [origin, data] of Object.entries(allDApps)) {
    const accounts = Array.isArray(data?.accounts)
      ? data.accounts.filter(
          (account): account is string => typeof account === "string",
        )
      : [];
    result.set(origin, accounts);
  }
  return result;
};

const accountsEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((account, index) => account === right[index]);

export const registerDAppAccountNotificationStream = (
  sender: SenderIdentity,
  stream: NotificationStream,
): (() => void) => {
  const origin = resolveTrustedSenderOrigin(sender);
  if (!origin) return () => undefined;

  const streams = streamsByOrigin.get(origin) ?? new Set<NotificationStream>();
  streams.add(stream);
  streamsByOrigin.set(origin, streams);

  return () => {
    const activeStreams = streamsByOrigin.get(origin);
    activeStreams?.delete(stream);
    if (activeStreams?.size === 0) streamsByOrigin.delete(origin);
  };
};

export const notifyDAppAccountsChanged = (change?: StorageChange): void => {
  if (!change) return;

  const previous = accountsByOrigin(change.oldValue);
  const next = accountsByOrigin(change.newValue);
  const origins = new Set([...previous.keys(), ...next.keys()]);

  for (const origin of origins) {
    const previousAccounts = previous.get(origin) ?? [];
    const nextAccounts = next.get(origin) ?? [];
    if (accountsEqual(previousAccounts, nextAccounts)) continue;

    const streams = streamsByOrigin.get(origin);
    if (!streams) continue;
    const notification = {
      jsonrpc: "2.0",
      method: "qrlWallet_accountsChanged",
      params: nextAccounts,
    };
    for (const stream of streams) {
      try {
        stream.write(notification);
      } catch {
        streams.delete(stream);
      }
    }
    if (streams.size === 0) streamsByOrigin.delete(origin);
  }
};
