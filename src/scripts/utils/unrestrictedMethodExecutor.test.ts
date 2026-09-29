import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";

const {
  getConnectedAccounts,
  getChainId,
  getNetworkId,
  requestManagerSend,
  mockIsLocked,
} = vi.hoisted(() => ({
  getConnectedAccounts: vi.fn(),
  getChainId: vi.fn(),
  getNetworkId: vi.fn(),
  requestManagerSend: vi.fn(),
  mockIsLocked: vi.fn(),
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

// The real LockManager pulls in the @theqrl/web3 crypto graph; qrl_accounts
// only needs its isLocked() answer (F8).
vi.mock("../lockManager/lockManager", () => ({
  default: { isLocked: (...args: any[]) => mockIsLocked(...args) },
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
    mockIsLocked
      .mockReset()
      .mockResolvedValue({ isLocked: false, hasPasswordSet: true });
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

  it("reports the wallet as unlocked and returns the connected accounts", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });

    await expect(
      executeUnrestrictedMethod(request("https://connected.example/swap")),
    ).resolves.toMatchObject({
      isUnlocked: true,
      accounts: ["QConnected"],
    });
  });

  it("reports the wallet as locked and hides the connected accounts", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });

    await expect(
      executeUnrestrictedMethod(request("https://connected.example/swap")),
    ).resolves.toMatchObject({
      isUnlocked: false,
      accounts: [],
    });
  });
});

describe("wallet_getPermissions (F8)", () => {
  const permissionsRequest = (origin: string) =>
    ({
      id: 1,
      jsonrpc: "2.0",
      method: UNRESTRICTED_METHODS.WALLET_GET_PERMISSIONS,
      senderData: { url: origin },
    }) as never;

  const storedPermissions = [
    {
      parentCapability: "qrl_accounts",
      caveats: [{ type: "restrictReturnedAccounts", value: ["QConnected"] }],
    },
  ];

  beforeEach(() => {
    mockIsLocked.mockReset();
    getConnectedAccounts.mockReset();
    getChainId.mockReset().mockResolvedValue(1337n);
    getNetworkId.mockReset().mockResolvedValue(1337n);
  });

  it("returns an empty permission list while the wallet is locked", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
    getConnectedAccounts.mockResolvedValue({ permissions: storedPermissions });

    await expect(
      executeUnrestrictedMethod(
        permissionsRequest("https://connected.example"),
      ),
    ).resolves.toEqual([]);
    // The caveats carry the account addresses, so nothing is looked up.
    expect(getConnectedAccounts).not.toHaveBeenCalled();
  });

  it("returns the stored permissions once unlocked", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    getConnectedAccounts.mockResolvedValue({ permissions: storedPermissions });

    await expect(
      executeUnrestrictedMethod(
        permissionsRequest("https://connected.example"),
      ),
    ).resolves.toEqual(storedPermissions);
  });
});

describe("websocket subscription methods are unsupported (L1)", () => {
  beforeEach(() => {
    mockIsLocked
      .mockReset()
      .mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    getChainId.mockReset().mockResolvedValue(1337n);
    getNetworkId.mockReset().mockResolvedValue(1337n);
  });

  it.each([
    [UNRESTRICTED_METHODS.QRL_SUBSCRIBE, ["logs", { topics: [TOPIC] }]],
    [UNRESTRICTED_METHODS.QRL_UNSUBSCRIBE, ["0xsubscription"]],
  ])("rejects %s without issuing any request", async (method, params) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    await expect(
      executeUnrestrictedMethod(rpcRequest(method, params)),
    ).rejects.toThrow("is not supported by this wallet");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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

describe("qrl_accounts (F8)", () => {
  const request = (origin: string) =>
    ({
      id: 1,
      jsonrpc: "2.0",
      method: UNRESTRICTED_METHODS.QRL_ACCOUNTS,
      senderData: { url: origin },
    }) as never;

  beforeEach(() => {
    mockIsLocked.mockReset();
    getConnectedAccounts.mockReset();
  });

  it("returns an empty array while the wallet is locked, even for a connected origin", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
    getConnectedAccounts.mockResolvedValue({ accounts: ["QConnected"] });

    await expect(
      executeUnrestrictedMethod(request("https://connected.example")),
    ).resolves.toEqual([]);
    // Never leaks the connected-accounts lookup for a locked wallet.
    expect(getConnectedAccounts).not.toHaveBeenCalled();
  });

  it("returns the connected accounts once unlocked", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    getConnectedAccounts.mockResolvedValue({ accounts: ["QConnected"] });

    await expect(
      executeUnrestrictedMethod(request("https://connected.example")),
    ).resolves.toEqual(["QConnected"]);
  });

  it("returns an empty array while unlocked with no connection for the origin", async () => {
    mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
    getConnectedAccounts.mockResolvedValue(undefined);

    await expect(
      executeUnrestrictedMethod(request("https://stranger.example")),
    ).resolves.toEqual([]);
  });
});
