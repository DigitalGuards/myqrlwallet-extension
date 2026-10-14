import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNRESTRICTED_METHODS as METHODS } from "../constants/requestConstants";
import { V3_CHAIN_ID, V3_GENESIS_HASH } from "@/configuration/releaseProfile";
import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";
import type { RpcTransactionContext } from "./unrestrictedMethodGuards";

const {
  rpc,
  filterRpc,
  getActiveChain,
  getConnection,
  clearConnection,
  isLocked,
  assertNetwork,
} = vi.hoisted(() => {
  const method = () => vi.fn<(...params: unknown[]) => Promise<unknown>>();
  return {
    rpc: {
      getBlock: method(),
      getBlockTransactionCount: method(),
      getBalance: method(),
      estimateGas: method(),
      getFeeHistory: method(),
      getTransactionReceipt: method(),
      sendSignedTransaction: method(),
      getTransaction: method(),
      call: method(),
      getCode: method(),
      getProof: method(),
      getStorageAt: method(),
      getTransactionFromBlock: method(),
      getTransactionCount: method(),
      getChainId: method(),
      getNetworkId: method(),
    },
    filterRpc: {
      uninstallFilter: method(),
      getFilterChanges: method(),
      getFilterLogs: method(),
    },
    getActiveChain: method(),
    getConnection: method(),
    clearConnection: method(),
    isLocked:
      vi.fn<() => Promise<{ isLocked: boolean; hasPasswordSet: boolean }>>(),
    assertNetwork: method(),
  };
});

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getActiveBlockChain: getActiveChain,
    getDAppsConnectedAccountsData: getConnection,
    clearDAppsConnectedAccountsData: clearConnection,
  },
}));

vi.mock("../lockManager/lockManager", () => ({
  default: { isLocked },
}));

vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: assertNetwork,
}));

vi.mock("@theqrl/web3", () => ({
  default: class {
    static providers = {
      HttpProvider: class {
        constructor(readonly url: string) {}
      },
    };
    provider = {};
    qrl = { ...rpc, net: { getId: rpc.getNetworkId } };
  },
}));

vi.mock("@theqrl/web3-rpc-methods", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@theqrl/web3-rpc-methods")>();
  return {
    ...original,
    qrlRpcMethods: { ...original.qrlRpcMethods, ...filterRpc },
  };
});

const ADDRESS = `Q${"a".repeat(128)}`;
const HASH = `0x${"b".repeat(64)}`;
const ORIGIN = "https://dapp.example";
const CHAIN = { chainId: V3_CHAIN_ID, defaultRpcUrl: "https://rpc.example" };
const request = (method: string, params?: unknown) => ({
  method,
  params,
  senderData: { url: `${ORIGIN}/request` },
});

