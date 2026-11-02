import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import type { NetworkPin, PinnedNetwork } from "@/configuration/releaseProfile";

/**
 * The append-if-missing migration that hands existing installs the
 * built-in mainnet chain once a build pins it. Each case loads the storage
 * layer fresh against either the shipped (dormant) pin or a stand-in pin.
 */

const { localStore } = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  return { localStore: store };
});

vi.mock("webextension-polyfill", () => {
  const area = (store: Record<string, unknown>) => ({
    get: (key: string | null) =>
      Promise.resolve(
        key === null ? { ...store } : key in store ? { [key]: store[key] } : {},
      ),
    set: (data: Record<string, unknown>) => {
      Object.assign(store, data);
      return Promise.resolve();
    },
    remove: (key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key])
        Reflect.deleteProperty(store, item);
      return Promise.resolve();
    },
  });
  const session: Record<string, unknown> = {};
  return {
    __esModule: true,
    default: { storage: { local: area(localStore), session: area(session) } },
  };
});

// A stand-in for the launch-day pin. No build ships these values.
const TEST_MAINNET: PinnedNetwork = {
  chainId: "0x1b3a7",
  genesisHash: `0x${"ab".repeat(32)}`,
  rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
  explorer: null,
};

const TESTNET_STORAGE_PREFIX =
  "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:";
const BLOCKCHAINS_KEY = `${TESTNET_STORAGE_PREFIX}BLOCKCHAINS`;

const loadStorage = async (pin: NetworkPin | null) => {
  vi.resetModules();
  vi.doMock("@/configuration/releaseProfile", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@/configuration/releaseProfile")>();
    return pin === null ? actual : { ...actual, MAINNET: pin };
  });
  const { default: StorageUtil } = await import("@/utilities/storageUtil");
  const config = await import("@/configuration/qrlBlockchainConfig");
  const profile = await import("@/configuration/releaseProfile");
  return { StorageUtil, config, profile };
};

const customChain = (
  chainId: string,
  overrides: Partial<BlockchainDataType> = {},
): BlockchainDataType => ({
  chainId,
  chainName: "My node",
  rpcUrls: ["https://node.example"],
  blockExplorerUrls: [],
  nativeCurrency: { name: "Quanta", symbol: "Quanta", decimals: 18 },
  iconUrls: [],
  defaultRpcUrl: "https://node.example",
  defaultBlockExplorerUrl: "",
  defaultIconUrl: "",
  defaultWsRpcUrl: "",
  isTestnet: false,
  isCustomChain: true,
  ...overrides,
});

const chainIds = (chains: Array<{ chainId: string }>) =>
  chains.map((chain) => chain.chainId);

describe("mainnet built-in migration", () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore))
      Reflect.deleteProperty(localStore, key);
    vi.doUnmock("@/configuration/releaseProfile");
  });

  it("keeps the testnet storage prefix byte-identical", async () => {
    const { profile } = await loadStorage(null);
    expect(profile.V3_STORAGE_PREFIX).toBe(TESTNET_STORAGE_PREFIX);
    const pinned = await loadStorage(TEST_MAINNET);
    expect(pinned.profile.V3_STORAGE_PREFIX).toBe(TESTNET_STORAGE_PREFIX);
  });

  it("changes nothing while mainnet is dormant", async () => {
    const { StorageUtil, config } = await loadStorage(null);
    const stored = {
      ACTIVE_BLOCKCHAIN: "0x301825",
      ALL_BLOCKCHAINS: [config.DEFAULT_BLOCKCHAIN, customChain("0x1")],
    };
    localStore[BLOCKCHAINS_KEY] = structuredClone(stored);
    const before = JSON.stringify(localStore);

    const chains = await StorageUtil.getAllBlockChains();

    expect(chains).toEqual(stored.ALL_BLOCKCHAINS);
    expect(JSON.stringify(localStore)).toBe(before);
    expect(chainIds(await StorageUtil.getAllBlockChains())).toEqual([
      "0x301825",
      "0x1",
    ]);
  });

  it("gives a fresh dormant install the testnet alone", async () => {
    const { StorageUtil } = await loadStorage(null);
    expect(chainIds(await StorageUtil.getAllBlockChains())).toEqual([
      "0x301825",
    ]);
    expect((await StorageUtil.getActiveBlockChain()).chainId).toBe("0x301825");
  });

  it("appends the pinned mainnet built-in to an existing list exactly once", async () => {
    const { StorageUtil, config } = await loadStorage(TEST_MAINNET);
    const custom = customChain("0x1");
    localStore[BLOCKCHAINS_KEY] = {
      ACTIVE_BLOCKCHAIN: "0x301825",
      ALL_BLOCKCHAINS: [config.QRL_BLOCKCHAINS[0], custom],
    };

    const first = await StorageUtil.getAllBlockChains();
    const second = await StorageUtil.getAllBlockChains();

    expect(chainIds(first)).toEqual(["0x301825", "0x1", "0x1b3a7"]);
    expect(second).toEqual(first);
    expect(first[2]).toEqual(config.QRL_MAINNET_BLOCKCHAIN);

    // A later write (an edit or a new custom chain) persists the entry, and
    // reading the persisted list still holds it once.
    await StorageUtil.setAllBlockChains(first);
    const persisted = await StorageUtil.getAllBlockChains();
    expect(chainIds(persisted)).toEqual(["0x301825", "0x1", "0x1b3a7"]);

    // The active chain stays the testnet.
    expect((await StorageUtil.getActiveBlockChain()).chainId).toBe("0x301825");
  });

  it("gives a fresh pinned install the testnet first and mainnet once", async () => {
    const { StorageUtil } = await loadStorage(TEST_MAINNET);
    expect(chainIds(await StorageUtil.getAllBlockChains())).toEqual([
      "0x301825",
      "0x1b3a7",
    ]);
    expect((await StorageUtil.getActiveBlockChain()).chainId).toBe("0x301825");
  });

  it("leaves a custom chain that already holds the mainnet chain ID alone", async () => {
    const { StorageUtil, config } = await loadStorage(TEST_MAINNET);
    const ownNode = customChain("0x1B3A7");
    localStore[BLOCKCHAINS_KEY] = {
      ACTIVE_BLOCKCHAIN: "0x301825",
      ALL_BLOCKCHAINS: [config.QRL_BLOCKCHAINS[0], ownNode],
    };

    const chains = await StorageUtil.getAllBlockChains();

    expect(chainIds(chains)).toEqual(["0x301825", "0x1B3A7"]);
    expect(chains[1]).toEqual(ownNode);
  });
});
