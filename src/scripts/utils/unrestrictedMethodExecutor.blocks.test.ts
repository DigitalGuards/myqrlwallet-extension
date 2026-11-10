import { afterEach, describe, expect, it, vi } from "vitest";
import { echoRpcResult } from "@/test-utils/rpcReply";
import { HttpProvider } from "@theqrl/web3-providers-http";
import { JsonRpcEngine } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { V3_CHAIN_ID } from "@/configuration/releaseProfile";
import { UNRESTRICTED_METHODS as METHODS } from "../constants/requestConstants";
import { unrestrictedMethodsMiddleware } from "../middlewares/unrestrictedMethodsMiddleware";
import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getActiveBlockChain: () =>
      Promise.resolve({
        chainId: V3_CHAIN_ID,
        defaultRpcUrl: "https://rpc.example",
      }),
  },
}));

vi.mock("../lockManager/lockManager", () => ({ default: {} }));

const HASH = `0x${"11".repeat(32)}`;
const TX_HASH = `0x${"22".repeat(32)}`;

// A transaction reply @theqrl/web3 2.0.0 accepts for block HASH at index 0.
const TRANSACTION_REPLY = {
  hash: TX_HASH,
  blockHash: HASH,
  blockNumber: "0x5",
  transactionIndex: "0x0",
  value: "0x1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  {
    method: METHODS.QRL_GET_BLOCK_BY_HASH,
    rpcMethod: METHODS.QRL_GET_BLOCK_BY_HASH,
    extraParams: [true],
    // @theqrl/web3 2.0.0 refuses a block whose hash is not the requested one.
    result: { number: "0x1", hash: HASH },
  },
  {
    method: METHODS.QRL_GET_BLOCK_BY_NUMBER,
    rpcMethod: METHODS.QRL_GET_BLOCK_BY_HASH,
    extraParams: [false],
    result: { number: "0x1", hash: HASH },
  },
  {
    method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
    rpcMethod: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
    extraParams: [],
    result: "0x2",
  },
  {
    method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
    rpcMethod: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
    extraParams: [],
    result: "0x2",
  },
  {
    method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    rpcMethod: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    extraParams: ["0x0"],
    result: TRANSACTION_REPLY,
  },
  {
    method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
    rpcMethod: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    extraParams: ["0x0"],
    result: TRANSACTION_REPLY,
  },
])(
  "$method through installed Web3",
  ({ method, rpcMethod, extraParams, result, expected = result }) => {
    it.each([HASH, new Uint8Array(32).fill(17)])(
      "preserves block hash input %s and the method result",
      async (hash) => {
        const send = vi
          .spyOn(HttpProvider.prototype, "request")
          .mockImplementation(echoRpcResult(result));
        const params = [hash, ...extraParams];
        const snapshot = params.map((param) =>
          param instanceof Uint8Array ? new Uint8Array(param) : param,
        );

        await expect(
          executeUnrestrictedMethod({ method, params }),
        ).resolves.toEqual(expected);
        expect(send).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            method: rpcMethod,
            params: [HASH, ...extraParams],
          }),
        );
        expect(params).toEqual(snapshot);
      },
    );

    it.each([null, {}, false, [17], new Uint16Array(32)])(
      "rejects malformed block identifiers (%s) before RPC",
      async (block) => {
        const send = vi.spyOn(HttpProvider.prototype, "request");

        await expect(
          executeUnrestrictedMethod({
            method,
            params: [block, ...extraParams],
          }),
        ).rejects.toThrow("Invalid QRL RPC parameter.");
        expect(send).not.toHaveBeenCalled();
      },
    );
  },
);

describe.each([
  METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
  METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
])("%s indexed transaction completion", (method) => {
  const rpcMethod = METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX;
  const runThroughEngine = () => {
    const engine = new JsonRpcEngine();
    engine.push(unrestrictedMethodsMiddleware);
    return engine.handle({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: ["latest", "0x0"],
    });
  };

  it("completes the middleware request after the RPC returns the transaction", async () => {
    let completeRpc: (() => void) | undefined;
    const rpcPending = new Promise<void>((resolve) => {
      completeRpc = resolve;
    });
    const send = vi
      .spyOn(HttpProvider.prototype, "request")
      .mockImplementation((payload) =>
        rpcPending.then(() => echoRpcResult(TRANSACTION_REPLY)(payload)),
      );
    let settled = false;
    const pending = runThroughEngine().finally(() => {
      settled = true;
    });

    try {
      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            method: rpcMethod,
            params: ["latest", "0x0"],
          }),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
    } finally {
      completeRpc?.();
    }

    await expect(pending).resolves.toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: TRANSACTION_REPLY,
    });
  });

  it("answers null through the middleware for an index the block does not have", async () => {
    vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
      echoRpcResult(null),
    );

    await expect(runThroughEngine()).resolves.toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: null,
    });
  });

  it("answers the middleware request with an error object when the RPC fails", async () => {
    const error = new Error("RPC refused the transaction lookup.");
    vi.spyOn(HttpProvider.prototype, "request").mockRejectedValue(error);

    await expect(runThroughEngine()).resolves.toMatchObject({
      id: 1,
      jsonrpc: "2.0",
      error: { code: 4200, message: error.message },
    });
  });

  it.each([
    {
      label: "another block hash",
      reply: { blockHash: `0x${"33".repeat(32)}` },
      block: HASH,
    },
    { label: "another block number", reply: { blockNumber: "0x9" }, block: 5 },
    {
      label: "another transaction index",
      reply: { transactionIndex: "0x1" },
      block: HASH,
    },
  ])("refuses a reply for $label", async ({ reply, block }) => {
    vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
      echoRpcResult({ ...TRANSACTION_REPLY, ...reply }),
    );

    await expect(
      executeUnrestrictedMethod({ method, params: [block, "0x0"] }),
    ).rejects.toThrow("Invalid JSON-RPC response");
  });
});
