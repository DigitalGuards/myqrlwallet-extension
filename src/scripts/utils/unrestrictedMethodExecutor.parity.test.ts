import { afterEach, describe, expect, it, vi } from "vitest";
import { echoRpcResult } from "@/test-utils/rpcReply";
import { HttpProvider } from "@theqrl/web3-providers-http";
import { toChecksumAddress } from "@theqrl/web3-utils";
import { JsonRpcEngine } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import type { Json } from "@theqrl/qrl-wallet-provider/utils";
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

const ADDRESS = toChecksumAddress(`Q${"a".repeat(128)}`);
const HASH = `0x${"11".repeat(32)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

// The middleware also receives the byte-array and bigint inputs accepted by
// Web3. The engine's published JSON request type omits those runtime inputs.
const throughMiddleware = (method: string, params: unknown[]) => {
  const engine = new JsonRpcEngine();
  engine.push(unrestrictedMethodsMiddleware);
  const runtimeEngine: {
    handle(request: {
      id: number | string | null;
      jsonrpc: "2.0";
      method: string;
      params?: unknown;
    }): Promise<unknown>;
  } = engine;
  return runtimeEngine.handle({ id: 1, jsonrpc: "2.0", method, params });
};

// Only the HTTP response is controlled.
describe.each([
  { method: METHODS.QRL_CALL, result: "0x1234" },
  { method: METHODS.QRL_ESTIMATE_GAS, result: "0x5208" },
])("$method simulation metadata compatibility", ({ method, result }) => {
  describe.each([
    { field: "chain", metadata: (value: string) => ({ chain: value }) },
    { field: "hardfork", metadata: (value: string) => ({ hardfork: value }) },
    {
      field: "common.baseChain",
      metadata: (value: string) => ({ common: { baseChain: value } }),
    },
    {
      field: "common.hardfork",
      metadata: (value: string) => ({ common: { hardfork: value } }),
    },
    {
      field: "common.customChain.name",
      metadata: (value: string) => ({
        common: { customChain: { name: value } },
      }),
    },
  ])("$field", ({ metadata }) => {
    it.each(["mainnet", "zond", "testnet", "london", "custom-chain", ""])(
      "preserves string metadata %j through executor and middleware",
      async (value) => {
        const transaction = {
          to: ADDRESS,
          value: "0x0",
          gas: "0x5208",
          ...metadata(value),
        };
        const snapshot = structuredClone(transaction);
        const send = vi
          .spyOn(HttpProvider.prototype, "request")
          .mockImplementation(echoRpcResult(result));

        await expect(
          executeUnrestrictedMethod({ method, params: [transaction] }),
        ).resolves.toBe(result);
        expect(send).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ method, params: [snapshot, "latest"] }),
        );
        expect(transaction).toEqual(snapshot);

        send.mockClear();
        await expect(throughMiddleware(method, [transaction])).resolves.toEqual(
          {
            id: 1,
            jsonrpc: "2.0",
            result,
          },
        );
        expect(send).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ method, params: [snapshot, "latest"] }),
        );
        expect(transaction).toEqual(snapshot);
      },
    );

    it("preserves RPC failure delivery for string metadata", async () => {
      const transaction = { to: ADDRESS, ...metadata("custom-chain") };
      const snapshot = structuredClone(transaction);
      const error = new Error("Simulation RPC unavailable");
      const send = vi
        .spyOn(HttpProvider.prototype, "request")
        .mockRejectedValue(error);

      await expect(
        executeUnrestrictedMethod({ method, params: [transaction] }),
      ).rejects.toBe(error);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ method, params: [snapshot, "latest"] }),
      );

      send.mockClear();
      await expect(
        throughMiddleware(method, [transaction]),
      ).resolves.toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        error: { code: 4200, message: error.message },
      });
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ method, params: [snapshot, "latest"] }),
      );
      expect(transaction).toEqual(snapshot);
    });
  });
});

const TX_HASH = `0x${"22".repeat(32)}`;

// A transaction reply @theqrl/web3 2.0.0 accepts for the requested block and
// index: it names the requested block hash or number and the requested index.
const replyFor = (rpcBlock: string, hexIndex: string) => ({
  hash: TX_HASH,
  blockHash: rpcBlock.length === HASH.length ? rpcBlock : HASH,
  blockNumber:
    /^0x[0-9a-f]+$/.test(rpcBlock) && rpcBlock.length !== HASH.length
      ? rpcBlock
      : "0x5",
  transactionIndex: hexIndex,
  value: "0x1",
});

describe.each([
  METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
  METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
])("%s indexed lookup responses", (method) => {
  const reply = replyFor("latest", "0x0");
  describe.each([
    {
      name: "executor",
      run: (params: unknown[]) => executeUnrestrictedMethod({ method, params }),
      wrap: (result: unknown) => result,
      expectFailure: (outcome: Promise<unknown>, message: string) =>
        expect(outcome).rejects.toThrow(message),
    },
    {
      name: "middleware",
      run: (params: unknown[]) => throughMiddleware(method, params),
      wrap: (result: unknown) => ({ id: 1, jsonrpc: "2.0", result }),
      expectFailure: (outcome: Promise<unknown>, message: string) =>
        expect(outcome).resolves.toMatchObject({
          id: 1,
          jsonrpc: "2.0",
          error: { code: 4200, message: expect.stringContaining(message) },
        }),
    },
  ])("$name", ({ run, wrap, expectFailure }) => {
    it.each([
      { block: HASH, rpcBlock: HASH, byHash: true },
      { block: new Uint8Array(32).fill(17), rpcBlock: HASH, byHash: true },
      { block: 1, rpcBlock: "0x1", byHash: false },
      { block: 1n, rpcBlock: "0x1", byHash: false },
      { block: "0x1", rpcBlock: "0x1", byHash: false },
      { block: "latest", rpcBlock: "latest", byHash: false },
      { block: undefined, rpcBlock: "latest", byHash: false },
    ])(
      "returns the transaction for block $block and every index representation",
      async ({ block, rpcBlock, byHash }) => {
        const send = vi.spyOn(HttpProvider.prototype, "request");
        for (const index of [0, 0n, "0x0"]) {
          send
            .mockClear()
            .mockImplementation(echoRpcResult(replyFor(rpcBlock, "0x0")));
          const params = [block, index];
          const snapshot = structuredClone(params);
          await expect(run(params)).resolves.toEqual(
            wrap(replyFor(rpcBlock, "0x0")),
          );
          expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              method: byHash
                ? METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX
                : METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
              params: [rpcBlock, "0x0"],
            }),
          );
          expect(structuredClone(params)).toEqual(snapshot);
        }
      },
    );

    it("returns null for an index the block does not have", async () => {
      vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
        echoRpcResult(null),
      );
      await expect(run(["latest", 9])).resolves.toEqual(wrap(null));
    });

    it("waits for a stalled RPC before it returns the transaction", async () => {
      let completeRpc: (() => void) | undefined;
      const release = new Promise<void>((resolve) => {
        completeRpc = resolve;
      });
      const send = vi
        .spyOn(HttpProvider.prototype, "request")
        .mockImplementation((payload) =>
          release.then(() => echoRpcResult(reply)(payload)),
        );
      let settled = false;
      const pending = run(["latest", "0x0"]).then((response) => {
        settled = true;
        return response;
      });

      try {
        await vi.waitFor(() => {
          expect(send).toHaveBeenCalledOnce();
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(settled).toBe(false);
      } finally {
        completeRpc?.();
      }
      await expect(pending).resolves.toEqual(wrap(reply));
      expect(send).toHaveBeenCalledOnce();
    });

    it.each([
      {
        label: "another block hash",
        block: HASH,
        patch: { blockHash: `0x${"33".repeat(32)}` },
      },
      {
        label: "another block number",
        block: 5,
        patch: { blockNumber: "0x9" },
      },
      {
        label: "another transaction index",
        block: HASH,
        patch: { transactionIndex: "0x1" },
      },
    ])("refuses a reply for $label", async ({ block, patch }) => {
      vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
        echoRpcResult({
          ...replyFor(block === 5 ? "0x5" : HASH, "0x0"),
          ...patch,
        }),
      );
      await expectFailure(run([block, 0]), "Invalid JSON-RPC response");
    });

    it("delivers an RPC failure to the caller", async () => {
      const error = new Error("RPC refused the transaction lookup.");
      vi.spyOn(HttpProvider.prototype, "request").mockRejectedValue(error);
      await expectFailure(run(["latest", 0]), error.message);
    });
  });
});
