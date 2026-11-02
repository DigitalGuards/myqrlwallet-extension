import { afterEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "@/utilities/storageGuards";
import {
  assertMainnetNetwork,
  assertV3Network,
  MAINNET,
  MAINNET_RPC_URL,
  V3_CHAIN_ID,
  V3_GENESIS_HASH,
  V3_RPC_URL,
  V3_STORAGE_PREFIX,
  V3_TESTNET,
  validateMainnetPin,
  type NetworkPin,
  type PinnedNetwork,
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

describe("testnet profile", () => {
  it("keeps the v3 pins and storage prefix byte-identical", () => {
    expect(V3_CHAIN_ID).toBe("0x301825");
    expect(V3_GENESIS_HASH).toBe(
      "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
    );
    expect(V3_RPC_URL).toBe("https://qrlwallet.com/api/qrl-rpc/testnet");
    expect(V3_STORAGE_PREFIX).toBe(
      "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:",
    );
    expect(V3_TESTNET).toEqual({
      chainId: V3_CHAIN_ID,
      genesisHash: V3_GENESIS_HASH,
      rpcUrl: V3_RPC_URL,
      explorer: "https://zondscan.com",
    });
  });
});

describe("mainnet profile", () => {
  // A stand-in for the launch-day pin. No build ships these values.
  const pinned: PinnedNetwork = {
    chainId: "0x1b3a7",
    genesisHash: `0x${"ab".repeat(32)}`,
    rpcUrl: MAINNET_RPC_URL,
    explorer: null,
  };

  it("makes a half-filled pin a type error", () => {
    type ChainIdOnly = {
      chainId: string;
      genesisHash: null;
      rpcUrl: string;
      explorer: null;
    };
    type GenesisOnly = {
      chainId: null;
      genesisHash: string;
      rpcUrl: string;
      explorer: null;
    };
    const chainIdOnlyRejected: ChainIdOnly extends NetworkPin ? false : true =
      true;
    const genesisOnlyRejected: GenesisOnly extends NetworkPin ? false : true =
      true;
    expect([chainIdOnlyRejected, genesisOnlyRejected]).toEqual([true, true]);
  });

  it("ships dormant, pointed at the mainnet proxy route", () => {
    expect(MAINNET).toEqual({
      chainId: null,
      genesisHash: null,
      rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
      explorer: null,
    });
    expect(() => {
      validateMainnetPin(MAINNET);
    }).not.toThrow();
  });

  it("accepts a well-formed pin distinct from the testnet", () => {
    expect(() => {
      validateMainnetPin(pinned);
    }).not.toThrow();
    expect(() => {
      validateMainnetPin({ ...pinned, explorer: "https://explorer.example" });
    }).not.toThrow();
  });

  it.each([
    [{ ...pinned, chainId: V3_CHAIN_ID }, "differ from the v3 testnet"],
    [{ ...pinned, genesisHash: V3_GENESIS_HASH }, "differ from the v3 testnet"],
    [{ ...pinned, chainId: "0x1B3A7" }, "chain ID"],
    [{ ...pinned, chainId: "1b3a7" }, "chain ID"],
    [{ ...pinned, chainId: "0x0" }, "chain ID"],
    [{ ...pinned, chainId: "0x01b3a7" }, "chain ID"],
    [{ ...pinned, genesisHash: `0x${"AB".repeat(32)}` }, "genesis hash"],
    [{ ...pinned, genesisHash: `0x${"ab".repeat(31)}` }, "genesis hash"],
    [{ ...pinned, explorer: "http://explorer.example" }, "https"],
  ])("rejects a bad pin %#", (pin, message) => {
    expect(() => {
      validateMainnetPin(pin);
    }).toThrow(message);
  });

  it("fails closed before any request while mainnet is dormant", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(assertMainnetNetwork(MAINNET_RPC_URL)).rejects.toThrow(
      "not pinned",
    );
    await expect(
      assertMainnetNetwork(MAINNET_RPC_URL, MAINNET),
    ).rejects.toThrow("not pinned");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks a pinned mainnet against both of its values", async () => {
    network(pinned.chainId, pinned.genesisHash);
    await expect(
      assertMainnetNetwork(MAINNET_RPC_URL, pinned),
    ).resolves.toBeUndefined();
    network(pinned.chainId, V3_GENESIS_HASH);
    await expect(assertMainnetNetwork(MAINNET_RPC_URL, pinned)).rejects.toThrow(
      "pinned QRL mainnet",
    );
    network(V3_CHAIN_ID, pinned.genesisHash);
    await expect(assertMainnetNetwork(MAINNET_RPC_URL, pinned)).rejects.toThrow(
      "pinned QRL mainnet",
    );
  });
});
