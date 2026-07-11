// The wallet backend's IPFS proxy (CID-validated, size-capped, CF-cached).
// Preferred over public gateways like ipfs.io, which time out often enough
// on freshly pinned content that NFTs would appear permanently blank.
const IPFS_GATEWAY = "https://qrlwallet.com/api/ipfs/";
const METADATA_TIMEOUT_MS = 10000;

/**
 * ERC-1155 metadata URI templating: "clients MUST replace any occurrences
 * of the substring `{id}` with the actual token ID, in lowercase
 * hexadecimal (with no 0x prefix) and leading-zero-padded to 64 hex
 * characters". No-op for URIs without the placeholder; returns the URI
 * unchanged when the tokenId is not a valid integer.
 */
export function substituteErc1155TokenId(
  uri: string,
  tokenId: string,
): string {
  if (!uri || !uri.includes("{id}")) return uri;
  let hex: string;
  try {
    hex = BigInt(tokenId).toString(16);
  } catch {
    return uri;
  }
  if (hex.length > 64) hex = hex.slice(-64);
  // split/join instead of replaceAll: the tsconfig lib target predates
  // es2021, and a regex replace would need escaping for the braces.
  return uri.split("{id}").join(hex.padStart(64, "0"));
}

/**
 * Converts IPFS URIs to HTTP gateway URLs.
 * Handles ipfs://, ipfs://ipfs/, and plain CIDs.
 */
export function resolveIpfsUrl(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://ipfs/")) {
    return `${IPFS_GATEWAY}${uri.slice("ipfs://ipfs/".length)}`;
  }
  if (uri.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${uri.slice("ipfs://".length)}`;
  }
  if (uri.startsWith("data:")) {
    return uri;
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }
  // Assume bare CID
  return `${IPFS_GATEWAY}${uri}`;
}

/**
 * Fetches JSON metadata from a token URI with timeout.
 */
export async function fetchMetadata(
  tokenUri: string,
): Promise<Record<string, unknown> | null> {
  const url = resolveIpfsUrl(tokenUri);
  if (!url) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      METADATA_TIMEOUT_MS,
    );
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
