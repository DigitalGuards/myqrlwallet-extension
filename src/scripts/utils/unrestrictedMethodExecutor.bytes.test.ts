import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { echoRpcResult } from "@/test-utils/rpcReply";
import { HttpProvider } from "@theqrl/web3-providers-http";
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
    .spyOn(HttpProvider.prototype, "request")
    .mockImplementation(echoRpcResult(result));
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
      const accessList = [
        { address: ADDRESS, storageKeys: [OTHER_KEY, key, OTHER_KEY] },
        { address: OTHER_ADDRESS, storageKeys: [key, key] },
        { address: ADDRESS, storageKeys: [] },
      ];
      // @theqrl/web3 2.0.0 normalizes a copy, so the dApp's own key arrays
      // stay as sent. 1.0.3 rewrote them in place.
      await expectRpcRoundTrip(
        method,
        () => [transaction()],
        [{ to: ADDRESS, accessList }, "latest"],
        result,
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
        .spyOn(HttpProvider.prototype, "request")
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
      // 2.0.0 leaves the dApp's key arrays as sent (1.0.3 normalized them
      // in place).
      expect(params).toEqual(makeParams());

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
      expect(middlewareParams).toEqual(makeParams());
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
      );
    },
  );

  it.each([null, false, 17, {}, [17], new Uint16Array(32), undefined])(
    "rejects malformed nested storage keys (%s) before RPC",
    async (key) => {
      const send = vi.spyOn(HttpProvider.prototype, "request");
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
    // @theqrl/web3 2.0.0 refuses a reply for a hash other than the requested
    // one, so the mocked node answers for the normalized hash.
    it.each<{ method: string; result: Json }>([
      { method: METHODS.QRL_GET_TRANSACTION_BY_HASH, result: { hash: key } },
      {
        method: METHODS.QRL_GET_TRANSACTION_RECEIPT,
        result: { transactionHash: key },
      },
    ])("normalizes the hash for $method", async ({ method, result }) => {
      await expectRpcRoundTrip(method, () => [make()], [key], result);
    });

    // A short key goes out unpadded, as 1.0.3 sent it; go-qrl left-pads it.
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

describe("qrl_getProof wire format", () => {
  it.each([
    { block: 5, sent: "0x5" },
    { block: "0x05", sent: "0x5" },
    { block: "5", sent: "0x5" },
    { block: "0x10", sent: "0x10" },
    { block: "latest", sent: "latest" },
    { block: "pending", sent: "pending" },
    { block: "earliest", sent: "earliest" },
    { block: "safe", sent: "safe" },
    { block: "finalized", sent: "finalized" },
  ])("sends the block $block as $sent", async ({ block, sent }) => {
    await expectRpcRoundTrip(
      METHODS.QRL_GET_PROOF,
      () => [ADDRESS, [HEX], block],
      [ADDRESS, [HEX], sent],
      { storageProof: [] },
    );
  });

  it("sends uppercase and 0X-prefixed keys as lowercase 0x hex", async () => {
    await expectRpcRoundTrip(
      METHODS.QRL_GET_PROOF,
      () => [ADDRESS, [`0x${"AB".repeat(32)}`, `0X${"ab".repeat(32)}`]],
      [ADDRESS, [`0x${"ab".repeat(32)}`, `0x${"ab".repeat(32)}`], "latest"],
      { storageProof: [] },
    );
  });

  it("forwards a key longer than 32 bytes for the node to judge", async () => {
    const longKey = `0x${"11".repeat(64)}`;
    await expectRpcRoundTrip(
      METHODS.QRL_GET_PROOF,
      () => [ADDRESS, [longKey]],
      [ADDRESS, [longKey], "latest"],
      { storageProof: [] },
    );
  });

  it("returns the node's proof as the node sent it", async () => {
    const proof = {
      address: ADDRESS,
      accountProof: [`0xf9${"ab".repeat(80)}`],
      balance: "0x1bc16d674ec80000",
      codeHash: `0x${"c5".repeat(32)}`,
      nonce: "0x5",
      storageHash: `0x${"56".repeat(32)}`,
      storageProof: [
        { key: "0x11", value: "0x0", proof: [`0xf8${"cd".repeat(40)}`] },
      ],
    };
    await expectRpcRoundTrip(
      METHODS.QRL_GET_PROOF,
      () => [ADDRESS, ["0x11"], "latest"],
      [ADDRESS, ["0x11"], "latest"],
      proof,
    );
  });

  // 1.0.3 refused each of these before RPC too, except the lowercase q
  // address: the address check follows 2.0.0's rules, as the wrapped
  // getProof did on this branch.
  it.each([
    { name: "odd-length key", params: [ADDRESS, ["0x0"]] },
    { name: "key without 0x", params: [ADDRESS, ["abcd"]] },
    { name: "non-hex key", params: [ADDRESS, ["0xzz"]] },
    { name: "negative block", params: [ADDRESS, [HEX], -1] },
    { name: "fractional block", params: [ADDRESS, [HEX], 1.5] },
    { name: "unknown block tag", params: [ADDRESS, [HEX], "committed"] },
    { name: "lowercase q address", params: [`q${ADDRESS.slice(1)}`, [HEX]] },
    { name: "short address", params: [`Q${"a".repeat(40)}`, [HEX]] },
  ])("refuses a $name before RPC", async ({ params }) => {
    const send = vi.spyOn(HttpProvider.prototype, "request");
    const snapshot = structuredClone(params);
    await expect(
      executeUnrestrictedMethod({ method: METHODS.QRL_GET_PROOF, params }),
    ).rejects.toThrow("Web3 validator found");
    await expect(
      handleMiddlewareRequest(METHODS.QRL_GET_PROOF, params),
    ).resolves.toMatchObject({ id: 1, jsonrpc: "2.0", error: { code: 4200 } });
    expect(send).not.toHaveBeenCalled();
    expect(structuredClone(params)).toEqual(snapshot);
  });
});
