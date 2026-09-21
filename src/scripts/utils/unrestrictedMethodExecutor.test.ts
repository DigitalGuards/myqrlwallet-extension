import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";

const { getConnectedAccounts, getChainId, getNetworkId, requestManagerSend } =
  vi.hoisted(() => ({
    getConnectedAccounts: vi.fn(),
    getChainId: vi.fn(),
    getNetworkId: vi.fn(),
    requestManagerSend: vi.fn(),
  }));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getActiveBlockChain: vi.fn().mockResolvedValue({
      defaultRpcUrl: "https://rpc.example",
      defaultWsRpcUrl: "https://ws.example",
    }),
    getDAppsConnectedAccountsData: getConnectedAccounts,
  },
}));

vi.mock("@theqrl/web3", () => {
  class MockWeb3 {
    static providers = { HttpProvider: class {} };
    provider = {};
    qrl = {
      getChainId,
      net: { getId: getNetworkId },
    };
  }
  return { default: MockWeb3 };
});

vi.mock("@theqrl/web3-core", () => ({
  Web3RequestManager: class {
    send = requestManagerSend;
  },
}));

import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";

const request = (url: string) =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method: UNRESTRICTED_METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE,
    senderData: { url },
  }) as never;

const rpcRequest = (method: string, params: unknown[]) =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method,
    params,
    senderData: { url: "https://connected.example" },
  }) as never;

const ADDRESS = `Q${"0".repeat(128)}`;
const TOPIC = `0x${"ab".repeat(64)}`;

describe("qrlWallet_getProviderState", () => {
  beforeEach(() => {
    getChainId.mockReset().mockResolvedValue(1337n);
    getNetworkId.mockReset().mockResolvedValue(1337n);
    getConnectedAccounts
      .mockReset()
      .mockImplementation(async (origin) =>
        origin === "https://connected.example"
          ? { accounts: ["QConnected"] }
          : undefined,
      );
    requestManagerSend.mockReset();
  });

  it("initializes accounts only from the requesting origin", async () => {
    await expect(
      executeUnrestrictedMethod(request("https://connected.example/swap")),
    ).resolves.toMatchObject({
      accounts: ["QConnected"],
      chainId: "0x539",
      networkVersion: "1337",
    });
    await expect(
      executeUnrestrictedMethod(request("https://other.example/swap")),
    ).resolves.toMatchObject({ accounts: [] });

    expect(getConnectedAccounts).toHaveBeenNthCalledWith(
      1,
      "https://connected.example",
    );
    expect(getConnectedAccounts).toHaveBeenNthCalledWith(
      2,
      "https://other.example",
    );
  });

  it("reads the latest accounts after deferred network initialization", async () => {
    let resolveChainId: ((chainId: bigint) => void) | undefined;
    let connected = { accounts: ["QConnected"] } as
      | { accounts: string[] }
      | undefined;
    getChainId.mockImplementationOnce(
      () =>
        new Promise<bigint>((resolve) => {
          resolveChainId = resolve;
        }),
    );
    getConnectedAccounts.mockImplementation(async () => connected);

    const providerState = executeUnrestrictedMethod(
      request("https://connected.example/swap"),
    );
    await vi.waitFor(() => {
      expect(resolveChainId).toBeTypeOf("function");
    });
    expect(getConnectedAccounts).not.toHaveBeenCalled();

    connected = undefined;
    resolveChainId?.(1337n);

    await expect(providerState).resolves.toMatchObject({ accounts: [] });
    expect(getConnectedAccounts).toHaveBeenCalledWith(
      "https://connected.example",
    );
  });
});

describe("QIP-55 log RPC methods", () => {
  beforeEach(() => {
    requestManagerSend.mockReset();
  });

  it("sends exact VM64 topics through the raw qrl_getLogs route", async () => {
    requestManagerSend.mockResolvedValueOnce([{ data: "0x01" }]);

    await expect(
      executeUnrestrictedMethod(
        rpcRequest(UNRESTRICTED_METHODS.QRL_GET_LOGS, [
          { address: ADDRESS.toLowerCase(), topics: [TOPIC] },
        ]),
      ),
    ).resolves.toEqual([{ data: "0x01" }]);

    expect(requestManagerSend).toHaveBeenCalledWith({
      method: "qrl_getLogs",
      params: [{ address: ADDRESS, topics: [TOPIC] }],
    });
  });

  it("sends exact VM64 topics through the raw qrl_newFilter route", async () => {
    requestManagerSend.mockResolvedValueOnce("0xfilter");

    await expect(
      executeUnrestrictedMethod(
        rpcRequest(UNRESTRICTED_METHODS.QRL_NEW_FILTER, [
          { address: ADDRESS, topics: [null, [TOPIC]] },
        ]),
      ),
    ).resolves.toBe("0xfilter");

    expect(requestManagerSend).toHaveBeenCalledWith({
      method: "qrl_newFilter",
      params: [{ address: ADDRESS, topics: [null, [TOPIC]] }],
    });
  });

  it("rejects ambiguous 32-byte topics before making an RPC request", async () => {
    await expect(
      executeUnrestrictedMethod(
        rpcRequest(UNRESTRICTED_METHODS.QRL_GET_LOGS, [
          { topics: [`0x${"ab".repeat(32)}`] },
        ]),
      ),
    ).rejects.toThrow("exact VM64 form");

    expect(requestManagerSend).not.toHaveBeenCalled();
  });
});
