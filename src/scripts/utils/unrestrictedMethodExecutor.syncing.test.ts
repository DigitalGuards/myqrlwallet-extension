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
  it.each([
    ["a syncing node", NODE_REPLY],
    [
      "a reply with a field web3 does not know",
      { ...NODE_REPLY, txIndexRemainingBlocks: "0x5" },
    ],
    [
      "a reply without startingBlock",
      { currentBlock: "0x1a4", highestBlock: "0x2710" },
    ],
  ])(
    "passes the node's reply through unchanged for %s",
    async (_name, reply) => {
      const send = vi
        .spyOn(HttpProvider.prototype, "request")
        .mockImplementation(echoRpcResult(reply));

      const result = await executeUnrestrictedMethod({
        method: METHODS.QRL_SYNCING,
        params: [],
      });

      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ method: "qrl_syncing" }),
      );
      expect(result).toEqual(reply);
      expect(() => structuredClone(result)).not.toThrow();
      expect(JSON.parse(JSON.stringify(result))).toEqual(reply);
    },
  );

  it("returns false for a node that is not syncing", async () => {
    vi.spyOn(HttpProvider.prototype, "request").mockImplementation(
      echoRpcResult(false),
    );

    await expect(
      executeUnrestrictedMethod({ method: METHODS.QRL_SYNCING, params: [] }),
    ).resolves.toBe(false);
  });
});
