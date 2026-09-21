vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

describe("amount conversion at the signing boundary", () => {
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

  it.each([
    ["0.0000001", "100000000000"],
    ["0.123456789012345678", "123456789012345678"],
  ])(
    "signs native value %s using the exact original decimal string",
    async (amount, baseUnits) => {
      const store = new QrlStore();
      const sign = vi.fn(async () => ({
        transactionHash: "0xhash",
        rawTransaction: "0xraw",
      }));
      store.qrlInstance = {
        getTransactionCount: async () => 0n,
        accounts: { signTransaction: sign },
      } as never;
      const result = await store.signNativeToken(
        "from",
        "to",
        amount,
        "test mnemonic",
      );
      expect(result.error).toBe("");
      expect(sign).toHaveBeenCalledWith(
        expect.objectContaining({ value: baseUnits }),
        "test-seed",
      );
    },
  );

  it.each([
    ["0.0000001", 18, 100000000000n],
    ["0.123456789012345678", 18, 123456789012345678n],
    ["9007199254740993", 0, 9007199254740993n],
  ])(
    "uses exact token base units for both estimation and signing of %s",
    async (amount, decimals, baseUnits) => {
      const store = new QrlStore();
      const transfer = vi.fn(() => ({
        estimateGas: async () => 45000n,
        encodeABI: () => "0xencoded",
      }));
      class Contract {
        methods = { transfer };
      }
      const sign = vi.fn(async () => ({
        transactionHash: "0xhash",
        rawTransaction: "0xraw",
      }));
      store.qrlInstance = {
        Contract,
        getTransactionCount: async () => 0n,
        accounts: { signTransaction: sign },
      } as never;
      await store.getZrc20TokenGas("from", "to", amount, "contract", decimals);
      const result = await store.signZrc20Token(
        "from",
        "to",
        amount,
        "test mnemonic",
        "contract",
        decimals,
      );
      expect(result.error).toBe("");
      expect(transfer).toHaveBeenCalledTimes(2);
      expect(transfer).toHaveBeenNthCalledWith(1, "to", baseUnits);
      expect(transfer).toHaveBeenNthCalledWith(2, "to", baseUnits);
      expect(sign).toHaveBeenCalledWith(
        expect.objectContaining({ data: "0xencoded" }),
        "test-seed",
      );
    },
  );

  it("refuses excessive token precision before creating transfer calldata or signing", async () => {
    const store = new QrlStore();
    const transfer = vi.fn();
    class Contract {
      methods = { transfer };
    }
    const sign = vi.fn();
    store.qrlInstance = {
      Contract,
      accounts: { signTransaction: sign },
    } as never;
    const result = await store.signZrc20Token(
      "from",
      "to",
      "1.1",
      "test mnemonic",
      "contract",
      0,
    );
    expect(result.error).toMatch(/decimal places/);
    expect(transfer).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
});
