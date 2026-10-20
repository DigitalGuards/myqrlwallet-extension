/**
 * Explorer API bases for explorer-side asset discovery, keyed by chain id.
 * Discovery is a convenience layer on top of the zondscan indexer; chains
 * without an entry (custom chains, mainnet until an indexer exists) simply
 * skip discovery and fall back to manual contract-address import.
 */
const EXPLORER_API_BASES = new Map([["0x301825", "https://zondscan.com"]]);

export const getExplorerApiBase = (chainId: unknown): string | undefined =>
  typeof chainId === "string"
    ? EXPLORER_API_BASES.get(chainId.toLowerCase())
    : undefined;
