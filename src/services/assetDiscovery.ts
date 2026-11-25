import {
  EXPLORER_TIMEOUT_MS,
  getExplorerApiBase,
} from "@/configuration/assetDiscoveryConfig";
import type { NFTStandard } from "@/types/nft";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import { toCanonicalTokenId } from "@/utilities/nftTokenId";
import {
  cleanUntrustedText,
  MAX_UNTRUSTED_NAME_LENGTH,
  MAX_UNTRUSTED_SYMBOL_LENGTH,
} from "@/utilities/untrustedText";
import { ExplorerUnavailableError } from "./explorerUnavailableError";
import { isNullishString, isRecord, isUnknownArray } from "./explorerGuards";

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

/**
 * Rows of one explorer response that are read at all. A response past this
 * size is hostile or broken, and every row costs parsing time.
 */
export const MAX_EXPLORER_ROWS = 2000;

const NOT_FOUND = Symbol("explorer-not-found");

// Reads one explorer endpoint with a hard time limit. A 404 means the
// explorer knows nothing for this address and resolves to NOT_FOUND; any
// other failure throws ExplorerUnavailableError.
const fetchExplorerJson = async (url: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS),
    });
  } catch {
    throw new ExplorerUnavailableError();
  }
  if (response.status === 404) return NOT_FOUND;
  if (!response.ok) throw new ExplorerUnavailableError();
  try {
    return await response.json();
  } catch {
    throw new ExplorerUnavailableError();
  }
};

/**
 * Upper bounds on what one explorer response may contribute to a picker.
 * The lists are rendered in a 360px panel and every collection row costs
 * further RPC work, so a spam-flooded (or hostile) index must not be able
 * to grow either without limit. The caps sit far above any real holding.
 */
export const MAX_DISCOVERED_TOKENS = 50;
export const MAX_DISCOVERED_COLLECTIONS = 50;

// One row of the ShorScan /api/address/:addr/tokens response, restricted
// to the fields the extension consumes.
type ExplorerToken = {
  contractAddress: string;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
};

const isExplorerToken = (value: unknown): value is ExplorerToken =>
  isRecord(value) &&
  typeof value.contractAddress === "string" &&
  isNullishString(value.name) &&
  isNullishString(value.symbol) &&
  (value.decimals === undefined ||
    value.decimals === null ||
    (typeof value.decimals === "number" &&
      Number.isInteger(value.decimals) &&
      value.decimals >= 0 &&
      value.decimals <= 255));

// One row of the ShorScan /api/address/:addr/nfts response. The endpoint
// returns per-(contract, tokenID) rows joined with collection-level
// metadata; collection discovery groups rows by contract, while
// discoverOwnedNftTokens consumes the per-token rows directly.
type ExplorerNFT = {
  contractAddress: string;
  tokenID: string;
  tokenStandard: string;
  collectionName?: string | null;
  collectionSymbol?: string | null;
  // ERC-1155 per-id holding as a decimal string; absent for ERC-721.
  balance?: string;
};

const isExplorerNft = (value: unknown): value is ExplorerNFT =>
  isRecord(value) &&
  typeof value.contractAddress === "string" &&
  typeof value.tokenID === "string" &&
  typeof value.tokenStandard === "string" &&
  isNullishString(value.collectionName) &&
  isNullishString(value.collectionSymbol) &&
  (value.balance === undefined || typeof value.balance === "string");

// The explorer may return contract addresses as Q, q, or 0x. Normalize only
// full QIP-55 addresses and discard malformed indexer rows.
const toQAddress = (address: string): string | null => {
  try {
    return toCanonicalQrlAddress(address);
  } catch {
    return null;
  }
};

// The wallet types NFTStandard as "QRC721"/"QRC1155"; the explorer returns
// "ERC-721"/"ERC-1155".
const toNftStandard = (standard: string): NFTStandard | null => {
  if (standard === "ERC-721" || standard === "ERC721") return "QRC721";
  if (standard === "ERC-1155" || standard === "ERC1155") return "QRC1155";
  return null;
};

/**
 * Discovers QRC-20 tokens held by an address via the explorer API.
 * The `standard=ERC-20` filter keeps NFT rows out of the response.
 */
export async function discoverTokens(
  address: string,
  chainId: string,
): Promise<DiscoveredToken[]> {
  const apiBase = getExplorerApiBase(chainId);
  if (!apiBase || !address) return [];

  try {
    const data = await fetchExplorerJson(
      `${apiBase}/api/address/${address}/tokens?standard=ERC-20`,
    );
    if (!isRecord(data) || !isUnknownArray(data.tokens)) return [];

    return data.tokens
      .slice(0, MAX_EXPLORER_ROWS)
      .filter(isExplorerToken)
      .flatMap((token) => {
        const contractAddress = token.contractAddress
          ? toQAddress(token.contractAddress)
          : null;
        if (!contractAddress) return [];
        return [
          {
            address: contractAddress,
            name:
              cleanUntrustedText(token.name ?? "", MAX_UNTRUSTED_NAME_LENGTH) ||
              "Unknown Token",
            symbol:
              cleanUntrustedText(
                token.symbol ?? "",
                MAX_UNTRUSTED_SYMBOL_LENGTH,
              ) || "UNK",
            // Nullish coalescing preserves 0 as a valid decimals value.
            decimals: token.decimals ?? 18,
          },
        ];
      })
      .filter(
        (token, index, all) =>
          all.findIndex((other) => other.address === token.address) === index,
      )
      .slice(0, MAX_DISCOVERED_TOKENS);
  } catch {
    return [];
  }
}

