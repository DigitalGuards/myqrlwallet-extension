import type { BlockTag } from "@theqrl/web3-types";

/**
 * Block tag every signing path uses when it reads an account's nonce.
 *
 * web3-core defaults `getTransactionCount` to `latest`, which counts only
 * mined transactions. QRL 2.0 slots are 60 s, so two sends started inside one
 * slot both read the same `latest` count and sign the same nonce; the second
 * one is then rejected as a replacement, or silently replaces the first.
 * `pending` includes the node's own mempool, so consecutive sends advance.
 */
export const SIGNING_NONCE_BLOCK_TAG: BlockTag = "pending";
