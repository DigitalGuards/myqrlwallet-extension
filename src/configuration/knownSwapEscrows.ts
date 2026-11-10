import { areAddressesEquivalent } from "@/utilities/addressUtil";

/**
 * Swap escrow contracts the wallet recognises, keyed by chain id (hex).
 * The approval screen explains an escrow call in plain language only when
 * the request goes to an address listed here. Function names such as
 * `refund` or `withdraw` are generic, so any contract can imitate them; the
 * pinned address is what makes the explanation trustworthy.
 *
 * Source of the entry: `config/protocol-v2.json` in the public
 * DigitalGuards/QuantaSwap repository (`qrlChainId` 3151909, `qrlHtlc`).
 * A redeploy or a mainnet deployment needs a new entry. An address that is
 * missing from this list gets the plain "unknown contract call" view. There
 * is no mainnet entry.
 */
export type KnownSwapEscrow = { address: string; name: string };

const KNOWN_SWAP_ESCROWS: ReadonlyMap<string, readonly KnownSwapEscrow[]> =
  new Map([
    [
      "0x301825",
      [
        {
          address:
            "QBFe68340591f82a68C2258FA2cE7C02Be21E5fc7Bb71615B56a509db4985e863D9243B74da6335C065e257A01d40354653E551907338DBDc7A6b342ea2274437",
          name: "QuantaSwap",
        },
      ],
    ],
  ]);

export const knownSwapEscrow = (
  chainId: unknown,
  address: unknown,
): KnownSwapEscrow | undefined => {
  if (typeof chainId !== "string") return undefined;
  return KNOWN_SWAP_ESCROWS.get(chainId.toLowerCase())?.find((entry) =>
    areAddressesEquivalent(entry.address, address),
  );
};
