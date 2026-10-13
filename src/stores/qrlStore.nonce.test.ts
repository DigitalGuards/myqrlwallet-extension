vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import Web3 from "@theqrl/web3";
import { SIGNING_NONCE_BLOCK_TAG } from "@/constants/transactionNonce";

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

const { getTransactionCount, signTransaction } = vi.hoisted(() => ({
  getTransactionCount:
    vi.fn<(address: string, block: string) => Promise<bigint>>(),
  signTransaction:
    vi.fn<() => Promise<{ transactionHash: string; rawTransaction: string }>>(),
}));

vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  class Contract {
    methods = {
      transfer: () => ({
        estimateGas: () => Promise.resolve(45000n),
        encodeABI: () => "0xencoded",
      }),
      safeTransferFrom: () => ({
        estimateGas: () => Promise.resolve(90000n),
        encodeABI: () => "0xencoded",
      }),
    };
  }
  return {
    ...actual,
    default: class {
      qrl = { Contract, getTransactionCount, accounts: { signTransaction } };
    },
  };
});

const createStore = () => {
  const store = new QrlStore();
  store.qrlInstance = new Web3().qrl;
  return store;
};

/**
 * Two sends started inside one 60 s slot must not sign the same nonce.
 * Every signing path therefore reads the count at the pending block, which
 * includes what the node already holds in its mempool.
 */
describe("nonce reads at the signing boundary", () => {
  beforeEach(() => {
    getTransactionCount.mockReset().mockResolvedValue(7n);
    signTransaction.mockReset().mockResolvedValue({
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
  });

  it("pins every signing path to the pending block tag", () => {
    expect(SIGNING_NONCE_BLOCK_TAG).toBe("pending");
  });

  it("reads the native transfer nonce at the pending block", async () => {
    const store = createStore();

    const result = await store.signNativeToken("from", "to", "1", "mnemonic");

    expect(result.error).toBe("");
    expect(getTransactionCount).toHaveBeenCalledWith("from", "pending");
    expect(result.nonce).toBe(7);
  });

  it("reads the ZRC-20 transfer nonce at the pending block", async () => {
    const store = createStore();

    const result = await store.signZrc20Token(
      "from",
      "to",
      "1",
      "mnemonic",
      "contract",
      18,
    );

    expect(result.error).toBe("");
    expect(getTransactionCount).toHaveBeenCalledWith("from", "pending");
  });

  it("reads the NFT transfer nonce at the pending block", async () => {
    const store = createStore();

    const result = await store.signNftTransfer(
      "from",
      "to",
      "1",
      "mnemonic",
      "contract",
      "ZRC721",
    );

    expect(result.error).toBe("");
    expect(getTransactionCount).toHaveBeenCalledWith("from", "pending");
  });

  it("advances the nonce between two sends inside one block", async () => {
    const store = createStore();
    // The pending count includes the first send once it reaches the mempool.
    getTransactionCount.mockResolvedValueOnce(4n).mockResolvedValueOnce(5n);

    const first = await store.signNativeToken("from", "to", "1", "mnemonic");
    const second = await store.signNativeToken("from", "to", "1", "mnemonic");

    expect(first.nonce).toBe(4);
    expect(second.nonce).toBe(5);
  });
});
