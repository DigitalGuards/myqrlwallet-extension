import { afterEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "@/utilities/storageGuards";
import { DEFAULT_BLOCKCHAIN } from "./qrlBlockchainConfig";
import {
  assertPinnedIdentity,
  isFiatChain,
  isMainnetRpcUrl,
  pinnedMainnet,
  requireSigningNetwork,
  signingNetworkFor,
  UNSUPPORTED_NETWORK_MESSAGE,
} from "./pinnedNetworks";
import {
  MAINNET,
  MAINNET_RPC_URL,
  V3_CHAIN_ID,
  V3_GENESIS_HASH,
  V3_TESTNET,
  type NetworkPin,
  type PinnedNetwork,
} from "./releaseProfile";

afterEach(() => vi.unstubAllGlobals());

// A stand-in for the launch-day pin. No build ships these values.
const TEST_MAINNET: PinnedNetwork = {
  chainId: "0x1b3a7",
  genesisHash: `0x${"ab".repeat(32)}`,
  rpcUrl: MAINNET_RPC_URL,
  explorer: null,
};
const DORMANT: NetworkPin = MAINNET;

const chain = (chainId: string, defaultRpcUrl: string) => ({
  chainId,
  defaultRpcUrl,
});

const stubIdentity = (chainId: unknown, hash: unknown) => {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => {
    if (typeof options.body !== "string") {
      throw new Error("Expected a JSON request body");
    }
    const request: unknown = JSON.parse(options.body);
    if (!isRecord(request)) throw new Error("Expected a JSON-RPC request");
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          result: request.method === "qrl_chainId" ? chainId : { hash },
        }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("the shipped mainnet pin", () => {
  it("is dormant", () => {
    expect(pinnedMainnet()).toBeNull();
    expect(pinnedMainnet(DORMANT)).toBeNull();
  });
});

describe("mainnet RPC route matching", () => {
  it.each([
    MAINNET_RPC_URL,
    `${MAINNET_RPC_URL}/`,
    `${MAINNET_RPC_URL}//`,
    "HTTPS://QRLWALLET.COM/api/qrl-rpc/MAINNET",
    `${MAINNET_RPC_URL}?session=1`,
    ` ${MAINNET_RPC_URL} `,
  ])("treats %j as the mainnet route", (url) => {
    expect(isMainnetRpcUrl(url)).toBe(true);
  });

  it.each([
    "https://qrlwallet.com/api/qrl-rpc/testnet",
    "https://qrlwallet.com/api/qrl-rpc/mainnet-archive",
    "http://qrlwallet.com/api/qrl-rpc/mainnet",
    "https://rpc.example/api/qrl-rpc/mainnet",
    "not a url",
    "",
    42,
    null,
    undefined,
  ])("does not treat %j as the mainnet route", (url) => {
    expect(isMainnetRpcUrl(url)).toBe(false);
  });
});

describe("signing network resolution while mainnet is dormant", () => {
  it("resolves the built-in testnet to the v3 pin", () => {
    expect(signingNetworkFor(DEFAULT_BLOCKCHAIN)).toBe(V3_TESTNET);
    expect(signingNetworkFor(chain("0X301825", "https://rpc.example"))).toBe(
      V3_TESTNET,
    );
  });

  it.each([
    ["0x301825", MAINNET_RPC_URL],
    ["0x301825", `${MAINNET_RPC_URL}/`],
    [TEST_MAINNET.chainId, MAINNET_RPC_URL],
    ["0x1", MAINNET_RPC_URL],
  ])("refuses chain %s on the mainnet RPC", (chainId, rpcUrl) => {
    expect(signingNetworkFor(chain(chainId, rpcUrl))).toBeNull();
    expect(() => requireSigningNetwork(chain(chainId, rpcUrl))).toThrow(
      UNSUPPORTED_NETWORK_MESSAGE,
    );
  });

  it.each(["0x1", "0x539", TEST_MAINNET.chainId, "0x0301825", ""])(
    "refuses unpinned chain %j",
    (chainId) => {
      expect(
        signingNetworkFor(chain(chainId, "https://rpc.example")),
      ).toBeNull();
    },
  );

  it("refuses a record without a readable chain ID", () => {
    expect(signingNetworkFor({ defaultRpcUrl: V3_TESTNET.rpcUrl })).toBeNull();
    expect(signingNetworkFor({ chainId: 3151909 })).toBeNull();
  });
});

describe("signing network resolution once mainnet is pinned", () => {
  it("resolves the mainnet chain ID on its route or on any other RPC", () => {
    expect(
      signingNetworkFor(
        chain(TEST_MAINNET.chainId, MAINNET_RPC_URL),
        TEST_MAINNET,
      ),
    ).toBe(TEST_MAINNET);
    expect(
      signingNetworkFor(
        chain(TEST_MAINNET.chainId.toUpperCase(), "https://node.example"),
        TEST_MAINNET,
      ),
    ).toBe(TEST_MAINNET);
  });

  it("keeps the mainnet route bound to the mainnet chain ID", () => {
    expect(
      signingNetworkFor(chain(V3_CHAIN_ID, MAINNET_RPC_URL), TEST_MAINNET),
    ).toBeNull();
  });

  it("still resolves the testnet", () => {
    expect(signingNetworkFor(DEFAULT_BLOCKCHAIN, TEST_MAINNET)).toBe(
      V3_TESTNET,
    );
  });
});

describe("pinned identity checks", () => {
  it("checks the testnet against the v3 pins with the same two calls", async () => {
    const rpc = stubIdentity(V3_CHAIN_ID, V3_GENESIS_HASH);
    await expect(
      assertPinnedIdentity("https://rpc.example", V3_TESTNET),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("checks the mainnet against its own pins", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    await expect(
      assertPinnedIdentity(MAINNET_RPC_URL, TEST_MAINNET),
    ).resolves.toBeUndefined();
  });

  it("refuses a mainnet RPC that answers with the testnet identity", async () => {
    stubIdentity(V3_CHAIN_ID, V3_GENESIS_HASH);
    await expect(
      assertPinnedIdentity(MAINNET_RPC_URL, TEST_MAINNET),
    ).rejects.toThrow("pinned QRL mainnet");
  });

  it("refuses a node with the mainnet chain ID under another genesis", async () => {
    stubIdentity(TEST_MAINNET.chainId, V3_GENESIS_HASH);
    await expect(
      assertPinnedIdentity("https://node.example", TEST_MAINNET),
    ).rejects.toThrow("pinned QRL mainnet");
  });
});

describe("fiat display gate", () => {
  it("shows no fiat on the v3 testnet", () => {
    expect(isFiatChain(DEFAULT_BLOCKCHAIN)).toBe(false);
    expect(isFiatChain(DEFAULT_BLOCKCHAIN, TEST_MAINNET)).toBe(false);
  });

  it.each([
    chain("0x1", "https://rpc.example"),
    chain("0x301825", "http://127.0.0.1:8545"),
    chain(TEST_MAINNET.chainId, "https://node.example"),
    chain(TEST_MAINNET.chainId, MAINNET_RPC_URL),
    chain("0x301825", MAINNET_RPC_URL),
  ])("shows no fiat on %j while mainnet pins are null", (record) => {
    expect(isFiatChain(record)).toBe(false);
    expect(isFiatChain(record, DORMANT)).toBe(false);
  });

  it.each([null, undefined, {}])(
    "shows no fiat without a chain: %j",
    (value) => {
      expect(isFiatChain(value)).toBe(false);
    },
  );

  it("shows no fiat on custom chains under other IDs once mainnet is pinned", () => {
    expect(isFiatChain(chain("0x1", "https://rpc.example"), TEST_MAINNET)).toBe(
      false,
    );
    expect(isFiatChain(chain(V3_CHAIN_ID, MAINNET_RPC_URL), TEST_MAINNET)).toBe(
      false,
    );
  });

  it("shows fiat on the pinned mainnet", () => {
    expect(
      isFiatChain(chain(TEST_MAINNET.chainId, MAINNET_RPC_URL), TEST_MAINNET),
    ).toBe(true);
  });
});
