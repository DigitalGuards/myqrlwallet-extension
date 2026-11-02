import { isRecord } from "@/utilities/storageGuards";

export const V3_CHAIN_ID = "0x301825";
export const V3_GENESIS_HASH =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
export const V3_RPC_URL = "https://qrlwallet.com/api/qrl-rpc/testnet";
export const V3_STORAGE_PREFIX = `v3:${V3_CHAIN_ID}:${V3_GENESIS_HASH}:`;

export const MAINNET_RPC_URL = "https://qrlwallet.com/api/qrl-rpc/mainnet";

/**
 * The identity a network is pinned to. A network counts as pinned only
 * when it carries both its chain ID and its genesis hash; the type makes a
 * half-filled pin a compile error, so the build fails on one.
 */
export type NetworkPin =
  | {
      chainId: string;
      genesisHash: string;
      rpcUrl: string;
      explorer: string | null;
    }
  | {
      chainId: null;
      genesisHash: null;
      rpcUrl: string;
      explorer: string | null;
    };

export type PinnedNetwork = Extract<NetworkPin, { chainId: string }>;

export const V3_TESTNET: PinnedNetwork = {
  chainId: V3_CHAIN_ID,
  genesisHash: V3_GENESIS_HASH,
  rpcUrl: V3_RPC_URL,
  explorer: "https://zondscan.com",
};

/**
 * QRL 2.0 mainnet, dormant until its identity is known. While chainId and
 * genesisHash are null the wallet lists no mainnet chain, signs nothing
 * for one and shows no fiat values anywhere. Launch day fills in both
 * values (lower-case hex, same formats as the v3 pins) and, once a mainnet
 * explorer exists, its origin.
 */
export const MAINNET: NetworkPin = {
  chainId: null,
  genesisHash: null,
  rpcUrl: MAINNET_RPC_URL,
  explorer: null,
};

const CHAIN_ID_FORMAT = /^0x[1-9a-f][0-9a-f]*$/;
const GENESIS_HASH_FORMAT = /^0x[0-9a-f]{64}$/;

/**
 * Throws when a mainnet pin is malformed or reuses the testnet identity.
 * Comparisons elsewhere lower-case what the node reports and match it
 * against these constants, so the pins themselves must be lower-case.
 */
export const validateMainnetPin = (pin: NetworkPin): void => {
  if (pin.chainId === null) return;
  if (!CHAIN_ID_FORMAT.test(pin.chainId)) {
    throw new Error("The mainnet chain ID must be lower-case 0x hex.");
  }
  if (!GENESIS_HASH_FORMAT.test(pin.genesisHash)) {
    throw new Error(
      "The mainnet genesis hash must be 32 lower-case hex bytes.",
    );
  }
  if (pin.chainId === V3_CHAIN_ID || pin.genesisHash === V3_GENESIS_HASH) {
    throw new Error("The mainnet identity must differ from the v3 testnet.");
  }
  if (pin.explorer !== null && !pin.explorer.startsWith("https://")) {
    throw new Error("The mainnet explorer must be an https origin.");
  }
};

// Every surface imports this module, so a bad pin stops the extension from
// loading at all, before any network call.
validateMainnetPin(MAINNET);

type IdentityMessages = { unavailable: string; mismatch: string };

const V3_MESSAGES: IdentityMessages = {
  unavailable: "The v3 network is unavailable.",
  mismatch: "The RPC does not match the pinned v3 Private network.",
};

const MAINNET_MESSAGES: IdentityMessages = {
  unavailable: "The QRL mainnet is unavailable.",
  mismatch: "The RPC does not match the pinned QRL mainnet.",
};

const assertNetworkIdentity = async (
  rpcUrl: string,
  expected: PinnedNetwork,
  messages: IdentityMessages,
): Promise<void> => {
  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(messages.unavailable);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.error) {
      throw new Error(messages.unavailable);
    }
    return payload.result;
  };
  const [chainId, genesis] = await Promise.all([
    rpc("qrl_chainId", []),
    rpc("qrl_getBlockByNumber", ["0x0", false]),
  ]);
  if (
    typeof chainId !== "string" ||
    chainId.toLowerCase() !== expected.chainId ||
    !isRecord(genesis) ||
    typeof genesis.hash !== "string" ||
    genesis.hash.toLowerCase() !== expected.genesisHash
  ) {
    throw new Error(messages.mismatch);
  }
};

export const assertV3Network = async (rpcUrl: string): Promise<void> => {
  await assertNetworkIdentity(rpcUrl, V3_TESTNET, V3_MESSAGES);
};

/**
 * Checks that the node behind `rpcUrl` reports the mainnet identity in
 * `pin`. Fails closed: an unpinned mainnet throws before any request.
 */
export const assertMainnetNetwork = async (
  rpcUrl: string,
  pin: NetworkPin = MAINNET,
): Promise<void> => {
  if (pin.chainId === null) {
    throw new Error("The QRL mainnet is not pinned in this build.");
  }
  await assertNetworkIdentity(rpcUrl, pin, MAINNET_MESSAGES);
};
