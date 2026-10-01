import StorageUtil from "@/utilities/storageUtil";
import { providerNetworkIdentity } from "@/utilities/providerNetwork";

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

type BlockchainsStorage = {
  ACTIVE_BLOCKCHAIN?: unknown;
};

const streamsByOrigin = new Map<string, Set<NotificationStream>>();

/**
 * Whether the wallet is locked, mirrored here from LockManager.
 *
 * The value is cached here because this module answers a storage-change
 * listener and every emission has to happen in that same turn. A
 * notification stream carries ordered events, so deferring the write behind
 * an await would put it after whatever the listener does next, and the
 * in-page provider drops an account list that matches the one it already
 * holds.
 * LockManager pushes the value from the one place that can change it, so
 * the flag cannot drift. It starts locked, which is the state a freshly
 * started service worker is in.
 */
let walletLocked = true;

/**
 * Called by LockManager whenever the in-memory key state changes.
 *
 * A transition is an account change from every connected page's point of
 * view, so it is pushed out: locking takes the accounts away, and unlocking
 * hands the granted ones back. Without this, a page loaded while unlocked
 * keeps showing accounts after the wallet locks, and a page loaded while
 * locked never learns about them when the user unlocks.
 */
export const setWalletLockedForDAppNotifications = (isLocked: boolean) => {
  if (walletLocked === isLocked) return;
  walletLocked = isLocked;
  void broadcastLockStateToStreams(isLocked);
};

const writeNotification = (origin: string, notification: unknown) => {
  const streams = streamsByOrigin.get(origin);
  if (!streams) return;
  for (const stream of streams) {
    try {
      stream.write(notification);
    } catch {
      streams.delete(stream);
    }
  }
  if (streams.size === 0) streamsByOrigin.delete(origin);
};

const writeToStreams = (origin: string, accounts: string[]) => {
  writeNotification(origin, {
    jsonrpc: "2.0",
    method: "qrlWallet_accountsChanged",
    params: accounts,
  });
};

/**
 * Tell every connected page what the lock transition did to its accounts.
 * Unlike the storage-change path this runs on its own, so the grant lookup
 * may await. The in-page provider drops a list that matches the one it
 * already holds, so a page whose view did not actually change sees nothing.
 */
const broadcastLockStateToStreams = async (isLocked: boolean) => {
  for (const origin of [...streamsByOrigin.keys()]) {
    let accounts: string[] = [];
    if (!isLocked) {
      try {
        const granted = await StorageUtil.getDAppsConnectedAccountsData(origin);
        accounts = granted?.accounts ?? [];
      } catch {
        // A grant the worker cannot read is treated as no grant.
        accounts = [];
      }
    }
    // The flag may have flipped back while the lookups ran.
    if (walletLocked !== isLocked) return;
    writeToStreams(origin, accounts);
  }
};

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

// MetaMask parity (F8): a locked wallet hides the account list on every
// surface. qrl_accounts and the initial provider state already answer empty
// while locked, so the push notification must match them. An origin whose
// account list did not change still emits nothing.
export const notifyDAppAccountsChanged = (change?: StorageChange): void => {
  if (!change) return;

  const previous = accountsByOrigin(change.oldValue);
  const next = accountsByOrigin(change.newValue);
  const origins = new Set([...previous.keys(), ...next.keys()]);

  for (const origin of origins) {
    const previousAccounts = previous.get(origin) ?? [];
    const nextAccounts = next.get(origin) ?? [];
    if (accountsEqual(previousAccounts, nextAccounts)) continue;

    writeToStreams(origin, walletLocked ? [] : nextAccounts);
  }
};

const activeChainId = (value: unknown): string | undefined => {
  const stored = (value as BlockchainsStorage | undefined)?.ACTIVE_BLOCKCHAIN;
  if (typeof stored !== "string") return undefined;
  const trimmed = stored.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Tell every connected page that the active chain moved.
 *
 * qrlWallet_accountsChanged was the only notification the wallet ever
 * sent, so a page open across a network switch kept the chain id it was
 * given at injection until someone reloaded it. The provider already
 * understands qrlWallet_chainChanged and emits both `chainChanged` and
 * `networkChanged` from it, so this is the whole repair.
 */
export const notifyDAppChainChanged = (change?: StorageChange): void => {
  if (!change) return;

  const previous = activeChainId(change.oldValue);
  const next = activeChainId(change.newValue);
  if (!next) return;
  if (previous && previous.toLowerCase() === next.toLowerCase()) return;

  const identity = providerNetworkIdentity(next);
  if (!identity) return;

  const notification = {
    jsonrpc: "2.0",
    method: "qrlWallet_chainChanged",
    params: identity,
  };
  for (const origin of [...streamsByOrigin.keys()]) {
    writeNotification(origin, notification);
  }
};
