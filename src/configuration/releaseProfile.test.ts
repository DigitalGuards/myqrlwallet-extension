import { afterEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "@/utilities/storageGuards";
import {
  assertV3Network,
  V3_CHAIN_ID,
  V3_GENESIS_HASH,
} from "./releaseProfile";

afterEach(() => vi.unstubAllGlobals());

const networkResults = (chainId: unknown, genesis: unknown) => {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => {
    if (typeof options.body !== "string") {
      throw new Error("Expected a JSON request body");
    }
    const request: unknown = JSON.parse(options.body);
    if (!isRecord(request)) {
      throw new Error("Expected a JSON-RPC request object");
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          result: request.method === "qrl_chainId" ? chainId : genesis,
        }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const network = (chainId = V3_CHAIN_ID, hash = V3_GENESIS_HASH) =>
  networkResults(chainId, { hash });

describe("v3 network identity", () => {
  it("requires both the chain ID and pinned genesis", async () => {
    const rpc = network();
    await expect(
      assertV3Network("https://rpc.example"),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toMatchObject([
      "https://rpc.example",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "qrl_chainId",
          params: [],
        }),
      },
    ]);
    expect(rpc.mock.calls[1]).toMatchObject([
      "https://rpc.example",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "qrl_getBlockByNumber",
          params: ["0x0", false],
        }),
      },
    ]);
    for (const [, options] of rpc.mock.calls) {
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("accepts case variants of the pinned identity", async () => {
    network(V3_CHAIN_ID.toUpperCase(), V3_GENESIS_HASH.toUpperCase());
    await expect(
      assertV3Network("https://rpc.example"),
    ).resolves.toBeUndefined();
  });

  it.each([null, undefined, true, 42, "reply", []])(
    "rejects a malformed RPC envelope: %j",
    async (payload) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(payload),
        }),
      );
      await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
        "unavailable",
      );
    },
  );

  it.each([
    null,
    undefined,
    42,
    [],
    {},
    { hash: null },
    { hash: 42 },
    { hash: {} },
  ])("rejects a malformed genesis result: %j", async (genesis) => {
    networkResults(V3_CHAIN_ID, genesis);
    await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
      "pinned v3",
    );
  });

  it.each([null, undefined, 42, [], {}])(
    "rejects a malformed chain ID: %j",
    async (chainId) => {
      networkResults(chainId, { hash: V3_GENESIS_HASH });
      await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
        "pinned v3",
      );
    },
  );

  it("propagates a rejected response body", async () => {
    const error = new SyntaxError("Invalid JSON response");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(error),
      }),
    );
    await expect(assertV3Network("https://rpc.example")).rejects.toBe(error);
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
        json: () => Promise.resolve({ error: { code: -1 } }),
      }),
    );
    await expect(assertV3Network("https://rpc.example")).rejects.toThrow(
      "unavailable",
    );
  });
});
