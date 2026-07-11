// Primary: the wallet backend's IPFS proxy (CID-validated, size-capped).
// Preferred over public gateways like ipfs.io, which time out often enough
// on freshly pinned content that NFTs would appear permanently blank.
// Fallback: the proxy rate-limits 60 req/min/IP and accepts a narrower
// CID/path grammar than public gateways (lowercase base32 CIDv1 only,
// [A-Za-z0-9._-] path segments, no query strings), so ipfs.io remains the
// second attempt for anything the proxy rejects or throttles.
const IPFS_GATEWAY = "https://qrlwallet.com/api/ipfs/";
const PUBLIC_IPFS_GATEWAY = "https://ipfs.io/ipfs/";
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

const resolveViaGateway = (uri: string, gateway: string): string => {
  if (!uri) return "";
  if (uri.startsWith("ipfs://ipfs/")) {
    return `${gateway}${uri.slice("ipfs://ipfs/".length)}`;
  }
  if (uri.startsWith("ipfs://")) {
    return `${gateway}${uri.slice("ipfs://".length)}`;
  }
  if (uri.startsWith("data:")) {
    return uri;
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }
  // Assume bare CID
  return `${gateway}${uri}`;
};

/**
 * Converts IPFS URIs to HTTP gateway URLs (primary gateway).
 * Handles ipfs://, ipfs://ipfs/, and plain CIDs.
 */
export function resolveIpfsUrl(uri: string): string {
  return resolveViaGateway(uri, IPFS_GATEWAY);
}

/**
 * Public-gateway fallback for URIs the primary proxy rejects (grammar) or
 * throttles (429). Returns "" for URIs that never touch a gateway
 * (http(s), data:), so callers can skip a pointless duplicate request.
 */
export function resolveIpfsFallbackUrl(uri: string): string {
  const fallback = resolveViaGateway(uri, PUBLIC_IPFS_GATEWAY);
  return fallback === resolveIpfsUrl(uri) ? "" : fallback;
}

const fetchJson = async (
  url: string,
): Promise<Record<string, unknown> | null> => {
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
};

/**
 * Fetches JSON metadata from a token URI with timeout, trying the primary
 * gateway first and the public fallback second for IPFS-hosted documents.
 */
export async function fetchMetadata(
  tokenUri: string,
): Promise<Record<string, unknown> | null> {
  const url = resolveIpfsUrl(tokenUri);
  if (!url) return null;

  const primary = await fetchJson(url);
  if (primary) return primary;

  const fallbackUrl = resolveIpfsFallbackUrl(tokenUri);
  if (!fallbackUrl) return null;
  return fetchJson(fallbackUrl);
}
