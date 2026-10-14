import StorageUtil from "@/utilities/storageUtil";
import { isRecord } from "@/utilities/storageGuards";
import {
  isApprovalSender,
  isStringArray,
  isUnknownArray,
} from "@/utilities/approvalGuards";
import {
  isOptionalRpcBlock,
  isOptionalRpcBoolean,
  isOptionalRpcNumber,
  isRpcBytes,
  isRpcBytesArray,
  isRpcNumber,
  isRpcNumberArray,
  isRpcString,
  isRpcTransaction,
  readRpcParameter,
  readRpcParams,
  type RpcBlockContext,
  type RpcTransactionContext,
} from "./unrestrictedMethodGuards";
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
import type { BaseProvider } from "@theqrl/qrl-wallet-provider/providers";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";
import { prepareQip55LogFilter } from "./qip55LogFilter";
import { getSerializableObject } from "./scriptUtils";
import LockManager from "../lockManager/lockManager";

type ActiveChain = { defaultRpcUrl: string; chainId?: unknown };

const isActiveChain = (value: unknown): value is ActiveChain =>
  isRecord(value) && typeof value.defaultRpcUrl === "string";

const readActiveChain = (value: unknown): ActiveChain => {
  if (!isActiveChain(value))
    throw new Error("The wallet cannot read the active network.");
  return value;
};

const readConnectionField = (value: unknown, field: string): unknown => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value))
    throw new Error("The wallet cannot read the stored dApp connection.");
  return value[field];
};

const readAccounts = (value: unknown): string[] => {
  const accounts = readConnectionField(value, "accounts");
  if (accounts === undefined || accounts === null) return [];
  if (!isStringArray(accounts))
    throw new Error("The wallet cannot read the stored dApp accounts.");
  return accounts;
};

const readPermissions = (value: unknown): unknown[] => {
  const permissions = readConnectionField(value, "permissions");
  if (permissions === undefined || permissions === null) return [];
  if (!isUnknownArray(permissions))
    throw new Error("The wallet cannot read the stored dApp permissions.");
  return permissions;
};

const requestOrigin = (sender: unknown): string =>
  new URL(isApprovalSender(sender) ? (sender.url ?? "") : "").origin;

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
  const { defaultRpcUrl } = readActiveChain(
    await StorageUtil.getActiveBlockChain(),
  );
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
  const chainId = readRpcParameter(await qrl.getChainId(), isRpcNumber);
  const networkId: unknown = await qrl.net.getId();
  const networkVersion =
    networkId === undefined || networkId === null
      ? ""
      : readRpcParameter(networkId, isRpcNumber).toString();
  return { chainId: `0x${chainId.toString(16)}`, networkVersion };
};

