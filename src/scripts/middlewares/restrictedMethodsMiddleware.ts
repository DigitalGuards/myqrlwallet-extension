import StorageUtil from "@/utilities/storageUtil";
import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { v4 as uuid } from "uuid";
import {
  providerErrors,
  rpcErrors,
} from "@theqrl/qrl-wallet-provider/rpc-errors";
import { Json, JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import browser from "webextension-polyfill";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import {
  DAPP_REQUEST_PORT_NAME,
  EXTENSION_MESSAGES,
} from "../constants/streamConstants";
import LockManager from "../lockManager/lockManager";
import { checkDomain } from "../phishing/phishingDetector";
import { claimApprovalSlot, releaseApprovalSlot } from "../utils/approvalSlot";
import { openApprovalSurface } from "../utils/approvalSurface";
import { resolveTrustedSenderOrigin } from "../utils/dAppAccountNotifications";
import {
  buildDAppSendTransactionErrorData,
  checkAccountHasBeenAuthorized,
  checkAccountAndChainHaveBeenAuthorized,
  checkUrlOriginHasBeenConnected,
  checkWalletAddQrlChainParams,
  checkWalletRequestPermissionParams,
  checkWalletSwitchQrlChainParams,
  checkWalletWatchAssetParams,
  extractPendingDAppTransactionHash,
  registerDAppTransactionWatchIfApproved,
  updateAccountsAndBlockchainsForUrlOrigin,
} from "../utils/restrictedMethodsMiddlewareUtils";
import { DAppRequestType, DAppResponseType } from "./middlewareTypes";

const QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS: string[] = [
  RESTRICTED_METHODS.WALLET_ADD_QRL_CHAIN,
  RESTRICTED_METHODS.WALLET_GET_CAPABILITIES,
  RESTRICTED_METHODS.WALLET_SWITCH_QRL_CHAIN,
];

export const checkRequestCanCompleteSilently = async (
  req: JsonRpcRequest<JsonRpcRequest>,
) => {
  if (req.method === RESTRICTED_METHODS.WALLET_ADD_QRL_CHAIN) {
    const [chainData] = req.params as unknown as { chainId: string }[];
    const chainId = chainData?.chainId;
    const blockchains = await StorageUtil.getAllBlockChains();
    const chainFound = !!blockchains.find(
      (chain) => chain.chainId.toLowerCase() === chainId.toLowerCase(),
    );
    if (chainFound) {
      // Chain is already known to the wallet. Acknowledge per EIP-3085 but do
      // NOT silently flip the globally-active chain. The dApp must call
      // wallet_switchQRLChain explicitly (which surfaces to the user). F-2.
      return {
        hasCompleted: true,
        completionResult: null,
      };
    }
    return {
      hasCompleted: false,
    };
  } else if (req.method === RESTRICTED_METHODS.WALLET_SWITCH_QRL_CHAIN) {
    const [chainData] = req.params as unknown as { chainId: string }[];
    const chainId = chainData?.chainId;

    const currentChainId = (await StorageUtil.getActiveBlockChain())?.chainId;
    const isAlreadyCurrentChain =
      chainId?.toLowerCase() === currentChainId?.toLowerCase();
    if (isAlreadyCurrentChain) {
      // No-op switch: permitted per EIP-3326 / MetaMask. Any other target
      // (including a chain already in this dApp's permission list) must open
      // the popup so the user authorises the global active-chain change. F-1.
      return {
        hasCompleted: true,
        completionResult: null,
      };
    }

    return {
      hasCompleted: false,
    };
  } else if (req.method === RESTRICTED_METHODS.WALLET_GET_CAPABILITIES) {
    try {
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      const chains: string[] = req?.params?.[1] ?? [];
      const capabilities: {
        [k: string]: { atomic: { status: "ready" | "supported" } };
      } = {};
      // EIP-5792 wallet_sendCalls is not implemented in this wallet; advertise
      // atomic as "supported" (the weaker tier) rather than "ready" so dApps
      // do not dispatch wallet_sendCalls expecting it to succeed. Promote to
      // "ready" once the delegation system lands.
      chains.forEach((chain) => {
        capabilities[chain] = { atomic: { status: "supported" } };
      });

      return {
        hasCompleted: true,
        completionResult: capabilities,
      };
    } catch {
      return {
        hasCompleted: false,
        completionResult: null,
        completionError: rpcErrors.invalidParams({
          message: "The wallet cannot parse the request.",
        }),
      };
    }
  } else if (req.method === RESTRICTED_METHODS.QRL_REQUEST_ACCOUNTS) {
    // MetaMask parity: an origin the user already connected gets its
    // permitted accounts back silently instead of a fresh approval popup on
    // every reconnect. The permission escape hatches stay intact: dApps can
    // force a re-prompt via wallet_requestPermissions, and the user can
    // revoke from the wallet's connectivity screen (or the dApp via
    // wallet_revokePermissions), after which this falls through to the
    // normal approval flow.
    try {
      const urlOrigin = new URL(req?.senderData?.url ?? "").origin;
      const stored = await StorageUtil.getDAppsConnectedAccountsData(urlOrigin);
      const storedAccounts = stored?.accounts ?? [];
      if (storedAccounts.length === 0) {
        return { hasCompleted: false };
      }

      // Locked wallets keep the popup flow: the surface shows the unlock
      // screen first, matching MetaMask's unlock-before-connect behavior.
      const { isLocked } = await LockManager.isLocked();
      if (isLocked) {
        return { hasCompleted: false };
      }

      // An origin that landed on the blocklist since it was approved must
      // still surface the phishing warning, so force the popup for it.
      const settings = await StorageUtil.getSettings();
      const phishingEnabled = settings.phishingDetectionEnabled !== false;
      if (phishingEnabled) {
        const senderData = req.senderData as
          | { url?: string; mainFrameOrigin?: string }
          | undefined;
        const isFlagged =
          checkDomain(senderData?.url ?? "").isDomainPhishing ||
          (senderData?.mainFrameOrigin
            ? checkDomain(senderData.mainFrameOrigin).isDomainPhishing
            : false);
        if (isFlagged) {
          return { hasCompleted: false };
        }
      }

      // Drop permitted accounts that no longer exist in the wallet. Stored
      // order is preserved because dApps treat the first entry as active.
      const walletAccounts = new Set(
        [
          ...(await StorageUtil.getAllAccounts()),
          ...(await StorageUtil.getLedgerAccounts()).map(
            (account) => account.address,
          ),
        ].map((address) => address.toLowerCase()),
      );
      const liveAccounts = storedAccounts.filter((address) =>
        walletAccounts.has(address.toLowerCase()),
      );
      if (liveAccounts.length === 0) {
        return { hasCompleted: false };
      }
      if (liveAccounts.length !== storedAccounts.length) {
        // Prune the record so qrl_accounts and the permission caveats agree
        // with what this silent completion just returned.
        await updateAccountsAndBlockchainsForUrlOrigin({
          urlOrigin,
          accounts: liveAccounts,
          blockchains: stored?.blockchains ?? [],
        });
      }
      return {
        hasCompleted: true,
        completionResult: liveAccounts,
      };
    } catch {
      // Any failure in the silent path degrades to the approval popup.
      return { hasCompleted: false };
    }
  } else {
    return {
      hasCompleted: false,
    };
  }
};

// a precheck to determine if the request can proceed
const checkRequestCanProceed = async (req: JsonRpcRequest<JsonRpcRequest>) => {
  if (QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS.includes(req.method)) {
    const originConnectResult = await checkUrlOriginHasBeenConnected(
      req?.senderData?.url ?? "",
    );
    if (!originConnectResult.canProceed) {
      return originConnectResult;
    }
  }
  switch (req.method) {
    case RESTRICTED_METHODS.WALLET_ADD_QRL_CHAIN:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return await checkWalletAddQrlChainParams(req?.params?.[0]);
    case RESTRICTED_METHODS.WALLET_SWITCH_QRL_CHAIN:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return await checkWalletSwitchQrlChainParams(req?.params?.[0]);
    case RESTRICTED_METHODS.WALLET_WATCH_ASSET:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return await checkWalletWatchAssetParams(req?.params?.[0]);
    case RESTRICTED_METHODS.WALLET_REQUEST_PERMISSIONS:
      // @ts-expect-error - params is typed as JsonRpcParams but is an array at runtime for this RPC method
      return await checkWalletRequestPermissionParams(req?.params?.[0]);
    case RESTRICTED_METHODS.WALLET_GET_CAPABILITIES:
      return await checkAccountHasBeenAuthorized(req);
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4:
    case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA:
      return {
        canProceed: false,
        proceedError: providerErrors.unsupportedMethod({
          message:
            "Typed-data signing is unavailable for QIP-55 until a versioned 64-byte address layout is defined.",
        }),
      };
    case RESTRICTED_METHODS.QRL_SEND_TRANSACTION:
    case RESTRICTED_METHODS.QRL_SIGN_MESSAGE:
    case RESTRICTED_METHODS.PERSONAL_SIGN:
      return await checkAccountAndChainHaveBeenAuthorized(req);
    default:
      return {
        canProceed: true,
        proceedError: undefined,
      };
  }
};

/**
 * Idle timeout: the approval surface never connected its lifecycle port
 * (openPopup() can fail silently) and the user never acted, so the approval
 * slot has to come back on its own.
 */
export const POPUP_RESPONSE_TIMEOUT_MS = 90 * 1000;

/**
 * Backstop once the user has clicked. Signing with ML-DSA-87 and waiting on
 * a node broadcast takes seconds, and this only has to be longer than the
 * slowest honest click-to-answer path while still bounding a wedged
 * approval surface so it cannot hold the approval slot indefinitely.
 */
export const APPROVAL_IN_PROGRESS_TIMEOUT_MS = 3 * 60 * 1000;

// get the result of the user approval/rejection of the request
const getRestrictedMethodResult = async (
  req: JsonRpcRequest<JsonRpcRequest>,
  authorizedChainId?: string,
): Promise<DAppResponseType> => {
  const settings = await StorageUtil.getSettings();
  const phishingEnabled = settings.phishingDetectionEnabled !== false;
  // Phishing is checked against both the requesting frame origin AND the
  // parent tab origin. A phishing top-level page hosting a connected dApp's
  // iframe is a real attack vector that frame-origin-only checking misses.
  const senderData = req.senderData as
    | {
        url?: string;
        mainFrameOrigin?: string;
      }
    | undefined;
  const frameResult = phishingEnabled
    ? checkDomain(senderData?.url ?? "")
    : { isDomainPhishing: false };
  const parentResult =
    phishingEnabled && senderData?.mainFrameOrigin
      ? checkDomain(senderData.mainFrameOrigin)
      : { isDomainPhishing: false };
  const phishingResult = {
    isDomainPhishing:
      frameResult.isDomainPhishing || parentResult.isDomainPhishing,
    matchType: frameResult.isDomainPhishing
      ? frameResult.matchType
      : parentResult.matchType,
    matchedDomain: frameResult.isDomainPhishing
      ? frameResult.matchedDomain
      : parentResult.matchedDomain,
    detectorStatus: frameResult.detectorStatus ?? parentResult.detectorStatus,
  };
  const requestId = uuid();
  const request: DAppRequestType = {
    method: req.method,
    params: req.params,
    requestData: { senderData: req.senderData },
    phishingResult,
    requestId,
    authorizedChainId,
  };

  // The request must be in session storage BEFORE the surface opens so a
  // freshly-created popup/window/panel finds it on mount.
  await StorageUtil.setDAppsRequestData(request);
  // The tab id lets the side-panel path ask that tab to forward the user
  // gesture; it stays UI-only context and is no part of any trust decision.
  await openApprovalSurface({ tabId: req.senderData?.tabId });

  return new Promise((resolve) => {
    let popupPort: browser.Runtime.Port | undefined;
    // Set by the DAPP_REQUEST_IN_PROGRESS message the approval surface
    // posts the instant the user clicks. From that point the wallet is
    // signing and broadcasting for this request, so neither the idle
    // timeout nor a torn-down surface may answer on the user's behalf.
    let userHasActed = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      browser.runtime.onMessage.removeListener(handleMessage);
      browser.runtime.onConnect.removeListener(handlePortConnect);
      popupPort?.onDisconnect.removeListener(handlePortDisconnect);
    };

    const abandon = async (reason: string) => {
      cleanup();
      console.warn(`QrlWeb3Wallet: dApp request abandoned (${reason})`);
      try {
        // Scoped to this requestId: by the time a long-running approval
        // gives up, the slot may already hold somebody else's request.
        await StorageUtil.clearDAppsRequestDataForRequestId(requestId);
      } catch {
        // best-effort cleanup
      }
      resolve({
        method: req.method,
        action: EXTENSION_MESSAGES.DAPP_RESPONSE,
        hasApproved: false,
        requestId,
      });
    };

    function handleMessage(message: DAppResponseType) {
      // Every branch is keyed by requestId, so a message left over from an
      // approval that already ended cannot answer the current one.
      if (message.requestId !== requestId) return;
      if (message.action === EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS) {
        if (userHasActed) return;
        userHasActed = true;
        clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(
          () => void abandon("no response after the user acted"),
          APPROVAL_IN_PROGRESS_TIMEOUT_MS,
        );
        return;
      }
      if (message.action === EXTENSION_MESSAGES.DAPP_RESPONSE) {
        cleanup();
        resolve(message);
      }
    }

    function handlePortConnect(port: browser.Runtime.Port) {
      if (port.name === DAPP_REQUEST_PORT_NAME) {
        popupPort = port;
        port.onDisconnect.addListener(handlePortDisconnect);
      }
    }

    async function handlePortDisconnect() {
      // A surface that goes away before the user acted is a rejection: the
      // user closed the popup. A surface that goes away after the click is
      // the ordinary self-close once the response has been posted, and on
      // the rare path where the click's work is still running, answering
      // 4001 here would tell the dApp its transaction was rejected while
      // the broadcast is on the wire. The in-progress backstop bounds that
      // case instead.
      if (userHasActed) return;
      cleanup();
      try {
        await StorageUtil.clearDAppsRequestDataForRequestId(requestId);
      } catch {
        // best-effort cleanup
      }
      resolve({
        method: req.method,
        action: EXTENSION_MESSAGES.DAPP_RESPONSE,
        hasApproved: false,
        requestId,
      });
    }

    timeoutHandle = setTimeout(
      () => void abandon("no user response"),
      POPUP_RESPONSE_TIMEOUT_MS,
    );
    // Listen for the approval/rejection from the UI, plus the popup's
    // lifecycle port so we can resolve immediately when it disconnects.
    browser.runtime.onMessage.addListener(handleMessage);
    browser.runtime.onConnect.addListener(handlePortConnect);
  });
};

