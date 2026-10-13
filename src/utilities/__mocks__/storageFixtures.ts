import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import type {
  ConnectedAccountsDataType,
  TokenContractType,
} from "@/scripts/middlewares/middlewareTypes";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import type { NFTCollectionType } from "@/types/nft";
import { toChecksumAddress } from "@theqrl/wallet.js";

export const ACCOUNT = toChecksumAddress(`Q${"a".repeat(128)}`);
export const OTHER_ACCOUNT = toChecksumAddress(`Q${"b".repeat(128)}`);
export const CHAIN: BlockchainDataType = {
  chainId: "0x2a",
  chainName: "Custom chain",
  rpcUrls: ["https://rpc.example"],
  nativeCurrency: { symbol: "QNT", decimals: 18 },
  defaultRpcUrl: "https://rpc.example",
  defaultBlockExplorerUrl: "",
  defaultIconUrl: "",
  defaultWsRpcUrl: "",
  isCustomChain: true,
  isTestnet: false,
};
export const TOKEN: TokenContractType = {
  address: "token-a",
  symbol: "TOK",
  decimals: 18,
  image: "",
};
export const NFT: NFTCollectionType = {
  address: "nft-a",
  name: "Collection",
  symbol: "NFT",
  standard: "ZRC721",
  image: "",
};
export const HISTORY: TransactionHistoryEntry = {
  id: "hash-a",
  transactionHash: "hash-a",
  from: ACCOUNT,
  to: OTHER_ACCOUNT,
  amount: "1.5",
  tokenSymbol: "TOK",
  tokenName: "Token",
  tokenContractAddress: TOKEN.address,
  isZrc20Token: true,
  tokenDecimals: 18,
  blockNumber: "",
  gasUsed: "",
  effectiveGasPrice: "",
  status: false,
  timestamp: 1700000000000,
  chainId: CHAIN.chainId,
  pendingStatus: "pending",
};
export const CONNECTION: ConnectedAccountsDataType = {
  urlOrigin: "https://dapp.example",
  accounts: [ACCOUNT, OTHER_ACCOUNT],
  blockchains: [CHAIN],
  permissions: [
    {
      invoker: "https://dapp.example",
      parentCapability: "qrl_accounts",
      caveats: [
        { type: "restrictReturnedAccounts", value: [ACCOUNT, OTHER_ACCOUNT] },
      ],
    },
    {
      invoker: "https://dapp.example",
      parentCapability: "qrl_chains",
      caveats: [{ type: "restrictNetworkSwitching", value: [CHAIN.chainId] }],
    },
  ],
};
export const LEDGER = {
  address: ACCOUNT,
  derivationPath: "m/44'/238'/0'/0/0",
  publicKey: "",
  index: 0,
};
