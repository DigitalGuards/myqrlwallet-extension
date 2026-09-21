export const V3_CHAIN_ID = "0x301825";
export const V3_GENESIS_HASH =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
export const V3_RPC_URL = "https://qrlwallet.com/api/qrl-rpc/testnet";
export const V3_STORAGE_PREFIX = `v3:${V3_CHAIN_ID}:${V3_GENESIS_HASH}:`;

export const assertV3Network = async (rpcUrl: string): Promise<void> => {
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("The v3 network is unavailable.");
    const payload = await response.json();
    if (payload.error) throw new Error("The v3 network is unavailable.");
    return payload.result;
  };
  const [chainId, genesis] = await Promise.all([
    rpc("qrl_chainId", []),
    rpc("qrl_getBlockByNumber", ["0x0", false]),
  ]);
  if (
    typeof chainId !== "string" ||
    chainId.toLowerCase() !== V3_CHAIN_ID ||
    genesis?.hash?.toLowerCase() !== V3_GENESIS_HASH
  ) {
    throw new Error("The RPC does not match the pinned v3 Private network.");
  }
};
