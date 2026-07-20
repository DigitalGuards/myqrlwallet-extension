const QRL_MAINNET_DATA = {
  chainId: "0x1",
  chainName: "Zond Mainnet",
  rpcUrls: ["http://127.0.0.1:8545"],
  blockExplorerUrls: ["https://www.theqrl.org/markets/"],
  nativeCurrency: {
    name: "Quanta",
    symbol: "Quanta",
    decimals: 18,
  },
  iconUrls: ["icons/chains/zond_mainnet.svg"],
};

// The wallet backend's CF-fronted HTTPS JSON-RPC proxy: does server-side
// node failover and avoids the cleartext-http warning (and consumer
// networks that drop plain http to raw IPs). The proxy allowlists the
// qrl_*/net_* methods the wallet and our dApps use; exotic passthrough
// methods (feeHistory, filters, getProof, ...) need a direct node, which
// users can still add as a custom chain.
export const QRL_TESTNET_RPC_PROXY = "https://qrlwallet.com/api/qrl-rpc/testnet";
// Pre-0.4.10 builtin default (cleartext http to the foundation node); kept
// only so stored chain lists can be migrated on read.
export const LEGACY_TESTNET_RPC = "http://209.250.255.226:8545";

const QRL_TESTNET_DATA = {
  chainId: "0x539",
  chainName: "QRL Zond Testnet v2",
  rpcUrls: [QRL_TESTNET_RPC_PROXY],
  blockExplorerUrls: ["https://www.theqrl.org/markets/"],
  nativeCurrency: {
    name: "Quanta",
    symbol: "Quanta",
    decimals: 18,
  },
  iconUrls: ["icons/chains/zond_testnet.svg"],
};

export type BlockchainBaseDataType = typeof QRL_MAINNET_DATA;

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
    ...QRL_MAINNET_DATA,
    defaultRpcUrl: QRL_MAINNET_DATA.rpcUrls[0],
    defaultBlockExplorerUrl: QRL_MAINNET_DATA.blockExplorerUrls[0],
    defaultIconUrl: QRL_MAINNET_DATA.iconUrls[0],
    isTestnet: false,
    defaultWsRpcUrl: "http://localhost:3000",
    isCustomChain: false,
  },
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

export const DEFAULT_BLOCKCHAIN = QRL_BLOCKCHAINS[1]; // Testnet
