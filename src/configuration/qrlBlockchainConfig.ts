import { pinnedMainnet } from "./pinnedNetworks";
import { V3_CHAIN_ID, V3_RPC_URL, V3_QNS_REGISTRY } from "./releaseProfile";

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

export type BlockchainBaseDataType = {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  blockExplorerUrls?: string[] | null;
  iconUrls?: string[] | null;
  nativeCurrency: {
    name?: string | null;
    symbol: string;
    decimals: number;
  } | null;
};

export type BlockchainAdditionalDataType = {
  defaultRpcUrl: string;
  defaultBlockExplorerUrl: string;
  defaultIconUrl: string;
  isTestnet: boolean;
  // Retained so stored chain records and the wallet_addQRLChain internal-keys
  // allowlist keep their shape. The wallet no longer issues any request to
  // this URL.
  defaultWsRpcUrl: string;
  isCustomChain: boolean;
  qrnsRegistryAddress?: string;
};

export type BlockchainDataType = BlockchainBaseDataType &
  BlockchainAdditionalDataType;

const QRL_MAINNET_ICON = "icons/chains/zond_mainnet.svg";

const buildMainnetBlockchain = (): BlockchainDataType | null => {
  const mainnet = pinnedMainnet();
  if (mainnet === null) return null;
  const explorers = mainnet.explorer === null ? [] : [mainnet.explorer];
  return {
    chainId: mainnet.chainId,
    chainName: "QRL Mainnet",
    rpcUrls: [mainnet.rpcUrl],
    blockExplorerUrls: explorers,
    nativeCurrency: {
      name: "Quanta",
      symbol: "Quanta",
      decimals: 18,
    },
    iconUrls: [QRL_MAINNET_ICON],
    defaultRpcUrl: mainnet.rpcUrl,
    defaultBlockExplorerUrl: mainnet.explorer ?? "",
    defaultIconUrl: QRL_MAINNET_ICON,
    isTestnet: false,
    defaultWsRpcUrl: "",
    isCustomChain: false,
  };
};

/**
 * The built-in mainnet chain. It exists only in a build that pins both the
 * mainnet chain ID and genesis hash; until then it is null and the chain
 * list holds the v3 testnet alone.
 */
export const QRL_MAINNET_BLOCKCHAIN = buildMainnetBlockchain();

export const QRL_BLOCKCHAINS: BlockchainDataType[] = [
  {
    ...QRL_TESTNET_DATA,
    defaultRpcUrl: QRL_TESTNET_DATA.rpcUrls[0],
    defaultBlockExplorerUrl: QRL_TESTNET_DATA.blockExplorerUrls[0],
    defaultIconUrl: QRL_TESTNET_DATA.iconUrls[0],
    isTestnet: true,
    defaultWsRpcUrl: "",
    isCustomChain: false,
    qrnsRegistryAddress: V3_QNS_REGISTRY,
  },
  ...(QRL_MAINNET_BLOCKCHAIN === null ? [] : [QRL_MAINNET_BLOCKCHAIN]),
];

export const DEFAULT_BLOCKCHAIN = QRL_BLOCKCHAINS[0];
