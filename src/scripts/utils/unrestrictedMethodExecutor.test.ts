import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";

const { getConnectedAccounts, getChainId, getNetworkId } = vi.hoisted(() => ({
  getConnectedAccounts: vi.fn(),
  getChainId: vi.fn(),
  getNetworkId: vi.fn(),
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

import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";

const request = (url: string) =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method: UNRESTRICTED_METHODS.QRL_WEB3_WALLET_GET_PROVIDER_STATE,
    senderData: { url },
  }) as never;

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