beforeEach(() => {
  vi.resetAllMocks();
  getActiveChain.mockResolvedValue(CHAIN);
  isLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
  getConnection.mockResolvedValue(undefined);
  rpc.getChainId.mockResolvedValue(3151909n);
  rpc.getNetworkId.mockResolvedValue(3151909n);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unrestricted RPC parameter boundaries", () => {
  const cases: {
    method: string;
    params: unknown[];
    target: keyof typeof rpc;
    result: unknown;
    expected: unknown;
    forwarded?: unknown[];
  }[] = [
    {
      method: METHODS.QRL_GET_BLOCK_BY_NUMBER,
      params: ["latest", false],
      target: "getBlock",
      result: { number: 16n },
      expected: { number: "0x10" },
    },
    {
      method: METHODS.QRL_GET_BLOCK_BY_HASH,
      params: [HASH, true],
      target: "getBlock",
      result: { transactions: [{ value: 1n }] },
      expected: { transactions: [{ value: "0x1" }] },
    },
    {
      method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
      params: [HASH],
      target: "getBlockTransactionCount",
      result: 16n,
      expected: "0x10",
    },
    {
      method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
      params: ["latest"],
      target: "getBlockTransactionCount",
      result: 16n,
      expected: "0x10",
    },
    {
      method: METHODS.QRL_GET_BALANCE,
      params: [ADDRESS, "pending"],
      target: "getBalance",
      result: 16n,
      expected: "0x10",
    },
    {
      method: METHODS.QRL_GET_BALANCE,
      params: [ADDRESS],
      target: "getBalance",
      result: 16n,
      expected: "0x10",
      forwarded: [ADDRESS, undefined],
    },
    {
      method: METHODS.QRL_ESTIMATE_GAS,
      params: [{ from: ADDRESS, to: ADDRESS, value: "0x1" }],
      target: "estimateGas",
      result: 21000n,
      expected: "0x5208",
    },
    {
      method: METHODS.QRL_FEE_HISTORY,
      params: [4, "latest", [0, 25, 75]],
      target: "getFeeHistory",
      result: { oldestBlock: 16n },
      expected: { oldestBlock: "0x10" },
    },
    {
      method: METHODS.QRL_GET_TRANSACTION_RECEIPT,
      params: [HASH],
      target: "getTransactionReceipt",
      result: { blockNumber: 16n },
      expected: { blockNumber: "0x10" },
    },
    {
      method: METHODS.QRL_GET_TRANSACTION_RECEIPT,
      params: [new Uint8Array([1, 2])],
      target: "getTransactionReceipt",
      result: null,
      expected: null,
    },
    {
      method: METHODS.QRL_GET_TRANSACTION_BY_HASH,
      params: [HASH],
      target: "getTransaction",
      result: { value: 16n },
      expected: { value: "0x10" },
    },
    {
      method: METHODS.QRL_CALL,
      params: [{ to: ADDRESS }, "latest"],
      target: "call",
      result: "0x1234",
      expected: "0x1234",
    },
    {
      method: METHODS.QRL_CALL,
      params: [{ data: "0x6080" }],
      target: "call",
      result: "0x1234",
      expected: "0x1234",
      forwarded: [{ data: "0x6080" }, undefined],
    },
    {
      method: METHODS.QRL_CALL,
      params: [{ to: null, data: "0x6080" }, "latest"],
      target: "call",
      result: "0x1234",
      expected: "0x1234",
    },
    {
      method: METHODS.QRL_GET_CODE,
      params: [ADDRESS, "latest"],
      target: "getCode",
      result: "0x1234",
      expected: "0x1234",
    },
    {
      method: METHODS.QRL_GET_PROOF,
      params: [ADDRESS, [HASH, new Uint8Array([1])], "latest"],
      target: "getProof",
      result: { balance: 16n },
      expected: { balance: "0x10" },
    },
    {
      method: METHODS.QRL_GET_STORAGE_AT,
      params: [ADDRESS, 0n, "latest"],
      target: "getStorageAt",
      result: HASH,
      expected: HASH,
    },
    {
      method: METHODS.QRL_GET_TRANSACTION_COUNT,
      params: [ADDRESS, "latest"],
      target: "getTransactionCount",
      result: 16n,
      expected: "0x10",
    },
    {
      method: METHODS.QRL_SEND_RAW_TRANSACTION,
      params: ["0x0102"],
      target: "sendSignedTransaction",
      result: { transactionHash: HASH },
      expected: HASH,
    },
  ];

  it.each(cases)(
    "preserves the arguments and result of $method with $params",
    async ({ method, params, target, result, expected, forwarded }) => {
      rpc[target].mockResolvedValue(result);
      await expect(
        executeUnrestrictedMethod(request(method, params)),
      ).resolves.toEqual(expected);
      expect(rpc[target]).toHaveBeenCalledExactlyOnceWith(
        ...(forwarded ?? params),
      );
      if (method === METHODS.QRL_SEND_RAW_TRANSACTION) {
        expect(assertNetwork).toHaveBeenCalledExactlyOnceWith(
          CHAIN.defaultRpcUrl,
        );
        expect(assertNetwork.mock.invocationCallOrder[0]).toBeLessThan(
          rpc[target].mock.invocationCallOrder[0],
        );
      }
    },
  );

  it.each([undefined, null, []])(
    "preserves omitted block defaults for %s params",
    async (params) => {
      rpc.getBlock.mockResolvedValue({ number: 16n });
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_GET_BLOCK_BY_NUMBER, params),
        ),
      ).resolves.toEqual({ number: "0x10" });
      expect(rpc.getBlock).toHaveBeenCalledExactlyOnceWith(
        undefined,
        undefined,
      );
    },
  );

  const malformedParams: { method: string; params: unknown }[] = [
    { method: METHODS.QRL_GET_BALANCE, params: "address" },
    { method: METHODS.QRL_GET_BALANCE, params: { 0: ADDRESS } },
    { method: METHODS.QRL_GET_BALANCE, params: [42] },
    { method: METHODS.QRL_GET_BALANCE, params: [ADDRESS, {}] },
    { method: METHODS.QRL_GET_BLOCK_BY_NUMBER, params: [{}, true] },
    { method: METHODS.QRL_GET_BLOCK_BY_NUMBER, params: ["latest", "false"] },
    { method: METHODS.QRL_GET_BLOCK_BY_HASH, params: [HASH, 1] },
    { method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_HASH, params: [{}] },
    {
      method: METHODS.QRL_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
      params: [false],
    },
    { method: METHODS.QRL_ESTIMATE_GAS, params: [null] },
    { method: METHODS.QRL_FEE_HISTORY, params: [{}, "latest", []] },
    { method: METHODS.QRL_FEE_HISTORY, params: [4, false, []] },
    { method: METHODS.QRL_FEE_HISTORY, params: [4, "latest", [false]] },
    {
      method: METHODS.QRL_FEE_HISTORY,
      params: [4, "latest", Array<unknown>(1)],
    },
    { method: METHODS.QRL_GET_TRANSACTION_RECEIPT, params: [42] },
    { method: METHODS.QRL_GET_TRANSACTION_BY_HASH, params: [{}] },
    { method: METHODS.QRL_CALL, params: ["transaction"] },
    { method: METHODS.QRL_CALL, params: [{ to: 42 }] },
    { method: METHODS.QRL_CALL, params: [{ to: ADDRESS }, false] },
    { method: METHODS.QRL_GET_CODE, params: [null] },
    { method: METHODS.QRL_GET_CODE, params: [ADDRESS, {}] },
    { method: METHODS.QRL_GET_PROOF, params: [42, [], "latest"] },
    { method: METHODS.QRL_GET_PROOF, params: [ADDRESS, [42], "latest"] },
    { method: METHODS.QRL_GET_PROOF, params: [ADDRESS, HASH, "latest"] },
    {
      method: METHODS.QRL_GET_PROOF,
      params: [ADDRESS, Array<unknown>(1), "latest"],
    },
    { method: METHODS.QRL_GET_PROOF, params: [ADDRESS, [], false] },
    { method: METHODS.QRL_GET_STORAGE_AT, params: [ADDRESS, {}, "latest"] },
    { method: METHODS.QRL_GET_STORAGE_AT, params: [ADDRESS, 0, false] },
    { method: METHODS.QRL_GET_TRANSACTION_COUNT, params: [42, "latest"] },
    { method: METHODS.QRL_GET_TRANSACTION_COUNT, params: [ADDRESS, false] },
    { method: METHODS.QRL_SEND_RAW_TRANSACTION, params: [{}] },
    {
      method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
      params: ["latest", {}],
    },
    {
      method: METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
      params: [null, 0],
    },
    { method: METHODS.QRL_UNINSTALL_FILTER, params: [null] },
    { method: METHODS.QRL_GET_FILTER_CHANGES, params: [{}] },
    { method: METHODS.QRL_GET_FILTER_LOGS, params: [false] },
  ];

  it.each(malformedParams)(
    "rejects malformed $method parameters $params before the RPC call",
    async ({ method, params }) => {
      await expect(
        executeUnrestrictedMethod(request(method, params)),
      ).rejects.toThrow("Invalid QRL RPC parameter.");
      for (const target of [
        ...Object.values(rpc),
        ...Object.values(filterRpc),
      ]) {
        expect(target).not.toHaveBeenCalled();
      }
    },
  );

  it.each([null, undefined, [], "request", {}, { method: 42 }])(
    "rejects malformed request envelopes (%s)",
    async (input) => {
      await expect(executeUnrestrictedMethod(input)).rejects.toThrow(
        "Invalid QRL RPC request.",
      );
      expect(getActiveChain).not.toHaveBeenCalled();
    },
  );

  it.each([
    { from: 42 },
    { to: [] },
    { value: {} },
    { gas: NaN },
    { nonce: Infinity },
    { data: [] },
    { signature: false },
    { publicKey: 42 },
    { accessList: {} },
    { accessList: [null] },
    { accessList: Array<unknown>(1) },
    { accessList: [{ address: 42 }] },
    { accessList: [{ storageKeys: [42] }] },
    { common: false },
    { common: { customChain: false } },
    { common: { customChain: { chainId: 1, networkId: 1, name: false } } },
    { common: { customChain: { chainId: 1, networkId: 1 }, baseChain: false } },
    { chain: false },
    { hardfork: false },
  ])("rejects malformed transaction fields (%s)", async (transaction) => {
    for (const method of [METHODS.QRL_ESTIMATE_GAS, METHODS.QRL_CALL]) {
      await expect(
        executeUnrestrictedMethod(request(method, [transaction])),
      ).rejects.toThrow("Invalid QRL RPC parameter.");
    }
    expect(rpc.estimateGas).not.toHaveBeenCalled();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it.each([
    { method: METHODS.QRL_CALL, target: "call" },
    { method: METHODS.QRL_ESTIMATE_GAS, target: "estimateGas" },
  ] as const)(
    "preserves complete transactions and extension fields for $method",
    async ({ method, target }) => {
      const transaction = {
        from: ADDRESS,
        to: ADDRESS,
        value: 1n,
        gas: 21000,
        type: "0x2",
        maxFeePerGas: "0x10",
        maxPriorityFeePerGas: 1,
        nonce: "0x0",
        chainId: V3_CHAIN_ID,
        networkId: 3151909,
        gasLimit: 21000n,
        data: "0x0102",
        input: "0x0102",
        descriptor: new Uint8Array([1]),
        extraParams: "0x",
        signature: "0x",
        publicKey: "0x",
        accessList: [
          {
            address: ADDRESS,
            storageKeys: [HASH, new Uint8Array(32).fill(17), HASH],
          },
        ],
        common: {
          customChain: {
            chainId: V3_CHAIN_ID,
            networkId: 3151909,
            name: "QRL",
          },
          baseChain: "mainnet",
          hardfork: "zond",
        },
        chain: "mainnet",
        hardfork: "zond",
        extension: { retain: ["first", "second"] },
      };
      const serialize = () =>
        JSON.stringify(transaction, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        );
      const snapshot = serialize();
      rpc.estimateGas.mockResolvedValue(21000n);
      rpc.call.mockResolvedValue("0x1234");
      await executeUnrestrictedMethod(request(method, [transaction]));
      expect(rpc[target].mock.calls[0]?.[0]).toBe(transaction);
      expect(serialize()).toBe(snapshot);
    },
  );

  it.each([
    "0x0102",
    new Uint8Array([1, 2]),
    new Uint8Array([255, 1, 2, 254]).subarray(1, 3),
  ])("preserves raw transaction byte representations (%s)", async (raw) => {
    const snapshot = structuredClone(raw);
    rpc.sendSignedTransaction.mockResolvedValue({ transactionHash: HASH });
    await expect(
      executeUnrestrictedMethod(
        request(METHODS.QRL_SEND_RAW_TRANSACTION, [raw]),
      ),
    ).resolves.toBe(HASH);
    expect(rpc.sendSignedTransaction).toHaveBeenCalledExactlyOnceWith(raw);
    expect(rpc.sendSignedTransaction.mock.calls[0]?.[0]).toBe(raw);
    expect(structuredClone(raw)).toEqual(snapshot);
    expect(assertNetwork.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.sendSignedTransaction.mock.invocationCallOrder[0],
    );
  });

  it.each([
    METHODS.QRL_UNINSTALL_FILTER,
    METHODS.QRL_GET_FILTER_CHANGES,
    METHODS.QRL_GET_FILTER_LOGS,
  ])("preserves valid filter identifiers for %s", async (method) => {
    filterRpc.uninstallFilter.mockResolvedValue(true);
    filterRpc.getFilterChanges.mockResolvedValue([{ blockNumber: 16n }]);
    filterRpc.getFilterLogs.mockResolvedValue([{ blockNumber: 16n }]);
    await expect(
      executeUnrestrictedMethod(request(method, ["0x10"])),
    ).resolves.toEqual(
      method === METHODS.QRL_UNINSTALL_FILTER
        ? true
        : [{ blockNumber: "0x10" }],
    );
    const calls = Object.values(filterRpc).flatMap(
      (target) => target.mock.calls,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe("0x10");
  });

  it.each([
    METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
  ])("preserves the immediate empty result for %s", async (method) => {
    rpc.getTransactionFromBlock.mockResolvedValue({ hash: HASH, value: 16n });
    await expect(
      executeUnrestrictedMethod(request(method, ["latest", "0x0"])),
    ).resolves.toEqual({});
    expect(rpc.getTransactionFromBlock).toHaveBeenCalledExactlyOnceWith(
      "latest",
      "0x0",
    );
  });

  it.each([
    METHODS.QRL_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
    METHODS.QRL_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
  ])(
    "reports a rejected %s lookup after the empty response",
    async (method) => {
      const error = new Error("RPC refused the transaction lookup.");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      rpc.getTransactionFromBlock.mockRejectedValue(error);
      await expect(
        executeUnrestrictedMethod(request(method, ["latest", 0])),
      ).resolves.toEqual({});
      expect(report).toHaveBeenCalledExactlyOnceWith(
        "QrlWeb3Wallet: Failed to look up transaction:",
        error,
      );
    },
  );

  it.each([42, {}, { transactionHash: false }])(
    "rejects malformed broadcast receipts (%s)",
    async (receipt) => {
      rpc.sendSignedTransaction.mockResolvedValue(receipt);
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_SEND_RAW_TRANSACTION, ["0x0102"]),
        ),
      ).rejects.toThrow();
    },
  );

  it.each([null, undefined])(
    "preserves the missing broadcast receipt result (%s)",
    async (receipt) => {
      rpc.sendSignedTransaction.mockResolvedValue(receipt);
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_SEND_RAW_TRANSACTION, ["0x0102"]),
        ),
      ).resolves.toBeUndefined();
    },
  );
});

