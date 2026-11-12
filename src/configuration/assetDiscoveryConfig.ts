import { pinnedMainnet } from "./pinnedNetworks";
import { V3_CHAIN_ID, V3_EXPLORER } from "./releaseProfile";

/**
 * Explorer API bases for explorer-side asset discovery, keyed by chain id.
 * Discovery is a convenience layer on top of the ShorScan indexer; chains
 * without an entry (custom chains, mainnet until an indexer exists) simply
 * skip discovery and fall back to manual contract-address import. The
 * mainnet entry comes from the mainnet pin, and appears once the pin names
 * an explorer serving the ShorScan API.
 */
const buildExplorerApiBases = (): Map<string, string> => {
  const bases = new Map([[V3_CHAIN_ID, V3_EXPLORER]]);
  const mainnet = pinnedMainnet();
  if (mainnet !== null && mainnet.explorer !== null) {
    bases.set(mainnet.chainId, mainnet.explorer);
  }
  return bases;
};

const EXPLORER_API_BASES = buildExplorerApiBases();

export const getExplorerApiBase = (chainId: unknown): string | undefined =>
  typeof chainId === "string"
    ? EXPLORER_API_BASES.get(chainId.toLowerCase())
    : undefined;
