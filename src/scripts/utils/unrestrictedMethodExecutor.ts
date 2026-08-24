import StorageUtil from "@/utilities/storageUtil";
import Web3, { FMT_BYTES, FMT_NUMBER } from "@theqrl/web3";
import { Web3RequestManager } from "@theqrl/web3-core";
import { qrlRpcMethods } from "@theqrl/web3-rpc-methods";
import { BaseProvider } from "@theqrl/qrl-wallet-provider/providers";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";
import { getSerializableObject } from "./scriptUtils";

/**
 * Executes read-only ("unrestricted") provider methods against the active
 * chain's RPC endpoint.
 *
 * This MUST run in the service worker, never in the content script: since
 * Chrome 85 content-script fetches are subject to the hosting page's CORS,
 * so RPC calls issued there carry the dApp page's Origin and get rejected
 * by any endpoint that doesn't allowlist that origin (the wallet backend's
 * proxy 403s unknown origins' preflights, which broke the injected
 * provider with "Failed to get initial state" on every non-allowlisted
 * site). Service-worker fetches are extension-context requests, exempt
 * from page CORS via the manifest's host_permissions.
 */

const getQrlProperties = async () => {
  const { defaultRpcUrl, defaultWsRpcUrl } =
    await StorageUtil.getActiveBlockChain();
  const qrlHttpProvider = new Web3.providers.HttpProvider(defaultRpcUrl);
  const { provider, qrl } = new Web3({ provider: qrlHttpProvider });
  return { provider, qrl, defaultWsRpcUrl };
};

// Plain fetch instead of axios: XMLHttpRequest does not exist in MV3
// service workers, so axios' default browser adapter is unusable here.
const postJson = async (
  url: string,
  body: unknown,
): Promise<Record<string, unknown> | null> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
};

