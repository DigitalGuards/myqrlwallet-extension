/**
 * Explorer API bases for explorer-side asset discovery, keyed by chain id.
 * Discovery is a convenience layer on top of the zondscan indexer; chains
 * without an entry (custom chains, mainnet until an indexer exists) simply
 * skip discovery and fall back to manual contract-address import.
 */
const EXPLORER_API_BASES: Record<string, string> = {
  // QRL Zond Testnet v2 (chain id 1337) is indexed by zondscan.com
  "0x539": "https://zondscan.com",
};

export const getExplorerApiBase = (chainId: string): string | undefined =>
  EXPLORER_API_BASES[chainId?.toLowerCase()];
