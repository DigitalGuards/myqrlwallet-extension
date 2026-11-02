import {
  assertMainnetNetwork,
  assertV3Network,
  MAINNET,
  V3_CHAIN_ID,
  V3_TESTNET,
  type NetworkPin,
  type PinnedNetwork,
} from "./releaseProfile";

/**
 * Network resolution for signing and fiat display.
 *
 * Kept apart from releaseProfile so the identity checks it calls are the
 * module exports: a test that stubs assertV3Network stubs it here too.
 * Every helper takes the mainnet pin as a parameter that defaults to the
 * build's own, which lets tests exercise a pinned mainnet that no build
 * ships yet.
 */

export const UNSUPPORTED_NETWORK_MESSAGE = "Select a supported QRL network.";

type ChainIdentity = { chainId?: unknown; defaultRpcUrl?: unknown };

/** The pinned mainnet, or null while it is dormant. */
export const pinnedMainnet = (
  pin: NetworkPin = MAINNET,
): PinnedNetwork | null => (pin.chainId === null ? null : pin);

const normalizeRpcUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}`.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * True for any spelling of the mainnet RPC route. Matching ignores case,
 * trailing slashes and query strings, so a variant still counts as the
 * mainnet route and stays bound to the mainnet pin.
 */
export const isMainnetRpcUrl = (
  url: unknown,
  pin: NetworkPin = MAINNET,
): boolean => {
  if (typeof url !== "string") return false;
  const normalized = normalizeRpcUrl(url);
  return normalized !== null && normalized === normalizeRpcUrl(pin.rpcUrl);
};

/**
 * The pinned network a chain record may sign for, or null.
 *
 * The v3 testnet and a pinned mainnet are the only candidates, matched on
 * chain ID. The mainnet RPC route serves the pinned mainnet alone: a record
 * pointing at it under any other chain ID, or while mainnet is dormant,
 * resolves to null.
 */
export const signingNetworkFor = (
  chain: ChainIdentity,
  pin: NetworkPin = MAINNET,
): PinnedNetwork | null => {
  if (typeof chain.chainId !== "string") return null;
  const chainId = chain.chainId.toLowerCase();
  const mainnet = pinnedMainnet(pin);
  if (isMainnetRpcUrl(chain.defaultRpcUrl, pin)) {
    return mainnet !== null && chainId === mainnet.chainId ? mainnet : null;
  }
  if (chainId === V3_CHAIN_ID) return V3_TESTNET;
  if (mainnet !== null && chainId === mainnet.chainId) return mainnet;
  return null;
};

/**
 * The pinned network a chain record signs for. Throws synchronously, before
 * any request, when the record resolves to none.
 */
export const requireSigningNetwork = (
  chain: ChainIdentity,
  pin: NetworkPin = MAINNET,
): PinnedNetwork => {
  const network = signingNetworkFor(chain, pin);
  if (network === null) throw new Error(UNSUPPORTED_NETWORK_MESSAGE);
  return network;
};

/**
 * Checks that the node behind `rpcUrl` reports `network`'s chain ID and
 * genesis hash. For the v3 testnet this hands back assertV3Network's own
 * promise, so the testnet path makes exactly the calls it always made.
 */
export const assertPinnedIdentity = (
  rpcUrl: string,
  network: PinnedNetwork,
): Promise<void> =>
  network.chainId === V3_CHAIN_ID
    ? assertV3Network(rpcUrl)
    : assertMainnetNetwork(rpcUrl, network);

/**
 * Fiat values belong to the pinned mainnet alone. The v3 testnet, custom
 * chains under any other ID, and every chain while mainnet is dormant get
 * none.
 */
export const isFiatChain = (
  chain: ChainIdentity | null | undefined,
  pin: NetworkPin = MAINNET,
): boolean => {
  if (!chain) return false;
  const mainnet = pinnedMainnet(pin);
  return mainnet !== null && signingNetworkFor(chain, pin) === mainnet;
};
