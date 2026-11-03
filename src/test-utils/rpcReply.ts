import type { JsonRpcId } from "@theqrl/web3-types";
import { isRecord } from "@/utilities/storageGuards";

type RpcSuccess<T> = { jsonrpc: "2.0"; id: JsonRpcId; result: T };

const readRequestId = (payload: unknown): JsonRpcId =>
  isRecord(payload) &&
  (typeof payload.id === "string" || typeof payload.id === "number")
    ? payload.id
    : undefined;

/**
 * A JSON-RPC success reply for a mocked provider `request`, carrying the
 * request's own id the way a node does. @theqrl/web3 2.0.0 refuses a reply
 * whose id differs from the request's with an InvalidResponseError, so a
 * canned `{ id: 1 }` reply no longer stands in for one.
 */
export const echoRpcResult =
  <T>(result: T) =>
  (payload: unknown): Promise<RpcSuccess<T>> =>
    Promise.resolve({ jsonrpc: "2.0", id: readRequestId(payload), result });
