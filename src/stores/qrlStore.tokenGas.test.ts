import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@theqrl/web3", () => {
  class MockWeb3 {
    static providers = { HttpProvider: class {} };
    qrl = {};
    constructor(_opts: unknown) {}
  }
  return {
    __esModule: true,
    default: MockWeb3,
    utils: {
      fromPlanck: (v: bigint) => (Number(v) / 1e18).toString(),
      toPlanck: (v: string) => BigInt(v) * BigInt(1e9),
    },
  };
});

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getAllAccounts: vi.fn().mockResolvedValue([]),
    getAllBlockChains: vi.fn().mockResolvedValue([]),
    getActiveBlockChain: vi.fn().mockResolvedValue(""),
    getActiveAccount: vi.fn().mockResolvedValue(""),
    clearActiveAccount: vi.fn().mockResolvedValue(undefined),
    setAllAccounts: vi.fn().mockResolvedValue(undefined),
  },
}));

import QrlStore from "./qrlStore";

const FROM = `Q${"a".repeat(128)}`;
const TO = `Q${"b".repeat(128)}`;
const CONTRACT = `Q${"c".repeat(128)}`;

/**
 * A store with just enough of a contract handle for getZrc20TokenGas.
 * `transfer` returns the call/estimate stubs handed in.
 */
const storeWithContract = (transferStubs: {
  call?: ReturnType<typeof vi.fn>;
  estimateGas?: ReturnType<typeof vi.fn>;
}) => {
  vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue();
  const store = new QrlStore();
  const transfer = vi.fn(() => ({
    call: transferStubs.call ?? vi.fn().mockResolvedValue(true),
    estimateGas:
      transferStubs.estimateGas ?? vi.fn().mockResolvedValue(BigInt(60000)),
  }));
  store.qrlInstance = {
    Contract: class {
      methods = { transfer };
    },
    getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: BigInt(1000) }),
  } as never;
  return { store, transfer };
};

describe("getZrc20TokenGas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("estimates normally without an advanced gas limit", async () => {
    const estimateGas = vi.fn().mockResolvedValue(BigInt(60000));
    const call = vi.fn().mockResolvedValue(true);
    const { store } = storeWithContract({ call, estimateGas });

    const fee = await store.getZrc20TokenGas(FROM, TO, "1", CONTRACT, 18);

    expect(estimateGas).toHaveBeenCalledWith({ from: FROM });
    expect(call).not.toHaveBeenCalled();
    expect(fee).toBeTruthy();
  });

  it("simulates the transfer when an advanced gas limit replaces the estimate", async () => {
    const estimateGas = vi.fn().mockResolvedValue(BigInt(60000));
    const call = vi.fn().mockResolvedValue(true);
    const { store } = storeWithContract({ call, estimateGas });

    const fee = await store.getZrc20TokenGas(FROM, TO, "1", CONTRACT, 18, {
      tier: "advanced",
      gasLimit: 90000,
    });

    // The estimate is replaced, the simulation is not: a reverting
    // transfer still has to surface before anything is signed.
    expect(estimateGas).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith({ from: FROM, gas: "90000" });
    expect(fee).toBeTruthy();
  });

  it("surfaces a revert from that simulation", async () => {
    const call = vi.fn().mockRejectedValue(new Error("execution reverted"));
    const { store } = storeWithContract({ call });

    await expect(
      store.getZrc20TokenGas(FROM, TO, "1", CONTRACT, 18, {
        tier: "advanced",
        gasLimit: 90000,
      }),
    ).rejects.toThrow("execution reverted");
  });
});