export const executeUnrestrictedMethod = async (
  req: JsonRpcRequest<JsonRpcRequest>,
): Promise<unknown> => {
  const { provider, qrl, defaultWsRpcUrl } = await getQrlProperties();
  const method = req.method;
  if (method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_BY_NUMBER) {
    // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
    const [block, hydrated] = req?.params ?? [];
    const blockInformation = await qrl.getBlock(block, hydrated);
    return getSerializableObject(blockInformation);
  } else if (
    method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH ||
    method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER
  ) {
    // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime
    const [blockHashOrNumber] = req.params;
    const transactionCount =
      await qrl.getBlockTransactionCount(blockHashOrNumber);
    return "0x".concat(transactionCount.toString(16));
  } else if (
    method === UNRESTRICTED_METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE
  ) {
    const urlOrigin = new URL(req?.senderData?.url ?? "").origin;
    const chainId = await qrl.getChainId();
    const networkVersion = (await qrl?.net.getId())?.toString() ?? "";
    // Read accounts after the network calls so a revoke that arrives while
    // provider initialization is pending cannot be overwritten by a stale
    // initial-state response.
    const connectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(urlOrigin);
    return {
      chainId: `0x${chainId.toString(16)}`,
      networkVersion,
      isUnlocked: false,
      accounts: connectedAccountsData?.accounts ?? [],
    } as Parameters<BaseProvider["_initializeState"]>[0];
  } else if (method === UNRESTRICTED_METHODS.QRL_SYNCING) {
    const isSyncing = await qrl.isSyncing();
    return isSyncing;
  } else if (method === UNRESTRICTED_METHODS.QRL_UNINSTALL_FILTER) {
    const [filterIdentifier] = req?.params ?? [];
    const isSuccess = await qrlRpcMethods.uninstallFilter(
      new Web3RequestManager(provider),
      filterIdentifier,
    );
    return isSuccess;
  } else if (method === UNRESTRICTED_METHODS.QRL_UNSUBSCRIBE) {
    const params = req?.params;
    const data = await postJson(`${defaultWsRpcUrl}/qrl_unsubscribe`, {
      params,
    });
    const unsubscribed = data?.unsubscribed as boolean;
    return unsubscribed;
  } else if (method === UNRESTRICTED_METHODS.NET_VERSION) {
    const networkId = await qrl.net.getId();
    return "0x".concat(networkId.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_ACCOUNTS) {
    const connectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(
        new URL(req?.senderData?.url ?? "").origin,
      );
    return connectedAccountsData?.accounts ?? [];
  } else if (method === UNRESTRICTED_METHODS.WALLET_GET_PERMISSIONS) {
    const dAppsConnectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(
        new URL(req?.senderData?.url ?? "").origin,
      );
    return getSerializableObject(dAppsConnectedAccountsData?.permissions ?? []);
  } else if (method === UNRESTRICTED_METHODS.WALLET_REVOKE_PERMISSIONS) {
    await StorageUtil.clearDAppsConnectedAccountsData(
      new URL(req?.senderData?.url ?? "").origin,
    );
    return null;
  } else if (method === UNRESTRICTED_METHODS.WEB_3_CLIENT_VERSION) {
    const currentVersion = await qrl?.getNodeInfo();
    return currentVersion;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_BALANCE) {
    const [accountAddress, accountBlockNumber] = req.params;
    const balance = await qrl?.getBalance(accountAddress, accountBlockNumber);
    return "0x".concat(balance.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_ESTIMATE_GAS) {
    const [estimateGasParam] = req.params;
    const estimatedGas = await qrl.estimateGas(estimateGasParam);
    return "0x".concat(estimatedGas.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_FEE_HISTORY) {
    const [blockCount, newestBlock, rewardPercentiles] = req.params;
    const feeHistory = await qrl.getFeeHistory(
      blockCount,
      newestBlock,
      rewardPercentiles,
    );
    return getSerializableObject(feeHistory);
  } else if (method === UNRESTRICTED_METHODS.QRL_BLOCK_NUMBER) {
    const qrlBlockNumber = await qrl.getBlockNumber();
    return "0x".concat(qrlBlockNumber.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_RECEIPT) {
    const [txHashForTransactionReceipt] = req.params;
    const transactionReceipt = await qrl.getTransactionReceipt(
      txHashForTransactionReceipt,
    );
    return getSerializableObject(transactionReceipt);
  } else if (method === UNRESTRICTED_METHODS.QRL_NEW_BLOCK_FILTER) {
    const filterIdentifier = await qrlRpcMethods.newBlockFilter(
      new Web3RequestManager(provider),
    );
    return filterIdentifier;
  } else if (method === UNRESTRICTED_METHODS.QRL_NEW_FILTER) {
    const [filter] = req?.params ?? [];
    const filterIdentifier = await qrlRpcMethods.newFilter(
      new Web3RequestManager(provider),
      filter,
    );
    return filterIdentifier;
  } else if (
    method === UNRESTRICTED_METHODS.QRL_NEW_PENDING_TRANSACTION_FILTER
  ) {
    const filterIdentifier = await qrlRpcMethods.newPendingTransactionFilter(
      new Web3RequestManager(provider),
    );
    return filterIdentifier;
  } else if (method === UNRESTRICTED_METHODS.QRL_SEND_RAW_TRANSACTION) {
    const [rawTransaction] = req?.params ?? [];
    const transactionHash = (await qrl.sendSignedTransaction(rawTransaction))
      ?.transactionHash;
    return transactionHash;
  } else if (method === UNRESTRICTED_METHODS.QRL_SUBSCRIBE) {
    const params = req.params;
    const data = await postJson(`${defaultWsRpcUrl}/qrl_subscribe`, {
      params,
    });
    const subscriptionId = data?.subscriptionId as string;
    return subscriptionId;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_BY_HASH) {
    const [txHashForTransactionByHash] = req.params;
    const transactionDetails = await qrl.getTransaction(
      txHashForTransactionByHash,
    );
    return getSerializableObject(transactionDetails);
  } else if (method === UNRESTRICTED_METHODS.QRL_CALL) {
    const [transactionObj, blockParam] = req.params;
    const qrlCallResponse = await qrl.call(transactionObj, blockParam);
    return qrlCallResponse;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_CODE) {
    const [address, blockNumber] = req.params;
    const byteCode = await qrl.getCode(address, blockNumber);
    return byteCode;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_FILTER_CHANGES) {
    const [filterIdentifier] = req.params;
    const logObjects = await qrlRpcMethods.getFilterChanges(
      new Web3RequestManager(provider),
      filterIdentifier,
    );
    return getSerializableObject(logObjects);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_FILTER_LOGS) {
    const [filterIdentifier] = req.params;
    const logObjects = await qrlRpcMethods.getFilterLogs(
      new Web3RequestManager(provider),
      filterIdentifier,
    );
    return getSerializableObject(logObjects);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_LOGS) {
    const [filter] = req.params;
    const logs = await qrl.getPastLogs(filter);
    return getSerializableObject(logs);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_PROOF) {
    const [address, storageKeys, blockNumber] = req.params;
    const proof = await qrl.getProof(address, storageKeys, blockNumber);
    return getSerializableObject(proof);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_STORAGE_AT) {
    const [address, storageSlot, blockNumber] = req.params;
    const storageAt = await qrl.getStorageAt(address, storageSlot, blockNumber);
    return storageAt;
  } else if (
    method ===
      UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX ||
    method ===
      UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX
  ) {
    const [blockHashOrNumber, transactionIndex] = req?.params ?? [];
    const transactionInformation = qrl?.getTransactionFromBlock(
      blockHashOrNumber,
      transactionIndex,
    );
    return getSerializableObject(transactionInformation);
  } else if (method === UNRESTRICTED_METHODS.QRL_CHAIN_ID) {
    const chainId = await qrl.getChainId({
      number: FMT_NUMBER.HEX,
      bytes: FMT_BYTES.HEX,
    });
    return chainId;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_COUNT) {
    const [address, block] = req.params;
    const transactionCount = await qrl.getTransactionCount(address, block);
    return "0x".concat(transactionCount.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GAS_PRICE) {
    const gasPrice = await qrl.getGasPrice();
    return "0x".concat(gasPrice.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_BY_HASH) {
    const [blockHash, hydrated] = req.params;
    const blockInformation = await qrl.getBlock(blockHash, hydrated);
    return getSerializableObject(blockInformation);
  } else {
    return "";
  }
};
