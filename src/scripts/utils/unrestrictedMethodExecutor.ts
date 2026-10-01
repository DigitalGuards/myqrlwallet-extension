import StorageUtil from "@/utilities/storageUtil";
import {
  providerNetworkIdentity,
  type ProviderNetworkIdentity,
} from "@/utilities/providerNetwork";
import {
  assertV3Network,
  V3_CHAIN_ID,
  V3_GENESIS_HASH,
} from "@/configuration/releaseProfile";
import Web3, { FMT_BYTES, FMT_NUMBER } from "@theqrl/web3";
import { Web3RequestManager } from "@theqrl/web3-core";
import { qrlRpcMethods } from "@theqrl/web3-rpc-methods";
import { BaseProvider } from "@theqrl/qrl-wallet-provider/providers";
import { JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";
import { prepareQip55LogFilter } from "./qip55LogFilter";
import { getSerializableObject } from "./scriptUtils";
import LockManager from "../lockManager/lockManager";

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

// Exported for dAppTransactionWatcher.ts, which needs the same
// service-worker-only, CORS-exempt RPC access to poll receipts.
export const getQrlProperties = async () => {
  const { defaultRpcUrl } = await StorageUtil.getActiveBlockChain();
  const qrlHttpProvider = new Web3.providers.HttpProvider(defaultRpcUrl);
  const { provider, qrl } = new Web3({ provider: qrlHttpProvider });
  return { provider, qrl };
};

/**
 * Last resort for the provider state when the stored chain id cannot be
 * read as a number.
 *
 * Only a malformed stored chain reaches this, since the built-in default
 * always carries a valid id and the add-chain path validates the field. It
 * is kept so a corrupted entry still produces real numbers where the node
 * can supply them.
 */
const networkIdentityFromNode = async (
  qrl: Awaited<ReturnType<typeof getQrlProperties>>["qrl"],
): Promise<ProviderNetworkIdentity> => {
  const chainId = await qrl.getChainId();
  const networkVersion = (await qrl.net.getId())?.toString() ?? "";
  return { chainId: `0x${chainId.toString(16)}`, networkVersion };
};

export const executeUnrestrictedMethod = async (
  req: JsonRpcRequest<JsonRpcRequest>,
): Promise<unknown> => {
  if (req.method === UNRESTRICTED_METHODS.QRL_WALLET_CAPABILITIES) {
    const chain = await StorageUtil.getActiveBlockChain();
    if (chain.chainId.toLowerCase() !== V3_CHAIN_ID)
      throw new Error("Select the v3 Private network.");
    await assertV3Network(chain.defaultRpcUrl);
    const currentChain = await StorageUtil.getActiveBlockChain();
    if (
      currentChain.chainId !== chain.chainId ||
      currentChain.defaultRpcUrl !== chain.defaultRpcUrl
    ) {
      throw new Error(
        "The network changed. Request wallet capabilities again.",
      );
    }
    return {
      addressScheme: "qip55-64",
      chainId: V3_CHAIN_ID,
      genesisHash: V3_GENESIS_HASH,
    };
  }
  const { provider, qrl } = await getQrlProperties();
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
    // Served from the stored active chain, with no RPC round trip.
    //
    // These were two live calls to the node. Every page load injects the
    // provider, which asks for this state, so an unreachable node made
    // every website log "QrlWallet - RPC Error" followed by
    // "QrlWallet: Failed to get initial state. Please report this bug.",
    // upstream MetaMask wording for what is a transient network failure
    // here. Worse, the provider then initialized with a null chainId and
    // stayed dead until the page was reloaded, even once the node came
    // back. The stored chain already carries the id and net_version is its
    // decimal, so the node is only consulted when the stored id is
    // unusable.
    const activeChain = await StorageUtil.getActiveBlockChain();
    const storedIdentity = providerNetworkIdentity(activeChain.chainId);
    const { chainId, networkVersion } =
      storedIdentity ?? (await networkIdentityFromNode(qrl));
    // Read accounts after the network identity so a revoke that arrives while
    // provider initialization is pending cannot be overwritten by a stale
    // initial-state response.
    const connectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(urlOrigin);
    // MetaMask parity (F8): the initial provider state must agree with
    // qrl_accounts. It previously reported isUnlocked: false unconditionally
    // while still handing back the stored account list, so a page had no way
    // to tell a locked wallet from an unlocked one. Every write path
    // re-checks the lock state on its own, so a page holding a stale account
    // list cannot act on it; this is a disclosure fix.
    const { isLocked } = await LockManager.isLocked();
    return {
      chainId,
      networkVersion,
      isUnlocked: !isLocked,
      accounts: isLocked ? [] : (connectedAccountsData?.accounts ?? []),
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
    // The wallet has no websocket transport, so there is no subscription to
    // cancel. The former implementation POSTed the page's params at a
    // configurable base URL that defaulted to loopback, which let any site
    // drive the service worker into talking to a local service. The
    // middleware turns this throw into EIP-1193 4200.
    throw new Error(
      "qrl_unsubscribe is not supported by this wallet. Use the qrl_newFilter family for event polling.",
    );
  } else if (method === UNRESTRICTED_METHODS.NET_VERSION) {
    const networkId = await qrl.net.getId();
    return "0x".concat(networkId.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_ACCOUNTS) {
    // MetaMask parity (F8): a locked wallet answers qrl_accounts with an
    // empty array. A dApp that still displays previously-connected
    // addresses while the wallet is locked cannot act on them - every
    // write path re-checks the lock state on its own - but showing them at
    // all is a stale-permission leak the page has no way to detect.
    const { isLocked } = await LockManager.isLocked();
    if (isLocked) return [];
    const connectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(
        new URL(req?.senderData?.url ?? "").origin,
      );
    return connectedAccountsData?.accounts ?? [];
  } else if (method === UNRESTRICTED_METHODS.WALLET_GET_PERMISSIONS) {
    // The permission caveats carry the connected account addresses, so a
    // locked wallet answers with an empty permission list for the same
    // reason qrl_accounts answers with an empty array.
    const { isLocked } = await LockManager.isLocked();
    if (isLocked) return [];
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
    const filterIdentifier = await new Web3RequestManager(provider).send({
      method: "qrl_newFilter",
      params: [prepareQip55LogFilter(filter)],
    });
    return filterIdentifier;
  } else if (
    method === UNRESTRICTED_METHODS.QRL_NEW_PENDING_TRANSACTION_FILTER
  ) {
    const filterIdentifier = await qrlRpcMethods.newPendingTransactionFilter(
      new Web3RequestManager(provider),
    );
    return filterIdentifier;
  } else if (method === UNRESTRICTED_METHODS.QRL_SEND_RAW_TRANSACTION) {
    await assertV3Network(
      (await StorageUtil.getActiveBlockChain()).defaultRpcUrl,
    );
    const [rawTransaction] = req?.params ?? [];
    const transactionHash = (await qrl.sendSignedTransaction(rawTransaction))
      ?.transactionHash;
    return transactionHash;
  } else if (method === UNRESTRICTED_METHODS.QRL_SUBSCRIBE) {
    // Websocket subscriptions were never wired to a real JSON-RPC transport:
    // the old code POSTed the page's params at a configurable base URL that
    // defaulted to loopback and expected a bespoke {subscriptionId} reply.
    // That gave any site a way to make the service worker POST chosen JSON
    // at a local service. The middleware turns this throw into EIP-1193 4200.
    throw new Error(
      "qrl_subscribe is not supported by this wallet. Use the qrl_newFilter family for event polling.",
    );
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
    const logs = await new Web3RequestManager(provider).send({
      method: "qrl_getLogs",
      params: [prepareQip55LogFilter(filter)],
    });
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
