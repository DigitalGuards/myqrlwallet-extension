import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { rpcErrors } from "@theqrl/qrl-wallet-provider/rpc-errors";
import { Json, JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import { ALL_REQUEST_METHODS } from "../constants/requestConstants";

const supportedMethodNames = new Set<string>(ALL_REQUEST_METHODS);

export const blockUnSupportedMethodsMiddleware: JsonRpcMiddleware<
  JsonRpcRequest,
  Json
> = (req, res, next, end) => {
  const requestedMethod: unknown = req.method;
  if (
    typeof requestedMethod === "string" &&
    requestedMethod.length > 0 &&
    supportedMethodNames.has(requestedMethod)
  ) {
    next();
  } else {
    res.error = rpcErrors.methodNotFound({
      message: `The method "${String(requestedMethod)}" does not exist / is not available.`,
    });
    end();
  }
};
