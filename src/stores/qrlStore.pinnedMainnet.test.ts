const { TEST_MAINNET } = vi.hoisted(() => ({
  // A stand-in for the launch-day pin. No build ships these values.
  TEST_MAINNET: {
    chainId: "0x1b3a7",
    genesisHash: `0x${"ab".repeat(32)}`,
    rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
    explorer: null,
  },
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  MAINNET: TEST_MAINNET,
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import Web3 from "@theqrl/web3";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_BLOCKCHAINS,
  QRL_MAINNET_BLOCKCHAIN,
  type BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import { V3_CHAIN_ID, V3_GENESIS_HASH } from "@/configuration/releaseProfile";
import { getExplorerApiBase } from "@/configuration/assetDiscoveryConfig";
import { isRecord } from "@/utilities/storageGuards";

/**
 * A build with mainnet pinned. Signing on mainnet carries the mainnet
 * chain ID and is checked against the mainnet genesis; fiat shows only once
 * the mainnet node passed that check.
 */

const { sign } = vi.hoisted(() => ({
  sign: vi.fn<
    () => Promise<{ transactionHash: string; rawTransaction: string }>
  >(),
}));

vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  return {
    ...actual,
    default: class {
      qrl = {
        getTransactionCount: () => Promise.resolve(0n),
        accounts: { signTransaction: sign },
        net: { isListening: () => Promise.resolve(true) },
      };
    },
  };
});

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

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

const requireMainnet = (): BlockchainDataType => {
  if (QRL_MAINNET_BLOCKCHAIN === null) {
    throw new Error("The pinned test build has no mainnet built-in");
  }
  return QRL_MAINNET_BLOCKCHAIN;
};

const storeOn = (blockchain: BlockchainDataType) => {
  const store = new QrlStore();
  store.qrlInstance = new Web3().qrl;
  store.qrlConnection = { ...store.qrlConnection, blockchain };
  return store;
};

describe("a build with mainnet pinned", () => {
  beforeEach(() => {
    sign.mockReset().mockResolvedValue({
      transactionHash: "0xhash",
      rawTransaction: "0xraw",
    });
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(
      undefined,
    );
    vi.spyOn(QrlStore.prototype, "getGasFeeData").mockResolvedValue({
      baseFeePerGas: 1n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 2n,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists the mainnet built-in after the testnet, which stays the default", () => {
    const mainnet = requireMainnet();
    expect(QRL_BLOCKCHAINS.map((chain) => chain.chainId)).toEqual([
      V3_CHAIN_ID,
      TEST_MAINNET.chainId,
    ]);
    expect(DEFAULT_BLOCKCHAIN.chainId).toBe(V3_CHAIN_ID);
    expect(mainnet).toMatchObject({
      chainName: "QRL Mainnet",
      defaultRpcUrl: TEST_MAINNET.rpcUrl,
      defaultBlockExplorerUrl: "",
      blockExplorerUrls: [],
      isTestnet: false,
      isCustomChain: false,
    });
    // No explorer in the pin: no explorer-based discovery for mainnet.
    expect(getExplorerApiBase(TEST_MAINNET.chainId)).toBeUndefined();
  });

  it("signs on mainnet with the mainnet chain ID after checking the mainnet genesis", async () => {
    const rpc = stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const store = storeOn(requireMainnet());
    const result = await store.signNativeToken(
      "from",
      "to",
      "1",
      "test mnemonic",
    );
    expect(result.error).toBe("");
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: TEST_MAINNET.chainId }),
      "test-seed",
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[0]).toBe(TEST_MAINNET.rpcUrl);
  });

  it("refuses to sign on mainnet when the node reports the testnet identity", async () => {
    stubIdentity(V3_CHAIN_ID, V3_GENESIS_HASH);
    const store = storeOn(requireMainnet());
    const result = await store.signNativeToken(
      "from",
      "to",
      "1",
      "test mnemonic",
    );
    expect(result.error).toContain("pinned QRL mainnet");
    expect(sign).not.toHaveBeenCalled();
  });

  it("still signs on the testnet with the testnet chain ID", async () => {
    const store = storeOn(DEFAULT_BLOCKCHAIN);
    const result = await store.signNativeToken(
      "from",
      "to",
      "1",
      "test mnemonic",
    );
    expect(result.error).toBe("");
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: V3_CHAIN_ID }),
      "test-seed",
    );
  });

  it("shows fiat on mainnet only once its node passed the identity check", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const store = storeOn(requireMainnet());
    store.qrlConnection = { ...store.qrlConnection, isConnected: true };
    // Connected, but nothing has checked this node's identity yet.
    expect(store.isFiatNetwork).toBe(false);
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.isFiatNetwork).toBe(true);
  });

  it("drops fiat when the mainnet node stops matching its pin", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const store = storeOn(requireMainnet());
    await store.fetchQrlConnection();
    expect(store.isFiatNetwork).toBe(true);
    stubIdentity(TEST_MAINNET.chainId, V3_GENESIS_HASH);
    await store.fetchQrlConnection();
    expect(store.isFiatNetwork).toBe(false);
  });

  it("shows no fiat on the verified testnet", async () => {
    const store = storeOn(DEFAULT_BLOCKCHAIN);
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.isFiatNetwork).toBe(false);
  });

  it("shows no fiat on the testnet chain ID routed to the mainnet RPC", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const store = storeOn({
      ...DEFAULT_BLOCKCHAIN,
      rpcUrls: [TEST_MAINNET.rpcUrl],
      defaultRpcUrl: TEST_MAINNET.rpcUrl,
      isCustomChain: true,
    });
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.isFiatNetwork).toBe(false);
  });
});
