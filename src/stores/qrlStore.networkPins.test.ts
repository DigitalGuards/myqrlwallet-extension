vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
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
import {
  assertV3Network,
  MAINNET,
  MAINNET_RPC_URL,
  V3_CHAIN_ID,
} from "@/configuration/releaseProfile";
import { UNSUPPORTED_NETWORK_MESSAGE } from "@/configuration/pinnedNetworks";

/**
 * The build as it ships today: mainnet pins are null. The testnet keeps
 * signing exactly as before, nothing signs for a chain on the mainnet RPC,
 * and fiat never shows.
 */

const { sign, send } = vi.hoisted(() => ({
  sign: vi.fn<
    () => Promise<{ transactionHash: string; rawTransaction: string }>
  >(),
  send: vi.fn(),
}));

vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  return {
    ...actual,
    default: class {
      qrl = {
        Contract: class {
          methods = {
            transfer: () => ({ encodeABI: () => "0xencoded" }),
          };
        },
        getTransactionCount: () => Promise.resolve(0n),
        accounts: { signTransaction: sign },
        sendSignedTransaction: send,
        net: { isListening: () => Promise.resolve(true) },
      };
    },
  };
});

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

const mainnetRpcChain = (chainId: string): BlockchainDataType => ({
  ...DEFAULT_BLOCKCHAIN,
  chainId,
  chainName: "Mainnet via proxy",
  rpcUrls: [MAINNET_RPC_URL],
  defaultRpcUrl: MAINNET_RPC_URL,
  isTestnet: false,
  isCustomChain: true,
});

const storeOn = (blockchain: BlockchainDataType) => {
  const store = new QrlStore();
  store.qrlInstance = new Web3().qrl;
  store.qrlConnection = { ...store.qrlConnection, blockchain };
  return store;
};

describe("signing and fiat while mainnet is dormant", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    sign.mockReset().mockResolvedValue({
      transactionHash: "0xhash",
      rawTransaction: "0xraw",
    });
    send.mockReset();
    vi.mocked(assertV3Network).mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
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

  it("ships with null mainnet pins and no mainnet built-in", () => {
    expect(MAINNET).toEqual({
      chainId: null,
      genesisHash: null,
      rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
      explorer: null,
    });
    expect(QRL_MAINNET_BLOCKCHAIN).toBeNull();
    expect(QRL_BLOCKCHAINS).toHaveLength(1);
    expect(DEFAULT_BLOCKCHAIN.chainId).toBe(V3_CHAIN_ID);
  });

  it("signs on the testnet with the testnet chain ID, checked against the v3 pins", async () => {
    const store = storeOn(DEFAULT_BLOCKCHAIN);
    const result = await store.signNativeToken(
      "from",
      "to",
      "1",
      "test mnemonic",
    );
    expect(result.error).toBe("");
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "0x301825", type: 2 }),
      "test-seed",
    );
    expect(assertV3Network).toHaveBeenCalledExactlyOnceWith(
      DEFAULT_BLOCKCHAIN.defaultRpcUrl,
    );
  });

  it.each([V3_CHAIN_ID, "0x1b3a7", "0x1"])(
    "refuses to sign for chain %s on the mainnet RPC",
    async (chainId) => {
      const store = storeOn(mainnetRpcChain(chainId));
      const result = await store.signNativeToken(
        "from",
        "to",
        "1",
        "test mnemonic",
      );
      expect(result.error).toContain(UNSUPPORTED_NETWORK_MESSAGE);
      expect(sign).not.toHaveBeenCalled();
      expect(assertV3Network).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses token signing on the mainnet RPC", async () => {
    const store = storeOn(mainnetRpcChain(V3_CHAIN_ID));
    const token = await store.signZrc20Token(
      "from",
      "to",
      "1",
      "test mnemonic",
      "contract",
      18,
    );
    expect(token.error).toContain(UNSUPPORTED_NETWORK_MESSAGE);
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses to broadcast through the mainnet RPC", async () => {
    const store = storeOn(mainnetRpcChain(V3_CHAIN_ID));
    await expect(store.sendRawTransaction("0xraw")).rejects.toThrow(
      UNSUPPORTED_NETWORK_MESSAGE,
    );
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a chain on the mainnet RPC as disconnected without any request", async () => {
    const store = storeOn(mainnetRpcChain(V3_CHAIN_ID));
    store.qrlConnection = { ...store.qrlConnection, isConnected: true };
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.isFiatNetwork).toBe(false);
  });

  it("shows no fiat on a connected, verified testnet", async () => {
    const store = storeOn(DEFAULT_BLOCKCHAIN);
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(true);
    expect(store.isFiatNetwork).toBe(false);
  });

  it("shows no fiat on a connected custom chain", () => {
    const store = storeOn({
      ...DEFAULT_BLOCKCHAIN,
      chainId: "0x1",
      isCustomChain: true,
    });
    store.qrlConnection = { ...store.qrlConnection, isConnected: true };
    expect(store.isFiatNetwork).toBe(false);
  });
});
