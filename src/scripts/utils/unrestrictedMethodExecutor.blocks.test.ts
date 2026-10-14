import { afterEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  {
    method: METHODS.QRL_GET_BLOCK_BY_HASH,
    rpcMethod: METHODS.QRL_GET_BLOCK_BY_HASH,
    extraParams: [true],
    result: { number: "0x1" },
  },
  {
    method: METHODS.QRL_GET_BLOCK_BY_NUMBER,
    rpcMethod: METHODS.QRL_GET_BLOCK_BY_HASH,
    extraParams: [false],
    result: { number: "0x1" },
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
    result: { hash: HASH, value: "0x1" },
    expected: {},
  },
  {
    method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
    rpcMethod: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    extraParams: ["0x0"],
    result: { hash: HASH, value: "0x1" },
    expected: {},
  },
])(
  "$method through installed Web3",
  ({ method, rpcMethod, extraParams, result, expected = result }) => {
    it.each([HASH, new Uint8Array(32).fill(17)])(
      "preserves block hash input %s and the method result",
      async (hash) => {
        const send = vi
          .spyOn(Web3.providers.HttpProvider.prototype, "request")
          .mockResolvedValue({ jsonrpc: "2.0", id: 1, result });
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
        const send = vi.spyOn(Web3.providers.HttpProvider.prototype, "request");

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
  it.each(["success", "failure"])(
    "completes the middleware request before RPC %s",
    async (outcome) => {
      let completeRpc: (() => void) | undefined;
      const rpcPending = new Promise<void>((resolve) => {
        completeRpc = resolve;
      });
      const result = { hash: HASH, value: "0x1" };
      const error = new Error("RPC refused the transaction lookup.");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi
        .spyOn(Web3.providers.HttpProvider.prototype, "request")
        .mockReturnValue(
          rpcPending.then(() => {
            if (outcome === "failure") {
              throw error;
            }
            return { jsonrpc: "2.0", id: 1, result };
          }),
        );
      const engine = new JsonRpcEngine();
      engine.push(unrestrictedMethodsMiddleware);
      let settled = false;
      const pending = engine
        .handle({ id: 1, jsonrpc: "2.0", method, params: ["latest", "0x0"] })
        .finally(() => {
          settled = true;
        });

      try {
        await vi.waitFor(() => {
          expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
              params: ["latest", "0x0"],
            }),
          );
          expect(settled).toBe(true);
        });
        await expect(pending).resolves.toEqual({
          id: 1,
          jsonrpc: "2.0",
          result: {},
        });
        expect(report).not.toHaveBeenCalled();
      } finally {
        completeRpc?.();
      }

      if (outcome === "success") {
        await expect(pending).resolves.toEqual({
          id: 1,
          jsonrpc: "2.0",
          result: {},
        });
        expect(report).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => {
          expect(report).toHaveBeenCalledExactlyOnceWith(
            "QrlWeb3Wallet: Failed to look up transaction:",
            error,
          );
        });
        await expect(pending).resolves.toEqual({
          id: 1,
          jsonrpc: "2.0",
          result: {},
        });
      }
    },
  );
});
