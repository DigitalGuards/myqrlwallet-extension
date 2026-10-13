import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { providerErrors } from "@theqrl/qrl-wallet-provider/rpc-errors";
import {
  Json,
  JsonRpcRequest,
  isValidJson,
} from "@theqrl/qrl-wallet-provider/utils";
import { isApprovalSender } from "@/utilities/approvalGuards";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";
import { checkUrlOriginHasBeenConnected } from "../utils/restrictedMethodsMiddlewareUtils";
import { executeUnrestrictedMethod } from "../utils/unrestrictedMethodExecutor";
import LockManager from "../lockManager/lockManager";

const QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS: string[] = [
  UNRESTRICTED_METHODS.QRL_ACCOUNTS,
];

// a precheck to determine if the request can proceed
const checkRequestCanProceed = async (req: JsonRpcRequest<JsonRpcRequest>) => {
  if (QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS.includes(req.method)) {
    // A locked wallet answers qrl_accounts with an empty array for every
    // origin (the F8 rule in unrestrictedMethodExecutor). Running the
    // connection gate while locked would answer a connected origin with
    // that empty array and an unconnected one with "not connected", which
    // is the grant state the locked wallet is supposed to withhold. An
    // unreadable lock state takes the same path, since the empty array is
    // the safe answer either way.
    let isLocked = true;
    try {
      ({ isLocked } = await LockManager.isLocked());
    } catch {
      isLocked = true;
    }
    if (!isLocked) {
      const originConnectResult = await checkUrlOriginHasBeenConnected(
        isApprovalSender(req.senderData) ? (req.senderData.url ?? "") : "",
      );
      if (!originConnectResult.canProceed) {
        return originConnectResult;
      }
    }
  }
  return {
    canProceed: true,
    proceedError: providerErrors.unsupportedMethod<never>(),
  };
};

// Executed directly in the service worker. The previous implementation
// bounced these calls to the content script via browser.tabs.sendMessage,
// where the RPC fetch ran in the page context and was therefore subject
// to the dApp page's CORS: any origin the RPC endpoint didn't allowlist
// got a 403 preflight and the provider broke with "Failed to get initial
// state". Service-worker fetches carry the extension's own context and
// bypass page CORS through host_permissions.
const getUnrestrictedMethodResult = async (
  req: JsonRpcRequest<JsonRpcRequest>,
) => {
  const result: unknown = await executeUnrestrictedMethod(req);
  if (!isValidJson(result)) {
    throw new Error("The wallet cannot parse the RPC response.");
  }
  return result;
};

const unrestrictedMethodNames = new Set<string>(
  Object.values(UNRESTRICTED_METHODS),
);

type UnrestrictedMethodsMiddleware = (
  ...args: Parameters<JsonRpcMiddleware<JsonRpcRequest, Json>>
) => Promise<void>;

const runUnrestrictedMethodsMiddleware: UnrestrictedMethodsMiddleware = async (
  req,
  res,
  next,
  end,
) => {
  const requestedMethod = req.method;
  if (unrestrictedMethodNames.has(requestedMethod)) {
    // check if the request can proceed
    const { canProceed, proceedError } = await checkRequestCanProceed(req);
    if (!canProceed) {
      res.error = proceedError;
      end();
      return;
    }

    try {
      res.result = await getUnrestrictedMethodResult(req);
    } catch (error: unknown) {
      res.error = providerErrors.unsupportedMethod({
        message: error instanceof Error ? error.message : String(error),
      });
    }
    end();
    return;
  } else {
    next();
  }
};

// The engine completes requests through callbacks and does not await middleware.
export const unrestrictedMethodsMiddleware: JsonRpcMiddleware<
  JsonRpcRequest,
  Json
> = (req, res, next, end) => {
  runUnrestrictedMethodsMiddleware(req, res, next, end).catch(
    (error: unknown) => {
      end(error instanceof Error ? error : new Error(String(error)));
    },
  );
};
