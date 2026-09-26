/**
 * Explorer API bases for explorer-side asset discovery, keyed by chain id.
 * Discovery is a convenience layer on top of the zondscan indexer; chains
 * without an entry (custom chains, mainnet until an indexer exists) simply
 * skip discovery and fall back to manual contract-address import.
 */
const EXPLORER_API_BASES: Record<string, string> = {
  "0x301825": "https://zondscan.com",
};

export const getExplorerApiBase = (chainId: string): string | undefined =>
  EXPLORER_API_BASES[chainId?.toLowerCase()];
