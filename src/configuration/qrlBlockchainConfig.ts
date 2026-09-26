import { V3_CHAIN_ID, V3_RPC_URL } from "./releaseProfile";

// The wallet backend's CF-fronted HTTPS JSON-RPC proxy: does server-side
// node failover and avoids the cleartext-http warning (and consumer
// networks that drop plain http to raw IPs). The proxy allowlists the
// qrl_*/net_* methods the wallet and our dApps use; exotic passthrough
// methods (feeHistory, filters, getProof, ...) need a direct node, which
// users can still add as a custom chain.
export const QRL_TESTNET_RPC_PROXY = V3_RPC_URL;
// Pre-0.4.10 builtin default (cleartext http to the foundation node); kept
// only so stored chain lists can be migrated on read.
export const LEGACY_TESTNET_RPC = "http://209.250.255.226:8545";

const QRL_TESTNET_DATA = {
  chainId: V3_CHAIN_ID,
  chainName: "QRL v3 Private",
  rpcUrls: [QRL_TESTNET_RPC_PROXY],
  blockExplorerUrls: ["https://zondscan.com"],
  nativeCurrency: {
    name: "Quanta",
    symbol: "Quanta",
    decimals: 18,
  },
  iconUrls: ["icons/chains/zond_testnet.svg"],
};

export type BlockchainBaseDataType = typeof QRL_TESTNET_DATA;

export type BlockchainAdditionalDataType = {
  defaultRpcUrl: string;
  defaultBlockExplorerUrl: string;
  defaultIconUrl: string;
  isTestnet: boolean;
  defaultWsRpcUrl: string;
  isCustomChain: boolean;
  qrnsRegistryAddress?: string;
};

export type BlockchainDataType = BlockchainBaseDataType &
  BlockchainAdditionalDataType;

export const QRL_BLOCKCHAINS: BlockchainDataType[] = [
  {
    ...QRL_TESTNET_DATA,
    defaultRpcUrl: QRL_TESTNET_DATA.rpcUrls[0],
    defaultBlockExplorerUrl: QRL_TESTNET_DATA.blockExplorerUrls[0],
    defaultIconUrl: QRL_TESTNET_DATA.iconUrls[0],
    isTestnet: true,
    defaultWsRpcUrl: "http://localhost:3000",
    isCustomChain: false,
  },
];

export const DEFAULT_BLOCKCHAIN = QRL_BLOCKCHAINS[0];
