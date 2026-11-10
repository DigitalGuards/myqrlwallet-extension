import { afterEach, describe, expect, it, vi } from "vitest";
import { echoRpcResult } from "@/test-utils/rpcReply";
import { HttpProvider } from "@theqrl/web3-providers-http";
import { V3_CHAIN_ID } from "@/configuration/releaseProfile";
import { UNRESTRICTED_METHODS as METHODS } from "../constants/requestConstants";
import { executeUnrestrictedMethod } from "./unrestrictedMethodExecutor";

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getActiveBlockChain: () =>
      Promise.resolve({
        chainId: V3_CHAIN_ID,
        defaultRpcUrl: "https://rpc.example",
      }),
  },
}));

vi.mock("../lockManager/lockManager", () => ({ default: {} }));

afterEach(() => {
  vi.restoreAllMocks();
});

const NODE_REPLY = {
  startingBlock: "0x0",
  currentBlock: "0x1a4",
  highestBlock: "0x2710",
  syncedAccounts: "0x3e8",
  healedTrienodes: "0x7",
};

describe("qrl_syncing through installed Web3", () => {
  it("returns the node's hex quantities for a syncing node", async () => {
    const send = vi
      .spyOn(HttpProvider.prototype, "request")
      .mockImplementation(echoRpcResult(NODE_REPLY));

    const result = await executeUnrestrictedMethod({
      method: METHODS.QRL_SYNCING,
      params: [],
    });

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ method: "qrl_syncing" }),
    );
    expect(result).toEqual(NODE_REPLY);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() => structuredClone(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result))).toEqual(NODE_REPLY);
  });

  it("round-trips the quantities to the node's numbers", async () => {
    vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
      echoRpcResult(NODE_REPLY),
    );

    const result = await executeUnrestrictedMethod({
      method: METHODS.QRL_SYNCING,
      params: [],
    });

    const wire: unknown = JSON.parse(JSON.stringify(result));
    const numbers: Record<string, number> = {};
    if (typeof wire !== "object" || wire === null) throw new Error("no object");
    for (const [key, value] of Object.entries(wire)) {
      expect(value).toMatch(/^0x[0-9a-f]+$/);
      numbers[key] = Number(BigInt(String(value)));
    }
    expect(numbers).toEqual({
      startingBlock: 0,
      currentBlock: 420,
      highestBlock: 10000,
      syncedAccounts: 1000,
      healedTrienodes: 7,
    });
  });

  it("returns false for a node that is not syncing", async () => {
    vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
      echoRpcResult(false),
    );

    await expect(
      executeUnrestrictedMethod({ method: METHODS.QRL_SYNCING, params: [] }),
    ).resolves.toBe(false);
  });
});
