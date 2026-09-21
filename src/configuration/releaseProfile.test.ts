import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertV3Network,
  V3_CHAIN_ID,
  V3_GENESIS_HASH,
} from "./releaseProfile";

afterEach(() => vi.unstubAllGlobals());

const network = (chainId = V3_CHAIN_ID, hash = V3_GENESIS_HASH) => {
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    return {
      ok: true,
      json: async () => ({
        result: request.method === "qrl_chainId" ? chainId : { hash },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("v3 network identity", () => {
  it("requires both the chain ID and pinned genesis", async () => {
    const rpc = network();
    await expect(
      assertV3Network("https://rpc.example"),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["0x539", V3_GENESIS_HASH],
    [V3_CHAIN_ID, `0x${"0".repeat(64)}`],
  ])("rejects a mismatched identity", async (chainId, genesis) => {
    network(chainId, genesis);
    await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
      "pinned v3",
    );
  });

  it("fails closed on transport and JSON-RPC failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
      "unavailable",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: { code: -1 } }),
      }),
    );
    await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
      "unavailable",
    );
  });
});
