/**
 * Chain identity in the shape the injected provider expects.
 *
 * `chainId` is the 0x-prefixed hex an EIP-1193 provider exposes, and
 * `networkVersion` is the same number in decimal, which is exactly what
 * `net_version` answers. Both are derived from the stored chain, so an
 * unreachable node cannot stop a page from learning which network it is
 * on.
 */
export type ProviderNetworkIdentity = {
  chainId: string;
  networkVersion: string;
};

/**
 * Derives the pair from a stored chain id.
 *
 * Accepts the hex form the wallet stores and a decimal one, because a
 * chain added by a dApp is only as well formed as that dApp made it.
 * Returns undefined for anything that is not a non-negative integer, which
 * leaves the caller free to fall back to the node.
 */
export const providerNetworkIdentity = (
  storedChainId: string | undefined,
): ProviderNetworkIdentity | undefined => {
  const trimmed = storedChainId?.trim();
  if (!trimmed) return undefined;
  let value: bigint;
  try {
    value = BigInt(trimmed);
  } catch {
    return undefined;
  }
  if (value < BigInt(0)) return undefined;
  return {
    chainId: `0x${value.toString(16)}`,
    networkVersion: value.toString(),
  };
};