// Fetches and validates the explorer's per-token NFT rows for an address.
// Throws ExplorerUnavailableError when the explorer cannot answer; a
// chain without a configured explorer cannot answer either.
async function loadExplorerNfts(
  address: string,
  chainId: string,
): Promise<ExplorerNFT[]> {
  const apiBase = getExplorerApiBase(chainId);
  if (!apiBase || !address) throw new ExplorerUnavailableError();

  const data = await fetchExplorerJson(
    `${apiBase}/api/address/${address}/nfts`,
  );
  // A 404 is the explorer saying it knows no NFTs for the address.
  if (data === NOT_FOUND) return [];
  if (!isRecord(data) || !isUnknownArray(data.nfts)) {
    throw new ExplorerUnavailableError();
  }
  return data.nfts.slice(0, MAX_EXPLORER_ROWS).filter(isExplorerNft);
}

// Soft variant for the pickers: any failure reads as "nothing to offer".
async function fetchExplorerNfts(
  address: string,
  chainId: string,
): Promise<ExplorerNFT[]> {
  try {
    return await loadExplorerNfts(address, chainId);
  } catch {
    return [];
  }
}

const toTokenId = toCanonicalTokenId;

/**
 * Discovers NFT collections (QRC-721 and QRC-1155) holding at least one
 * token of the address, grouped from the explorer's per-token rows.
 */
export async function discoverNftCollections(
  address: string,
  chainId: string,
): Promise<DiscoveredNFTCollection[]> {
  const rows = await fetchExplorerNfts(address, chainId);

  const collections = new Map<string, DiscoveredNFTCollection>();
  const seenTokens = new Set<string>();
  for (const nft of rows) {
    if (!nft.contractAddress) continue;
    const tokenId = toTokenId(nft.tokenID);
    if (tokenId === null) continue;
    const standard = toNftStandard(nft.tokenStandard);
    if (!standard) continue;

    const contractAddress = toQAddress(nft.contractAddress);
    if (!contractAddress) continue;
    const key = contractAddress.toLowerCase();
    // The explorer can return duplicate (contract, tokenID) rows, also
    // under different spellings of one id; count each token once so the
    // picker's item count matches the gallery.
    const tokenKey = `${key}:${tokenId}`;
    if (seenTokens.has(tokenKey)) continue;
    seenTokens.add(tokenKey);
    const existing = collections.get(key);
    if (!existing && collections.size >= MAX_DISCOVERED_COLLECTIONS) continue;
    if (existing) {
      existing.tokenCount += 1;
      if (!existing.name && nft.collectionName) {
        existing.name = cleanUntrustedText(
          nft.collectionName,
          MAX_UNTRUSTED_NAME_LENGTH,
        );
      }
      if (!existing.symbol && nft.collectionSymbol) {
        existing.symbol = cleanUntrustedText(
          nft.collectionSymbol,
          MAX_UNTRUSTED_SYMBOL_LENGTH,
        );
      }
    } else {
      collections.set(key, {
        address: contractAddress,
        name: cleanUntrustedText(
          nft.collectionName ?? "",
          MAX_UNTRUSTED_NAME_LENGTH,
        ),
        symbol: cleanUntrustedText(
          nft.collectionSymbol ?? "",
          MAX_UNTRUSTED_SYMBOL_LENGTH,
        ),
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

// Upper bound on token ids returned per collection. Every candidate costs
// the caller one on-chain verification call (ownerOf / balanceOf), so an
// unbounded (or hostile) explorer response must not be able to drive an
// unbounded RPC loop.
export const MAX_DISCOVERED_TOKEN_IDS = 50;

/**
 * Discovers the token IDs an address owns inside one collection, capped
 * at MAX_DISCOVERED_TOKEN_IDS. This is the detection fallback for
 * contracts the wallet cannot enumerate on chain: QRC-721 without the
 * Enumerable extension, and all of QRC-1155 (the standard has no owner
 * enumeration at all). Callers MUST re-verify ownership on chain
 * (ownerOf / balanceOf), because the explorer index can lag a recent
 * transfer.
 *
 * Throws ExplorerUnavailableError when the explorer cannot answer (or the
 * chain has none), because "the explorer did not say" must never read as
 * "this account owns nothing here".
 */
export async function discoverOwnedNftTokens(
  address: string,
  chainId: string,
  contractAddress: string,
): Promise<DiscoveredNftToken[]> {
  if (!contractAddress) return [];
  const rows = await loadExplorerNfts(address, chainId);
  const canonicalContractAddress = toQAddress(contractAddress);
  if (!canonicalContractAddress) return [];
  const wanted = canonicalContractAddress.toLowerCase();

  const seen = new Set<string>();
  const out: DiscoveredNftToken[] = [];
  for (const nft of rows) {
    if (out.length >= MAX_DISCOVERED_TOKEN_IDS) break;
    if (!nft.contractAddress) continue;
    const tokenId = toTokenId(nft.tokenID);
    if (tokenId === null) continue;
    const rowContractAddress = toQAddress(nft.contractAddress);
    if (!rowContractAddress || rowContractAddress.toLowerCase() !== wanted) {
      continue;
    }
    const standard = toNftStandard(nft.tokenStandard);
    if (!standard) continue;
    if (seen.has(tokenId)) continue;
    seen.add(tokenId);
    out.push({ tokenId, standard, balance: nft.balance });
  }
  return out;
}
