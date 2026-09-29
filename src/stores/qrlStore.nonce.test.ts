vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import { SIGNING_NONCE_BLOCK_TAG } from "@/constants/transactionNonce";

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

const signed = {
  transactionHash: "0xhash",
  rawTransaction: "0xraw",
};

/**
 * Two sends started inside one 60 s slot must not sign the same nonce.
 * Every signing path therefore reads the count at the pending block, which
 * includes what the node already holds in its mempool.
 */
describe("nonce reads at the signing boundary", () => {
  beforeEach(() => {
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(
      undefined,
    );
    vi.spyOn(QrlStore.prototype, "getGasFeeData").mockResolvedValue({
      baseFeePerGas: 1n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 2n,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("pins every signing path to the pending block tag", () => {
    expect(SIGNING_NONCE_BLOCK_TAG).toBe("pending");
  });

  it("reads the native transfer nonce at the pending block", async () => {
    const store = new QrlStore();
    const getTransactionCount = vi.fn(async () => 7n);
    store.qrlInstance = {
      getTransactionCount,
      accounts: { signTransaction: async () => signed },
    } as never;

    const result = await store.signNativeToken("from", "to", "1", "mnemonic");

    expect(result.error).toBe("");
    expect(getTransactionCount).toHaveBeenCalledWith("from", "pending");
    expect(result.nonce).toBe(7);
  });

  it("reads the ZRC-20 transfer nonce at the pending block", async () => {
    const store = new QrlStore();
    const getTransactionCount = vi.fn(async () => 7n);
    class Contract {
      methods = {
        transfer: () => ({
          estimateGas: async () => 45000n,
          encodeABI: () => "0xencoded",
        }),
      };
    }
    store.qrlInstance = {
      Contract,
      getTransactionCount,
      accounts: { signTransaction: async () => signed },
    } as never;

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
    const store = new QrlStore();
    const getTransactionCount = vi.fn(async () => 7n);
    class Contract {
      methods = {
        safeTransferFrom: () => ({
          estimateGas: async () => 90000n,
          encodeABI: () => "0xencoded",
        }),
      };
    }
    store.qrlInstance = {
      Contract,
      getTransactionCount,
      accounts: { signTransaction: async () => signed },
    } as never;

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
    const store = new QrlStore();
    // What a node reports at "pending" once the first send is in its
    // mempool: "latest" would still answer 4 for both.
    const pendingCounts = [4n, 5n];
    const getTransactionCount = vi.fn(async () => pendingCounts.shift() ?? 5n);
    store.qrlInstance = {
      getTransactionCount,
      accounts: { signTransaction: async () => signed },
    } as never;

    const first = await store.signNativeToken("from", "to", "1", "mnemonic");
    const second = await store.signNativeToken("from", "to", "1", "mnemonic");

    expect(first.nonce).toBe(4);
    expect(second.nonce).toBe(5);
  });
});
