import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import type { TokenContractType } from "@/scripts/middlewares/middlewareTypes";
import type { NFTCollectionType } from "@/types/nft";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import {
  isFiniteNumber,
  isRecord,
  isString,
  isStringArray,
  type StoredBlockchain,
  type StoredHistoryEntry,
  type StoredNFTCollection,
  type StoredToken,
} from "./storageGuards";

export const storedText = (value: unknown): string =>
  isString(value) ? value : "";

// Views are for consumers. Storage setters receive the original records so
// displaying a fallback never rewrites optional metadata in another record.
export const blockchainView = (chain: StoredBlockchain): BlockchainDataType => {
  const currency = isRecord(chain.nativeCurrency) ? chain.nativeCurrency : {};
  return {
    chainId: chain.chainId,
    chainName: storedText(chain.chainName),
    rpcUrls: isStringArray(chain.rpcUrls) ? chain.rpcUrls : [],
    blockExplorerUrls: isStringArray(chain.blockExplorerUrls)
      ? chain.blockExplorerUrls
      : [],
    iconUrls: isStringArray(chain.iconUrls) ? chain.iconUrls : [],
    nativeCurrency:
      chain.nativeCurrency === null
        ? null
        : {
            name: storedText(currency.name),
            symbol: storedText(currency.symbol),
            decimals: isFiniteNumber(currency.decimals)
              ? currency.decimals
              : 18,
          },
    defaultRpcUrl: storedText(chain.defaultRpcUrl),
    defaultBlockExplorerUrl: isStringArray(chain.blockExplorerUrls)
      ? storedText(chain.defaultBlockExplorerUrl)
      : "",
    defaultIconUrl: storedText(chain.defaultIconUrl),
    defaultWsRpcUrl: storedText(chain.defaultWsRpcUrl),
    isTestnet: chain.isTestnet === true,
    isCustomChain: chain.isCustomChain === true,
    qrnsRegistryAddress: isString(chain.qrnsRegistryAddress)
      ? chain.qrnsRegistryAddress
      : undefined,
  };
};

export const tokenView = (token: StoredToken): TokenContractType => ({
  address: token.address,
  symbol: storedText(token.symbol),
  decimals: isFiniteNumber(token.decimals) ? token.decimals : null,
  image: storedText(token.image),
});

export const nftCollectionView = (
  collection: StoredNFTCollection,
): NFTCollectionType => ({
  address: collection.address,
  name: storedText(collection.name),
  symbol: storedText(collection.symbol),
  standard:
    collection.standard === "ZRC721" || collection.standard === "ZRC1155"
      ? collection.standard
      : undefined,
  image: storedText(collection.image),
});

export const historyEntryView = (
  entry: StoredHistoryEntry,
): TransactionHistoryEntry => ({
  id: isString(entry.id) ? entry.id : entry.transactionHash,
  transactionHash: entry.transactionHash,
  from: storedText(entry.from),
  to: storedText(entry.to),
  amount:
    isString(entry.amount) || isFiniteNumber(entry.amount) ? entry.amount : "",
  tokenSymbol: storedText(entry.tokenSymbol),
  tokenName: storedText(entry.tokenName),
  isZrc20Token: entry.isZrc20Token === true,
  tokenContractAddress: storedText(entry.tokenContractAddress),
  tokenDecimals: isFiniteNumber(entry.tokenDecimals)
    ? entry.tokenDecimals
    : null,
  blockNumber: storedText(entry.blockNumber),
  gasUsed: storedText(entry.gasUsed),
  effectiveGasPrice: storedText(entry.effectiveGasPrice),
  status: entry.status === true,
  timestamp: isFiniteNumber(entry.timestamp) ? entry.timestamp : 0,
  chainId: storedText(entry.chainId),
  paidFeesQrl: isString(entry.paidFeesQrl) ? entry.paidFeesQrl : undefined,
  receiptStatusVerified:
    typeof entry.receiptStatusVerified === "boolean"
      ? entry.receiptStatusVerified
      : undefined,
  submissionRejected:
    typeof entry.submissionRejected === "boolean"
      ? entry.submissionRejected
      : undefined,
  isInternal:
    typeof entry.isInternal === "boolean" ? entry.isInternal : undefined,
  pendingStatus:
    entry.pendingStatus === "pending" ||
    entry.pendingStatus === "unknown" ||
    entry.pendingStatus === "confirmed" ||
    entry.pendingStatus === "failed" ||
    entry.pendingStatus === "replaced" ||
    entry.pendingStatus === "cancelled" ||
    entry.pendingStatus === "dropped"
      ? entry.pendingStatus
      : undefined,
  nonce: isFiniteNumber(entry.nonce) ? entry.nonce : undefined,
  maxFeePerGas: isString(entry.maxFeePerGas) ? entry.maxFeePerGas : undefined,
  maxPriorityFeePerGas: isString(entry.maxPriorityFeePerGas)
    ? entry.maxPriorityFeePerGas
    : undefined,
  gasLimit: isFiniteNumber(entry.gasLimit) ? entry.gasLimit : undefined,
  data: isString(entry.data) ? entry.data : undefined,
  replacementTransactionHash: isString(entry.replacementTransactionHash)
    ? entry.replacementTransactionHash
    : undefined,
  replacedByAction:
    entry.replacedByAction === "speed-up" || entry.replacedByAction === "cancel"
      ? entry.replacedByAction
      : undefined,
});