describe("unrestricted storage boundaries", () => {
  it.each([null, [], { defaultRpcUrl: 42 }])(
    "refuses an unreadable active network (%s)",
    async (chain) => {
      getActiveChain.mockResolvedValue(chain);
      await expect(
        executeUnrestrictedMethod(request(METHODS.QRL_ACCOUNTS)),
      ).rejects.toThrow("The wallet cannot read the active network.");
      expect(getConnection).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, {}, { accounts: null, permissions: null }])(
    "preserves empty grants for older records (%s)",
    async (connection) => {
      getConnection.mockResolvedValue(connection);
      await expect(
        executeUnrestrictedMethod(request(METHODS.QRL_ACCOUNTS)),
      ).resolves.toEqual([]);
      await expect(
        executeUnrestrictedMethod(request(METHODS.WALLET_GET_PERMISSIONS)),
      ).resolves.toEqual([]);
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE),
        ),
      ).resolves.toMatchObject({ accounts: [], isUnlocked: true });
    },
  );

  it.each(["record", [], { accounts: [ADDRESS, 42] }, { accounts: {} }])(
    "refuses malformed stored accounts (%s)",
    async (connection) => {
      getConnection.mockResolvedValue(connection);
      for (const method of [
        METHODS.QRL_ACCOUNTS,
        METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE,
      ]) {
        await expect(
          executeUnrestrictedMethod(request(method)),
        ).rejects.toThrow("The wallet cannot read the stored dApp");
      }
      expect(clearConnection).not.toHaveBeenCalled();
    },
  );

  it.each(["record", [], { permissions: {} }])(
    "refuses malformed stored permissions (%s)",
    async (connection) => {
      getConnection.mockResolvedValue(connection);
      await expect(
        executeUnrestrictedMethod(request(METHODS.WALLET_GET_PERMISSIONS)),
      ).rejects.toThrow("The wallet cannot read the stored dApp");
      expect(clearConnection).not.toHaveBeenCalled();
    },
  );

  it("keeps locked answers empty even when stored grants are malformed", async () => {
    isLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
    getConnection.mockResolvedValue({ accounts: [42], permissions: false });
    await expect(
      executeUnrestrictedMethod(request(METHODS.QRL_ACCOUNTS)),
    ).resolves.toEqual([]);
    await expect(
      executeUnrestrictedMethod(request(METHODS.WALLET_GET_PERMISSIONS)),
    ).resolves.toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
    await expect(
      executeUnrestrictedMethod(
        request(METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE),
      ),
    ).resolves.toMatchObject({ accounts: [], isUnlocked: false });
  });

  it("keeps grant order and extra stored fields intact", async () => {
    const connection = {
      accounts: [ADDRESS, `Q${"b".repeat(128)}`],
      permissions: [
        {
          parentCapability: "qrl_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [ADDRESS] }],
        },
      ],
      extra: { retain: ["first", "second"] },
    };
    const snapshot = structuredClone(connection);
    getConnection.mockResolvedValue(connection);
    await expect(
      executeUnrestrictedMethod(request(METHODS.QRL_ACCOUNTS)),
    ).resolves.toEqual(connection.accounts);
    await expect(
      executeUnrestrictedMethod(request(METHODS.WALLET_GET_PERMISSIONS)),
    ).resolves.toEqual(connection.permissions);
    expect(getConnection).toHaveBeenNthCalledWith(1, ORIGIN);
    expect(getConnection).toHaveBeenNthCalledWith(2, ORIGIN);
    expect(connection).toEqual(snapshot);
    expect(clearConnection).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { url: 42 }])(
    "rejects malformed origin metadata (%s)",
    async (senderData) => {
      await expect(
        executeUnrestrictedMethod({
          method: METHODS.WALLET_REVOKE_PERMISSIONS,
          senderData,
        }),
      ).rejects.toThrow();
      expect(clearConnection).not.toHaveBeenCalled();
    },
  );

  it("waits for origin-scoped revocation and returns its existing result", async () => {
    await expect(
      executeUnrestrictedMethod(request(METHODS.WALLET_REVOKE_PERMISSIONS)),
    ).resolves.toBeNull();
    expect(clearConnection).toHaveBeenCalledExactlyOnceWith(ORIGIN);
    const error = new Error("Storage write failed.");
    clearConnection.mockRejectedValue(error);
    await expect(
      executeUnrestrictedMethod(request(METHODS.WALLET_REVOKE_PERMISSIONS)),
    ).rejects.toBe(error);
  });

  it.each([undefined, null, 42, "invalid"])(
    "falls back to the node for unusable stored chain IDs (%s)",
    async (chainId) => {
      getActiveChain.mockResolvedValue({ ...CHAIN, chainId });
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE),
        ),
      ).resolves.toMatchObject({
        chainId: V3_CHAIN_ID,
        networkVersion: "3151909",
      });
      expect(rpc.getChainId).toHaveBeenCalledOnce();
      expect(rpc.getNetworkId.mock.invocationCallOrder[0]).toBeLessThan(
        getConnection.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([null, undefined])(
    "preserves the missing node network ID fallback (%s)",
    async (networkId) => {
      getActiveChain.mockResolvedValue({ ...CHAIN, chainId: "invalid" });
      rpc.getNetworkId.mockResolvedValue(networkId);
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE),
        ),
      ).resolves.toMatchObject({ chainId: V3_CHAIN_ID, networkVersion: "" });
    },
  );

  it.each([{}, false])(
    "refuses malformed node network IDs (%s)",
    async (networkId) => {
      getActiveChain.mockResolvedValue({ ...CHAIN, chainId: "invalid" });
      rpc.getNetworkId.mockResolvedValue(networkId);
      await expect(
        executeUnrestrictedMethod(
          request(METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE),
        ),
      ).rejects.toThrow("Invalid QRL RPC parameter.");
      expect(getConnection).not.toHaveBeenCalled();
    },
  );

  it("preserves the pinned capability response and chain-switch check", async () => {
    await expect(
      executeUnrestrictedMethod(request(METHODS.QRL_WALLET_CAPABILITIES)),
    ).resolves.toEqual({
      addressScheme: "qip55-64",
      chainId: V3_CHAIN_ID,
      genesisHash: V3_GENESIS_HASH,
    });
    getActiveChain.mockResolvedValueOnce(CHAIN).mockResolvedValueOnce({
      ...CHAIN,
      defaultRpcUrl: "https://changed.example",
    });
    await expect(
      executeUnrestrictedMethod(request(METHODS.QRL_WALLET_CAPABILITIES)),
    ).rejects.toThrow(
      "The network changed. Request wallet capabilities again.",
    );
  });
});

describe("Web3 creation-call compatibility", () => {
  it.each([{ data: "0x6080" }, { to: null, data: "0x6080" }])(
    "forwards a creation simulation through the installed Web3 library (%s)",
    async (transaction) => {
      const { default: Web3 } =
        await vi.importActual<typeof import("@theqrl/web3")>("@theqrl/web3");
      const provider = new Web3.providers.HttpProvider("https://rpc.example");
      const send = vi
        .spyOn(provider, "request")
        .mockResolvedValue({ jsonrpc: "2.0", id: 1, result: "0x1234" });
      const web3 = new Web3({ provider });
      const callContext: RpcTransactionContext = web3.qrl;
      await expect(callContext.call(transaction, "latest")).resolves.toBe(
        "0x1234",
      );
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "qrl_call",
          params: [{ data: "0x6080" }, "latest"],
        }),
      );
    },
  );
});