export const executeUnrestrictedMethod = async (
  req: unknown,
): Promise<unknown> => {
  if (!isRecord(req) || typeof req.method !== "string") {
    throw new Error("Invalid QRL RPC request.");
  }
  if (req.method === UNRESTRICTED_METHODS.QRL_WALLET_CAPABILITIES) {
    const chain = readActiveChain(await StorageUtil.getActiveBlockChain());
    if (
      typeof chain.chainId !== "string" ||
      chain.chainId.toLowerCase() !== V3_CHAIN_ID
    )
      throw new Error("Select the v3 Private network.");
    await assertV3Network(chain.defaultRpcUrl);
    const currentChain = readActiveChain(
      await StorageUtil.getActiveBlockChain(),
    );
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
  const blockContext: RpcBlockContext = qrl;
  const method = req.method;
  if (method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_BY_NUMBER) {
    const [block, hydrated] = readRpcParams(req.params);
    const blockInformation = await blockContext.getBlock(
      readRpcParameter(block, isOptionalRpcBlock),
      readRpcParameter(hydrated, isOptionalRpcBoolean),
    );
    return getSerializableObject(blockInformation);
  } else if (
    method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH ||
    method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER
  ) {
    const [blockHashOrNumber] = readRpcParams(req.params);
    const transactionCount = await blockContext.getBlockTransactionCount(
      readRpcParameter(blockHashOrNumber, isOptionalRpcBlock),
    );
    return "0x".concat(transactionCount.toString(16));
  } else if (
    method === UNRESTRICTED_METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE
  ) {
    const urlOrigin = requestOrigin(req.senderData);
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
    const activeChain = readActiveChain(
      await StorageUtil.getActiveBlockChain(),
    );
    const storedIdentity = providerNetworkIdentity(
      typeof activeChain.chainId === "string" ? activeChain.chainId : undefined,
    );
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
      accounts: isLocked ? [] : readAccounts(connectedAccountsData),
    } satisfies Parameters<BaseProvider["_initializeState"]>[0];
  } else if (method === UNRESTRICTED_METHODS.QRL_SYNCING) {
    const isSyncing = await qrl.isSyncing();
    return isSyncing;
  } else if (method === UNRESTRICTED_METHODS.QRL_UNINSTALL_FILTER) {
    const [filterIdentifier] = readRpcParams(req.params);
    const isSuccess = await qrlRpcMethods.uninstallFilter(
      new Web3RequestManager(provider),
      readRpcParameter(filterIdentifier, isRpcString),
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
        requestOrigin(req.senderData),
      );
    return readAccounts(connectedAccountsData);
  } else if (method === UNRESTRICTED_METHODS.WALLET_GET_PERMISSIONS) {
    // The permission caveats carry the connected account addresses, so a
    // locked wallet answers with an empty permission list for the same
    // reason qrl_accounts answers with an empty array.
    const { isLocked } = await LockManager.isLocked();
    if (isLocked) return [];
    const dAppsConnectedAccountsData =
      await StorageUtil.getDAppsConnectedAccountsData(
        requestOrigin(req.senderData),
      );
    return getSerializableObject(readPermissions(dAppsConnectedAccountsData));
  } else if (method === UNRESTRICTED_METHODS.WALLET_REVOKE_PERMISSIONS) {
    await StorageUtil.clearDAppsConnectedAccountsData(
      requestOrigin(req.senderData),
    );
    return null;
  } else if (method === UNRESTRICTED_METHODS.WEB_3_CLIENT_VERSION) {
    const currentVersion = await qrl.getNodeInfo();
    return currentVersion;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_BALANCE) {
    const [accountAddress, accountBlockNumber] = readRpcParams(req.params);
    const balance = await qrl.getBalance(
      readRpcParameter(accountAddress, isRpcString),
      readRpcParameter(accountBlockNumber, isOptionalRpcNumber),
    );
    return "0x".concat(balance.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_ESTIMATE_GAS) {
    const [estimateGasParam] = readRpcParams(req.params);
    const transactionContext: RpcTransactionContext = qrl;
    const estimatedGas = await transactionContext.estimateGas(
      readRpcParameter(estimateGasParam, isRpcTransaction),
    );
    return "0x".concat(estimatedGas.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_FEE_HISTORY) {
    const [blockCount, newestBlock, rewardPercentiles] = readRpcParams(
      req.params,
    );
    const feeHistory = await qrl.getFeeHistory(
      readRpcParameter(blockCount, isRpcNumber),
      readRpcParameter(newestBlock, isOptionalRpcNumber),
      readRpcParameter(rewardPercentiles, isRpcNumberArray),
    );
    return getSerializableObject(feeHistory);
  } else if (method === UNRESTRICTED_METHODS.QRL_BLOCK_NUMBER) {
    const qrlBlockNumber = await qrl.getBlockNumber();
    return "0x".concat(qrlBlockNumber.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_RECEIPT) {
    const [txHashForTransactionReceipt] = readRpcParams(req.params);
    const transactionReceipt = await qrl.getTransactionReceipt(
      readRpcParameter(txHashForTransactionReceipt, isRpcBytes),
    );
    return getSerializableObject(transactionReceipt);
  } else if (method === UNRESTRICTED_METHODS.QRL_NEW_BLOCK_FILTER) {
    const filterIdentifier = await qrlRpcMethods.newBlockFilter(
      new Web3RequestManager(provider),
    );
    return filterIdentifier;
  } else if (method === UNRESTRICTED_METHODS.QRL_NEW_FILTER) {
    const [filter] = readRpcParams(req.params);
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
      readActiveChain(await StorageUtil.getActiveBlockChain()).defaultRpcUrl,
    );
    const [rawTransaction] = readRpcParams(req.params);
    const receipt: unknown = await qrl.sendSignedTransaction(
      readRpcParameter(rawTransaction, isRpcBytes),
    );
    if (receipt === undefined || receipt === null) return undefined;
    if (!isRecord(receipt)) throw new Error("Invalid QRL transaction receipt.");
    return readRpcParameter(receipt.transactionHash, isRpcBytes);
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
    const [txHashForTransactionByHash] = readRpcParams(req.params);
    const transactionDetails = await qrl.getTransaction(
      readRpcParameter(txHashForTransactionByHash, isRpcBytes),
    );
    return getSerializableObject(transactionDetails);
  } else if (method === UNRESTRICTED_METHODS.QRL_CALL) {
    const [transactionObj, blockParam] = readRpcParams(req.params);
    const transactionContext: RpcTransactionContext = qrl;
    const qrlCallResponse = await transactionContext.call(
      readRpcParameter(transactionObj, isRpcTransaction),
      readRpcParameter(blockParam, isOptionalRpcNumber),
    );
    return qrlCallResponse;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_CODE) {
    const [address, blockNumber] = readRpcParams(req.params);
    const byteCode = await qrl.getCode(
      readRpcParameter(address, isRpcString),
      readRpcParameter(blockNumber, isOptionalRpcNumber),
    );
    return byteCode;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_FILTER_CHANGES) {
    const [filterIdentifier] = readRpcParams(req.params);
    const logObjects = await qrlRpcMethods.getFilterChanges(
      new Web3RequestManager(provider),
      readRpcParameter(filterIdentifier, isRpcString),
    );
    return getSerializableObject(logObjects);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_FILTER_LOGS) {
    const [filterIdentifier] = readRpcParams(req.params);
    const logObjects = await qrlRpcMethods.getFilterLogs(
      new Web3RequestManager(provider),
      readRpcParameter(filterIdentifier, isRpcString),
    );
    return getSerializableObject(logObjects);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_LOGS) {
    const [filter] = readRpcParams(req.params);
    const logs = await new Web3RequestManager(provider).send({
      method: "qrl_getLogs",
      params: [prepareQip55LogFilter(filter)],
    });
    return getSerializableObject(logs);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_PROOF) {
    const [address, storageKeys, blockNumber] = readRpcParams(req.params);
    const proof = await qrl.getProof(
      readRpcParameter(address, isRpcString),
      readRpcParameter(storageKeys, isRpcBytesArray),
      readRpcParameter(blockNumber, isOptionalRpcNumber),
    );
    return getSerializableObject(proof);
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_STORAGE_AT) {
    const [address, storageSlot, blockNumber] = readRpcParams(req.params);
    const storageAt = await qrl.getStorageAt(
      readRpcParameter(address, isRpcString),
      readRpcParameter(storageSlot, isRpcNumber),
      readRpcParameter(blockNumber, isOptionalRpcNumber),
    );
    return storageAt;
  } else if (
    method ===
      UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX ||
    method ===
      UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX
  ) {
    const [blockHashOrNumber, transactionIndex] = readRpcParams(req.params);
    // These methods historically serialized the pending promise as {}.
    // Preserve that immediate response and report later RPC failures locally.
    blockContext
      .getTransactionFromBlock(
        readRpcParameter(blockHashOrNumber, isOptionalRpcBlock),
        readRpcParameter(transactionIndex, isRpcNumber),
      )
      .catch((error: unknown) => {
        console.error("QrlWeb3Wallet: Failed to look up transaction:", error);
      });
    return {};
  } else if (method === UNRESTRICTED_METHODS.QRL_CHAIN_ID) {
    const chainId = await qrl.getChainId({
      number: FMT_NUMBER.HEX,
      bytes: FMT_BYTES.HEX,
    });
    return chainId;
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_TRANSACTION_COUNT) {
    const [address, block] = readRpcParams(req.params);
    const transactionCount = await qrl.getTransactionCount(
      readRpcParameter(address, isRpcString),
      readRpcParameter(block, isOptionalRpcNumber),
    );
    return "0x".concat(transactionCount.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GAS_PRICE) {
    const gasPrice = await qrl.getGasPrice();
    return "0x".concat(gasPrice.toString(16));
  } else if (method === UNRESTRICTED_METHODS.QRL_GET_BLOCK_BY_HASH) {
    const [blockHash, hydrated] = readRpcParams(req.params);
    const blockInformation = await blockContext.getBlock(
      readRpcParameter(blockHash, isOptionalRpcBlock),
      readRpcParameter(hydrated, isOptionalRpcBoolean),
    );
    return getSerializableObject(blockInformation);
  } else {
    return "";
  }
};
