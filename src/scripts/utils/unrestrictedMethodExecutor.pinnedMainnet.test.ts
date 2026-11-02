const { TEST_MAINNET, getActiveChain } = vi.hoisted(() => ({
  // A stand-in for the launch-day pin. No build ships these values.
  TEST_MAINNET: {
    chainId: "0x1b3a7",
    genesisHash: `0x${"ab".repeat(32)}`,
    rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
    explorer: null,
  },
  getActiveChain: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  MAINNET: TEST_MAINNET,
}));
vi.mock("@/utilities/storageUtil", () => ({
  default: { getActiveBlockChain: getActiveChain },
}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNRESTRICTED_METHODS as METHODS } from "../constants/requestConstants";
import { V3_CHAIN_ID, V3_GENESIS_HASH } from "@/configuration/releaseProfile";
import { isRecord } from "@/utilities/storageGuards";
import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";

const stubIdentity = (chainId: string, hash: string) => {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => {
    if (typeof options.body !== "string") {
      throw new Error("Expected a JSON request body");
    }
    const request: unknown = JSON.parse(options.body);
    if (!isRecord(request)) throw new Error("Expected a JSON-RPC request");
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          result: request.method === "qrl_chainId" ? chainId : { hash },
        }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const capabilities = () =>
  executeUnrestrictedMethod({
    method: METHODS.QRL_WALLET_CAPABILITIES,
    senderData: { url: "https://dapp.example/request" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  getActiveChain.mockReset();
});

describe("wallet capabilities with mainnet pinned", () => {
  it("answers with the mainnet pins on mainnet", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    getActiveChain.mockResolvedValue({
      chainId: TEST_MAINNET.chainId,
      defaultRpcUrl: TEST_MAINNET.rpcUrl,
    });
    await expect(capabilities()).resolves.toEqual({
      addressScheme: "qip55-64",
      chainId: TEST_MAINNET.chainId,
      genesisHash: TEST_MAINNET.genesisHash,
    });
  });

  it("answers with the testnet pins on the testnet", async () => {
    stubIdentity(V3_CHAIN_ID, V3_GENESIS_HASH);
    getActiveChain.mockResolvedValue({
      chainId: V3_CHAIN_ID,
      defaultRpcUrl: "https://qrlwallet.com/api/qrl-rpc/testnet",
    });
    await expect(capabilities()).resolves.toEqual({
      addressScheme: "qip55-64",
      chainId: V3_CHAIN_ID,
      genesisHash: V3_GENESIS_HASH,
    });
  });

  it("refuses mainnet when its node reports another genesis", async () => {
    stubIdentity(TEST_MAINNET.chainId, V3_GENESIS_HASH);
    getActiveChain.mockResolvedValue({
      chainId: TEST_MAINNET.chainId,
      defaultRpcUrl: TEST_MAINNET.rpcUrl,
    });
    await expect(capabilities()).rejects.toThrow("pinned QRL mainnet");
  });
});
