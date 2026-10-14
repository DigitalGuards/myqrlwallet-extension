import { afterEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
import type { Transaction } from "@theqrl/web3-types";
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
const CUSTOM_CHAIN = { chainId: V3_CHAIN_ID, networkId: 3151909 };
const NORMALIZED_CUSTOM_CHAIN = {
  chainId: V3_CHAIN_ID,
  networkId: V3_CHAIN_ID,
};
const nullableFields = [
  "from",
  "to",
  "value",
  "gas",
  "type",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "chainId",
  "networkId",
  "gasLimit",
  "data",
  "input",
  "descriptor",
  "extraParams",
  "signature",
  "publicKey",
  "accessList",
  "common",
  "chain",
  "hardfork",
] satisfies (keyof Transaction)[];

const mockRpc = (result: string) =>
  vi
    .spyOn(Web3.providers.HttpProvider.prototype, "request")
    .mockResolvedValue({ jsonrpc: "2.0", id: 1, result });

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { method: METHODS.QRL_ESTIMATE_GAS, result: "0x5208" },
  { method: METHODS.QRL_CALL, result: "0x1234" },
])("$method through installed Web3", ({ method, result }) => {
  it.each(nullableFields)(
    "normalizes a null %s field before sending the RPC request",
    async (field) => {
      const send = mockRpc(result);
      const transaction = { to: ADDRESS, [field]: null };
      const snapshot = structuredClone(transaction);

      await expect(
        executeUnrestrictedMethod({ method, params: [transaction] }),
      ).resolves.toBe(result);

      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method,
          params: [field === "to" ? {} : { to: ADDRESS }, "latest"],
        }),
      );
      expect(transaction).toEqual(snapshot);
    },
  );

  it("preserves populated fields beside null fields and leaves the input intact", async () => {
    const send = mockRpc(result);
    const transaction = {
      to: ADDRESS,
      from: null,
      gas: null,
      gasLimit: 21000,
      value: 0,
      nonce: 0,
      data: null,
      input: "0x0102",
      maxFeePerGas: "0x10",
      maxPriorityFeePerGas: null,
      accessList: null,
      extension: { retain: ["first", "second"], nullable: null },
    };
    const snapshot = structuredClone(transaction);

    await expect(
      executeUnrestrictedMethod({ method, params: [transaction] }),
    ).resolves.toBe(result);

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        method,
        params: [
          {
            to: ADDRESS,
            gas: "0x5208",
            value: "0x0",
            nonce: "0x0",
            input: "0x0102",
            maxFeePerGas: "0x10",
          },
          "latest",
        ],
      }),
    );
    expect(transaction).toEqual(snapshot);
  });

  it.each<{ field: string; common: Json; normalized: Json }>([
    {
      field: "null baseChain",
      common: { customChain: CUSTOM_CHAIN, baseChain: null },
      normalized: { customChain: NORMALIZED_CUSTOM_CHAIN },
    },
    {
      field: "null hardfork",
      common: { customChain: CUSTOM_CHAIN, hardfork: null },
      normalized: { customChain: NORMALIZED_CUSTOM_CHAIN },
    },
    {
      field: "null customChain.name",
      common: { customChain: { ...CUSTOM_CHAIN, name: null } },
      normalized: { customChain: NORMALIZED_CUSTOM_CHAIN },
    },
    {
      field: "null optional common fields",
      common: {
        customChain: { ...CUSTOM_CHAIN, name: null },
        baseChain: null,
        hardfork: null,
      },
      normalized: { customChain: NORMALIZED_CUSTOM_CHAIN },
    },
    {
      field: "omitted customChain",
      common: { baseChain: "mainnet" },
      normalized: { baseChain: "mainnet" },
    },
    {
      field: "null customChain",
      common: { customChain: null },
      normalized: {},
    },
    {
      field: "empty common",
      common: {},
      normalized: {},
    },
    {
      field: "empty customChain",
      common: { customChain: {} },
      normalized: { customChain: {} },
    },
    {
      field: "null customChain.chainId",
      common: { customChain: { ...CUSTOM_CHAIN, chainId: null } },
      normalized: { customChain: { networkId: V3_CHAIN_ID } },
    },
    {
      field: "null customChain.networkId",
      common: { customChain: { ...CUSTOM_CHAIN, networkId: null } },
      normalized: { customChain: { chainId: V3_CHAIN_ID } },
    },
    {
      field: "omitted customChain.chainId",
      common: { customChain: { networkId: 3151909 } },
      normalized: { customChain: { networkId: V3_CHAIN_ID } },
    },
    {
      field: "omitted customChain.networkId",
      common: { customChain: { chainId: V3_CHAIN_ID } },
      normalized: { customChain: { chainId: V3_CHAIN_ID } },
    },
    {
      field: "null customChain IDs",
      common: { customChain: { chainId: null, networkId: null } },
      normalized: { customChain: {} },
    },
  ])(
    "normalizes $field through the executor and middleware",
    async ({ common, normalized }) => {
      const send = mockRpc(result);
      const transaction = { to: ADDRESS, value: 0, gas: 21000, common };
      const snapshot = structuredClone(transaction);
      const rpcRequest = {
        method,
        params: [
          {
            to: ADDRESS,
            value: "0x0",
            gas: "0x5208",
            common: normalized,
          },
          "latest",
        ],
      };

      await expect(
        executeUnrestrictedMethod({ method, params: [transaction] }),
      ).resolves.toBe(result);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(rpcRequest),
      );
      expect(transaction).toEqual(snapshot);

      send.mockClear();
      const engine = new JsonRpcEngine();
      engine.push(unrestrictedMethodsMiddleware);
      await expect(
        engine.handle({
          id: 1,
          jsonrpc: "2.0",
          method,
          params: [transaction],
        }),
      ).resolves.toEqual({ id: 1, jsonrpc: "2.0", result });
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(rpcRequest),
      );
      expect(transaction).toEqual(snapshot);
    },
  );

  it("preserves RPC failures after normalizing null fields", async () => {
    const send = mockRpc(result).mockRejectedValueOnce(
      new Error("RPC unavailable"),
    );

    await expect(
      executeUnrestrictedMethod({
        method,
        params: [{ to: ADDRESS, gas: null }],
      }),
    ).rejects.toThrow("RPC unavailable");
    expect(send).toHaveBeenCalledOnce();
  });

  describe.each([
    { field: "chain", metadata: (value: Json) => ({ chain: value }) },
    { field: "hardfork", metadata: (value: Json) => ({ hardfork: value }) },
    {
      field: "common.baseChain",
      metadata: (value: Json) => ({ common: { baseChain: value } }),
    },
    {
      field: "common.hardfork",
      metadata: (value: Json) => ({ common: { hardfork: value } }),
    },
    {
      field: "common.customChain.name",
      metadata: (value: Json) => ({
        common: { customChain: { name: value } },
      }),
    },
  ])("$field shape validation", ({ metadata }) => {
    it.each([false, 42, {}, [], ["testnet"]])(
      "rejects malformed metadata %j before RPC",
      async (value) => {
        const send = mockRpc(result);
        const transaction = { to: ADDRESS, ...metadata(value) };
        const snapshot = structuredClone(transaction);
        await expect(
          executeUnrestrictedMethod({ method, params: [transaction] }),
        ).rejects.toThrow("Invalid QRL RPC parameter.");

        const engine = new JsonRpcEngine();
        engine.push(unrestrictedMethodsMiddleware);
        await expect(
          engine.handle({
            id: 1,
            jsonrpc: "2.0",
            method,
            params: [{ to: ADDRESS, ...metadata(value) }],
          }),
        ).resolves.toMatchObject({
          id: 1,
          jsonrpc: "2.0",
          error: { code: 4200, message: "Invalid QRL RPC parameter." },
        });
        expect(send).not.toHaveBeenCalled();
        expect(transaction).toEqual(snapshot);
      },
    );
  });

  it.each([
    { gas: false },
    { input: [] },
    { nonce: {} },
    { maxFeePerGas: false },
    { accessList: {} },
    { common: { customChain: CUSTOM_CHAIN, baseChain: false } },
    { common: { customChain: CUSTOM_CHAIN, hardfork: false } },
    { common: { customChain: { ...CUSTOM_CHAIN, name: false } } },
    { common: { customChain: { ...CUSTOM_CHAIN, networkId: false } } },
    { common: { customChain: { ...CUSTOM_CHAIN, chainId: {} } } },
    { common: { customChain: false } },
  ])("rejects malformed populated fields (%s) before RPC", async (fields) => {
    const send = mockRpc(result);

    await expect(
      executeUnrestrictedMethod({
        method,
        params: [{ to: ADDRESS, gas: null, ...fields }],
      }),
    ).rejects.toThrow("Invalid QRL RPC parameter.");
    expect(send).not.toHaveBeenCalled();
  });
});
