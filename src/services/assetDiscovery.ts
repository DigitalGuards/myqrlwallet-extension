import { getExplorerApiBase } from "@/configuration/assetDiscoveryConfig";
import type { NFTStandard } from "@/types/nft";

/**
 * Explorer-side asset discovery, ported from myqrlwallet-frontend
 * (src/utils/web3/tokenDiscovery.ts + nftDiscovery.ts). The explorer
 * indexes token/NFT balances per address; the wallet asks it what an
 * address owns and offers the result as a review-and-add picker.
 * Nothing lands in storage without an explicit user pick, so a spam
 * token can never inject itself into the wallet UI.
 *
 * All functions resolve to an empty list on any error or on chains
 * without a configured explorer, so a flaky explorer can never break
 * the import screens.
 */

export type DiscoveredToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type DiscoveredNFTCollection = {
  address: string;
  name: string;
  symbol: string;
  standard: NFTStandard;
  tokenCount: number;
};

// One row of the zondscan /api/address/:addr/tokens response, restricted
// to the fields the extension consumes.
type ExplorerToken = {
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
};

type ExplorerTokenResponse = {
  address: string;
  tokens: ExplorerToken[];
  count: number;
};

// One row of the zondscan /api/address/:addr/nfts response. The endpoint
// returns per-(contract, tokenID) rows joined with collection-level
// metadata; collection discovery groups rows by contract, while
// discoverOwnedNftTokens consumes the per-token rows directly.
type ExplorerNFT = {
  contractAddress: string;
  tokenID: string;
  tokenStandard: string;
  collectionName?: string;
  collectionSymbol?: string;
  // ERC-1155 per-id holding as a decimal string; absent for ERC-721.
  balance?: string;
};

type ExplorerNFTResponse = {
  address: string;
  nfts: ExplorerNFT[];
  count: number;
};

// The explorer may return contract addresses as "Q...", "q..." or "0x...";
// the extension stores Q-prefixed addresses on testnet v2.
const toQAddress = (address: string): string => {
  if (address.startsWith("Q")) return address;
  if (address.startsWith("q")) return `Q${address.slice(1)}`;
  return `Q${address.replace(/^0x/i, "")}`;
};

// The extension stores NFTStandard as "ZRC721"/"ZRC1155"; the explorer
// returns "ERC-721"/"ERC-1155".
const toNftStandard = (standard: string): NFTStandard | null => {
  if (standard === "ERC-721" || standard === "ERC721") return "ZRC721";
  if (standard === "ERC-1155" || standard === "ERC1155") return "ZRC1155";
  return null;
};

/**
 * Discovers ZRC-20 tokens held by an address via the explorer API.
 * The `standard=ERC-20` filter keeps NFT rows out of the response.
 */
export async function discoverTokens(
  address: string,
  chainId: string,
): Promise<DiscoveredToken[]> {
  const apiBase = getExplorerApiBase(chainId);
  if (!apiBase || !address) return [];

  try {
    const response = await fetch(
      `${apiBase}/api/address/${address}/tokens?standard=ERC-20`,
    );
    if (!response.ok) {
      // 404 means the explorer knows no tokens for this address
      return [];
    }

    const data = (await response.json()) as ExplorerTokenResponse;
    if (!data || !Array.isArray(data.tokens)) return [];

    return data.tokens
      .filter((token) => !!token.contractAddress)
      .map((token) => ({
        address: toQAddress(token.contractAddress),
        name: token.name || "Unknown Token",
        symbol: token.symbol || "UNK",
        // Nullish coalescing, not ||: 0 is a valid decimals value and
        // must not fall through to 18.
        decimals: token.decimals ?? 18,
      }));
  } catch {
    return [];
  }
}

// Fetches and validates the explorer's per-token NFT rows for an address.
// Returns [] on any error or on chains without a configured explorer.
async function fetchExplorerNfts(
  address: string,
  chainId: string,
): Promise<ExplorerNFT[]> {
  const apiBase = getExplorerApiBase(chainId);
  if (!apiBase || !address) return [];

  try {
    const response = await fetch(`${apiBase}/api/address/${address}/nfts`);
    if (!response.ok) return [];

    const data = (await response.json()) as ExplorerNFTResponse;
    if (!data || !Array.isArray(data.nfts)) return [];
    return data.nfts;
  } catch {
    return [];
  }
}

/**
 * Discovers NFT collections (ZRC-721 and ZRC-1155) holding at least one
 * token of the address, grouped from the explorer's per-token rows.
 */
export async function discoverNftCollections(
  address: string,
  chainId: string,
): Promise<DiscoveredNFTCollection[]> {
  const rows = await fetchExplorerNfts(address, chainId);

  const collections = new Map<string, DiscoveredNFTCollection>();
  for (const nft of rows) {
    if (!nft.contractAddress || !nft.tokenID) continue;
    const standard = toNftStandard(nft.tokenStandard);
    if (!standard) continue;

    const contractAddress = toQAddress(nft.contractAddress);
    const key = contractAddress.toLowerCase();
    const existing = collections.get(key);
    if (existing) {
      existing.tokenCount += 1;
      if (!existing.name && nft.collectionName) {
        existing.name = nft.collectionName;
      }
      if (!existing.symbol && nft.collectionSymbol) {
        existing.symbol = nft.collectionSymbol;
      }
    } else {
      collections.set(key, {
        address: contractAddress,
        name: nft.collectionName ?? "",
        symbol: nft.collectionSymbol ?? "",
        standard,
        tokenCount: 1,
      });
    }
  }

  return [...collections.values()];
}

export type DiscoveredNftToken = {
  tokenId: string;
  standard: NFTStandard;
  // ERC-1155 per-id holding as reported by the explorer (may be stale;
  // callers re-verify on chain before showing it).
  balance?: string;
};

/**
 * Discovers the token IDs an address owns inside one collection. This is
 * the detection fallback for contracts the wallet cannot enumerate on
 * chain: ZRC-721 without the Enumerable extension, and all of ZRC-1155
 * (the standard has no owner enumeration at all). Callers MUST re-verify
 * ownership on chain (ownerOf / balanceOf), because the explorer index
 * can lag a recent transfer.
 */
export async function discoverOwnedNftTokens(
  address: string,
  chainId: string,
  contractAddress: string,
): Promise<DiscoveredNftToken[]> {
  if (!contractAddress) return [];
  const rows = await fetchExplorerNfts(address, chainId);
  const wanted = toQAddress(contractAddress).toLowerCase();

  const seen = new Set<string>();
  const out: DiscoveredNftToken[] = [];
  for (const nft of rows) {
    if (!nft.contractAddress || !nft.tokenID) continue;
    if (toQAddress(nft.contractAddress).toLowerCase() !== wanted) continue;
    const standard = toNftStandard(nft.tokenStandard);
    if (!standard) continue;
    if (seen.has(nft.tokenID)) continue;
    seen.add(nft.tokenID);
    out.push({ tokenId: nft.tokenID, standard, balance: nft.balance });
  }
  return out;
}
