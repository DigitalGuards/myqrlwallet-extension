import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
import type { Bytes } from "@theqrl/web3-types";
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
const OTHER_ADDRESS = toChecksumAddress(`Q${"b".repeat(128)}`);
const HEX = `0x${"11".repeat(32)}`;
const OTHER_KEY = `0x${"22".repeat(32)}`;
const byteInputs: {
  name: string;
  make: () => Bytes;
  hex: string;
  key: string;
}[] = [
  { name: "hex string", make: () => HEX, hex: HEX, key: HEX },
  {
    name: "Uint8Array",
    make: () => new Uint8Array(32).fill(17),
    hex: HEX,
    key: HEX,
  },
  {
    name: "Buffer",
    make: () => Buffer.from("11".repeat(32), "hex"),
    hex: HEX,
    key: HEX,
  },
  {
    name: "Uint8Array view",
    make: () =>
      new Uint8Array([255, ...new Uint8Array(32).fill(17), 254]).subarray(
        1,
        33,
      ),
    hex: HEX,
    key: HEX,
  },
  {
    name: "short hex string",
    make: () => "0x11",
    hex: "0x11",
    key: `0x${"00".repeat(31)}11`,
  },
  {
    name: "short Uint8Array",
    make: () => new Uint8Array([17]),
    hex: "0x11",
    key: `0x${"00".repeat(31)}11`,
  },
  {
    name: "empty Uint8Array",
    make: () => new Uint8Array(),
    hex: "0x",
    key: `0x${"00".repeat(32)}`,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

// The engine forwards parameter objects directly to middleware. Its public
// request type describes JSON, while the runtime also accepts Web3 byte inputs.
const handleMiddlewareRequest = (method: string, params: unknown[]) => {
  const engine = new JsonRpcEngine();
  engine.push(unrestrictedMethodsMiddleware);
  const byteRequestEngine: {
    handle(request: {
      id: number | string | null;
      jsonrpc: "2.0";
      method: string;
      params?: unknown;
    }): Promise<unknown>;
  } = engine;
  return byteRequestEngine.handle({ id: 1, jsonrpc: "2.0", method, params });
};

// These wire expectations also run against the origin/dev executor during
// compatibility verification. Only the HTTP response is controlled here.
const expectRpcRoundTrip = async (
  method: string,
  makeParams: () => unknown[],
  expectedParams: unknown[],
  result: Json,
  expectedInput?: unknown[],
) => {
  const params = makeParams();
  const snapshot = structuredClone(expectedInput ?? params);
  const send = vi
    .spyOn(Web3.providers.HttpProvider.prototype, "request")
    .mockResolvedValue({ jsonrpc: "2.0", id: 1, result });
  const expectedRequest: unknown = expect.objectContaining({
    method,
    params: expectedParams,
  });

  await expect(executeUnrestrictedMethod({ method, params })).resolves.toEqual(
    result,
  );
  expect(send).toHaveBeenCalledExactlyOnceWith(expectedRequest);
  expect(structuredClone(params)).toEqual(snapshot);

  send.mockClear();
  const middlewareParams = makeParams();
  await expect(
    handleMiddlewareRequest(method, middlewareParams),
  ).resolves.toEqual({ id: 1, jsonrpc: "2.0", result });
  expect(send).toHaveBeenCalledExactlyOnceWith(expectedRequest);
  expect(structuredClone(middlewareParams)).toEqual(snapshot);
};

describe.each([
  { method: METHODS.QRL_CALL, result: "0x1234" },
  { method: METHODS.QRL_ESTIMATE_GAS, result: "0x5208" },
])("$method byte normalization compatibility", ({ method, result }) => {
  describe.each(byteInputs)("$name", ({ make, hex, key }) => {
    it.each([
      "data",
      "input",
      "descriptor",
      "extraParams",
      "signature",
      "publicKey",
    ])(
      "normalizes the %s field through executor and middleware",
      async (field) => {
        await expectRpcRoundTrip(
          method,
          () => [{ to: ADDRESS, [field]: make() }],
          [{ to: ADDRESS, [field]: hex }, "latest"],
          result,
        );
      },
    );

    it("normalizes mixed access-list keys and preserves entry order and duplicates", async () => {
      const transaction = () => ({
        to: ADDRESS,
        accessList: [
          { address: ADDRESS, storageKeys: [OTHER_KEY, make(), OTHER_KEY] },
          { address: OTHER_ADDRESS, storageKeys: [make(), make()] },
          { address: ADDRESS, storageKeys: [] },
        ],
        extension: { retain: ["first", "second"] },
      });
      // Web3 normalizes the original nested key arrays in place on origin/dev.
      const accessList = [
        { address: ADDRESS, storageKeys: [OTHER_KEY, key, OTHER_KEY] },
        { address: OTHER_ADDRESS, storageKeys: [key, key] },
        { address: ADDRESS, storageKeys: [] },
      ];
      await expectRpcRoundTrip(
        method,
        () => [transaction()],
        [{ to: ADDRESS, accessList }, "latest"],
        result,
        [{ ...transaction(), accessList }],
      );
    });

    it("preserves an RPC failure after normalizing access-list keys", async () => {
      const makeParams = () => [
        {
          to: ADDRESS,
          accessList: [{ address: ADDRESS, storageKeys: [make()] }],
        },
      ];
      const normalizedParams = [
        { to: ADDRESS, accessList: [{ address: ADDRESS, storageKeys: [key] }] },
      ];
      const send = vi
        .spyOn(Web3.providers.HttpProvider.prototype, "request")
        .mockRejectedValue(new Error("Access-list RPC unavailable"));
      const params = makeParams();
      await expect(
        executeUnrestrictedMethod({ method, params }),
      ).rejects.toThrow("Access-list RPC unavailable");
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method,
          params: [...normalizedParams, "latest"],
        }),
      );
      expect(params).toEqual(normalizedParams);

      send.mockClear();
      const middlewareParams = makeParams();
      await expect(
        handleMiddlewareRequest(method, middlewareParams),
      ).resolves.toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        error: { code: 4200, message: "Access-list RPC unavailable" },
      });
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method,
          params: [...normalizedParams, "latest"],
        }),
      );
      expect(middlewareParams).toEqual(normalizedParams);
    });
  });

  it.each([
    { name: "empty list", make: () => [], expected: [] },
    { name: "empty entry", make: () => [{}], expected: [{}] },
    {
      name: "omitted keys",
      make: () => [{ address: ADDRESS }],
      expected: [{ address: ADDRESS }],
    },
    {
      name: "omitted address with hex key",
      make: () => [{ storageKeys: [HEX] }],
      expected: [{ storageKeys: [HEX] }],
    },
    {
      name: "omitted address with byte key",
      make: () => [{ storageKeys: [new Uint8Array(32).fill(17)] }],
      expected: [{ storageKeys: [HEX] }],
    },
  ])(
    "preserves optional access-list fields: $name",
    async ({ make, expected }) => {
      await expectRpcRoundTrip(
        method,
        () => [{ to: ADDRESS, accessList: make() }],
        [{ to: ADDRESS, accessList: expected }, "latest"],
        result,
        [{ to: ADDRESS, accessList: expected }],
      );
    },
  );

  it.each([null, false, 17, {}, [17], new Uint16Array(32), undefined])(
    "rejects malformed nested storage keys (%s) before RPC",
    async (key) => {
      const send = vi.spyOn(Web3.providers.HttpProvider.prototype, "request");
      const params = [
        {
          to: ADDRESS,
          accessList: [{ storageKeys: [new Uint8Array(32).fill(17), key] }],
        },
      ];
      const snapshot = structuredClone(params);
      await expect(
        executeUnrestrictedMethod({ method, params }),
      ).rejects.toThrow("Invalid QRL RPC parameter.");
      await expect(
        handleMiddlewareRequest(method, params),
      ).resolves.toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        error: { code: 4200, message: "Invalid QRL RPC parameter." },
      });
      expect(send).not.toHaveBeenCalled();
      expect(structuredClone(params)).toEqual(snapshot);
    },
  );
});

describe.each(byteInputs)(
  "other RPC byte boundaries: $name",
  ({ make, hex, key }) => {
    it.each<{ method: string; result: Json }>([
      { method: METHODS.QRL_GET_TRANSACTION_BY_HASH, result: { hash: HEX } },
      {
        method: METHODS.QRL_GET_TRANSACTION_RECEIPT,
        result: { transactionHash: HEX },
      },
    ])("normalizes the hash for $method", async ({ method, result }) => {
      await expectRpcRoundTrip(method, () => [make()], [key], result);
    });

    it("normalizes mixed proof keys and preserves order and duplicates", async () => {
      await expectRpcRoundTrip(
        METHODS.QRL_GET_PROOF,
        () => [ADDRESS, [OTHER_KEY, make(), OTHER_KEY, make()]],
        [ADDRESS, [OTHER_KEY, hex, OTHER_KEY, hex], "latest"],
        { storageProof: [] },
      );
    });
  },
);