type RestrictedMethodValue =
  (typeof RESTRICTED_METHODS)[keyof typeof RESTRICTED_METHODS];

export const restrictedMethodsMiddleware: JsonRpcMiddleware<
  JsonRpcRequest,
  Json
> = async (req, res, next, end) => {
  const requestedMethod = req.method;
  if (
    Object.values(RESTRICTED_METHODS).includes(
      requestedMethod as RestrictedMethodValue,
    )
  ) {
    const requesterOrigin = resolveTrustedSenderOrigin({
      origin: req.senderData?.url,
    });
    if (!requesterOrigin) {
      res.error = providerErrors.unauthorized({
        message: "The requesting origin is unavailable.",
      });
      return end();
    }
    // Claimed before the first await: the precheck and the silent-completion
    // check below both suspend, and two requests that arrived in the same
    // tick used to sail past a flag set only after them.
    const slotClaim = claimApprovalSlot(requesterOrigin, req.senderData?.tabId);
    if (!slotClaim.claimed) {
      if (slotClaim.reason === "cooldown") {
        // The origin just had an approval rejected or time out. Opening a
        // surface here would let one page reopen the wallet in a loop.
        res.error = rpcErrors.resourceUnavailable({
          message:
            "The wallet is still dismissing this site's previous request. Try again in a moment.",
        });
        return end();
      }
      try {
        // Raise the surface for the tab that owns the pending request. The
        // requesting tab's own id would put another site's approval prompt
        // in this tab's side panel.
        await openApprovalSurface({ tabId: slotClaim.pendingTabId });
      } finally {
        res.error = providerErrors.unsupportedMethod({
          message: "A request is already pending",
        });
      }
      return end();
    }
    // Only an approval the user actually saw and turned down (or left to
    // time out) arms the per-origin cooldown. A precheck rejection or a
    // silent completion never reached the user, so it must not throttle the
    // origin's next request.
    let approvalWasRefused = false;
    try {
      // check if the request can proceed
      const precheckResult = await checkRequestCanProceed(req);
      const { canProceed, proceedError } = precheckResult;
      const authorizedChainId =
        "authorizedChainId" in precheckResult
          ? (precheckResult.authorizedChainId as string | undefined)
          : undefined;
      if (!canProceed) {
        // @ts-expect-error - proceedError type from provider library is not assignable to res.error's narrow type
        res.error = proceedError;
        return end();
      }

      // check if the request can complete silently without user interaction
      const { hasCompleted, completionResult, completionError } =
        await checkRequestCanCompleteSilently(req);
      if (hasCompleted) {
        res.result = completionResult;
        return end();
      } else if (completionError) {
        // @ts-expect-error - completionError type from rpcErrors is not assignable to res.error's narrow type
        res.error = completionError;
        return end();
      }

      // open the popup and wait for the user to approve/reject the request
      let restrictedMethodResult: DAppResponseType = {
        method: "",
        action: "",
        hasApproved: false,
      };
      try {
        restrictedMethodResult = await getRestrictedMethodResult(
          req,
          authorizedChainId,
        );
      } finally {
        const hasApproved = restrictedMethodResult?.hasApproved;
        approvalWasRefused = !hasApproved;
        if (hasApproved) {
          switch (restrictedMethodResult?.method) {
            case RESTRICTED_METHODS.WALLET_ADD_QRL_CHAIN:
            case RESTRICTED_METHODS.WALLET_SWITCH_QRL_CHAIN: {
              const switchApproved = !!restrictedMethodResult?.response?.result;
              res.result = switchApproved ? null : false;
              break;
            }
            case RESTRICTED_METHODS.WALLET_WATCH_ASSET: {
              const hasAddedAsset = !!restrictedMethodResult?.response?.result;
              res.result = hasAddedAsset;
              break;
            }
            case RESTRICTED_METHODS.QRL_REQUEST_ACCOUNTS: {
              const accounts = await updateAccountsAndBlockchainsForUrlOrigin({
                urlOrigin: new URL(req?.senderData?.url ?? "").origin,
                accounts: restrictedMethodResult?.response?.accounts,
                blockchains: restrictedMethodResult?.response?.blockchains,
              });
              res.result = accounts;
              break;
            }
            case RESTRICTED_METHODS.WALLET_REQUEST_PERMISSIONS: {
              const urlOrigin = new URL(req?.senderData?.url ?? "").origin;
              await updateAccountsAndBlockchainsForUrlOrigin({
                urlOrigin,
                accounts: restrictedMethodResult?.response?.accounts,
                blockchains: restrictedMethodResult?.response?.blockchains,
              });
              const dAppConnectedAccountsData =
                await StorageUtil.getDAppsConnectedAccountsData(urlOrigin);
              res.result = dAppConnectedAccountsData?.permissions ?? [];
              break;
            }
            case RESTRICTED_METHODS.QRL_SEND_TRANSACTION: {
              const response = restrictedMethodResult?.response;
              const transactionHash = response?.transactionHash;
              const pendingTransactionHash =
                extractPendingDAppTransactionHash(response);
              if (transactionHash) {
                res.result = transactionHash;
              } else {
                // rpcErrors.transactionRejected (-32003, EIP-1474) fits a
                // qrl_sendTransaction that failed to complete (node
                // rejection, signing failure or broadcast timeout) far
                // better than unsupportedMethod (4200), which claims the
                // wallet does not support the method at all. A user
                // rejection is handled separately above
                // (providerErrors.userRejectedRequest, 4001) and is
                // unaffected.
                // @ts-expect-error - rpcErrors' JsonRpcError type is not assignable to res.error's narrow type
                res.error = rpcErrors.transactionRejected({
                  message: response?.error?.message,
                  data: buildDAppSendTransactionErrorData(response),
                });
              }
              // Registers the watch either way: on a result, for the hash
              // just answered; on a broadcast-timeout error, for the hash
              // extracted from it (extractPendingDAppTransactionHash), so
              // the service worker still confirms and notifies a
              // transaction that may have landed despite the dApp getting
              // an error. registerDAppTransactionWatchIfApproved never
              // throws, so this cannot stop `end()` below from running.
              await registerDAppTransactionWatchIfApproved(
                req,
                transactionHash ?? pendingTransactionHash,
                authorizedChainId,
              );
              break;
            }
            case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4:
            case RESTRICTED_METHODS.QRL_SIGN_MESSAGE:
            case RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA:
            case RESTRICTED_METHODS.PERSONAL_SIGN: {
              const signedData = restrictedMethodResult?.response;
              // A rejected approval (e.g. the chain-authorization
              // revalidation guard) stores { error } here. Surface it as a
              // JSON-RPC error, otherwise the dApp resolves successfully with
              // an error-shaped object and never learns the request failed.
              if (signedData?.error) {
                res.error = providerErrors.unsupportedMethod({
                  message: signedData.error?.message,
                  data: signedData.error,
                });
              } else if (signedData) {
                res.result = signedData;
              } else {
                res.error = providerErrors.unsupportedMethod({
                  message: restrictedMethodResult?.response?.error?.message,
                  data: restrictedMethodResult?.response?.error,
                });
              }
              break;
            }
            default:
              res.error = providerErrors.unsupportedMethod();
              break;
          }
        } else {
          res.error = providerErrors.userRejectedRequest();
        }
      }
      return end();
    } finally {
      // An approval that ended without the user approving it is an outcome
      // a hostile page can produce on demand, so that origin backs off
      // before it may take the slot again.
      releaseApprovalSlot({ startCooldown: approvalWasRefused });
    }
  } else {
    next();
  }
};
