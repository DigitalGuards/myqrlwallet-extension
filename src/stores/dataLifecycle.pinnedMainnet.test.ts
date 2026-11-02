const { TEST_MAINNET } = vi.hoisted(() => ({
  // A stand-in for the launch-day pin. No build ships these values.
  TEST_MAINNET: {
    chainId: "0x1b3a7",
    genesisHash: `0x${"ab".repeat(32)}`,
    rpcUrl: "https://qrlwallet.com/api/qrl-rpc/mainnet",
    explorer: null,
  },
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  MAINNET: TEST_MAINNET,
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  return {
    ...actual,
    default: class {
      qrl = { net: { isListening: () => Promise.resolve(true) } };
    },
  };
});

import { observable } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_MAINNET_BLOCKCHAIN,
  type BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import { V3_GENESIS_HASH } from "@/configuration/releaseProfile";
import { isRecord } from "@/utilities/storageGuards";
import QrlStore from "./qrlStore";
import { wireDataLifecycle } from "./store";

/**
 * The price poll against the real QrlStore.isFiatNetwork computed, in a
 * build with mainnet pinned. dataLifecycle.test.ts drives the same wiring
 * with a plain observable flag; this proves the real computed feeds it:
 * prices are fetched only while the active chain is the pinned mainnet and
 * its node passed the identity check.
 */

const stubIdentity = (chainId: string, hash: string) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, options: RequestInit) => {
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
    }),
  );
};

const requireMainnet = (): BlockchainDataType => {
  if (QRL_MAINNET_BLOCKCHAIN === null) {
    throw new Error("The pinned test build has no mainnet built-in");
  }
  return QRL_MAINNET_BLOCKCHAIN;
};

const disposers: Array<() => void> = [];

/** Real QrlStore on `blockchain`, unlocked, with the setting on. */
const wireOn = async (blockchain: BlockchainDataType) => {
  const qrlStore = new QrlStore();
  qrlStore.qrlInstance = new Web3().qrl;
  qrlStore.qrlConnection = { ...qrlStore.qrlConnection, blockchain };
  const lockStore = observable({ isLocked: false });
  const settingsStore = observable(
    {
      showBalanceAndPrice: true,
      whenSettingsLoaded: () => Promise.resolve(),
    },
    { whenSettingsLoaded: false },
  );
  const priceStore = { setRefreshEnabled: vi.fn() };
  const dispose = wireDataLifecycle({
    lockStore,
    settingsStore,
    qrlStore,
    priceStore,
  });
  disposers.push(dispose);
  await dispose.priceWiring;
  return { qrlStore, priceStore };
};

describe("price polling follows the real QrlStore, with mainnet pinned", () => {
  beforeEach(() => {
    // The constructor starts initialization, and the lock reaction starts
    // the balance poll. Neither belongs to what is checked here.
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(
      undefined,
    );
    vi.spyOn(QrlStore.prototype, "setPollingAllowed").mockImplementation(
      () => {},
    );
    vi.spyOn(QrlStore.prototype, "pollBalancesAndConnection").mockResolvedValue(
      undefined,
    );
  });
  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts polling only once the pinned mainnet node passed the identity check", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const { qrlStore, priceStore } = await wireOn(requireMainnet());
    // Active chain is mainnet, but nothing has checked its node yet.
    expect(qrlStore.isFiatNetwork).toBe(false);
    expect(priceStore.setRefreshEnabled).toHaveBeenCalledExactlyOnceWith(false);

    await qrlStore.fetchQrlConnection();

    expect(qrlStore.isFiatNetwork).toBe(true);
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);
  });

  it("stops polling when the mainnet node stops matching its pin", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const { qrlStore, priceStore } = await wireOn(requireMainnet());
    await qrlStore.fetchQrlConnection();
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);

    stubIdentity(TEST_MAINNET.chainId, V3_GENESIS_HASH);
    await qrlStore.fetchQrlConnection();

    expect(qrlStore.isFiatNetwork).toBe(false);
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(false);
  });

  it("stops polling when the active chain switches to the testnet", async () => {
    stubIdentity(TEST_MAINNET.chainId, TEST_MAINNET.genesisHash);
    const { qrlStore, priceStore } = await wireOn(requireMainnet());
    await qrlStore.fetchQrlConnection();
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(true);

    qrlStore.qrlConnection = {
      ...qrlStore.qrlConnection,
      blockchain: DEFAULT_BLOCKCHAIN,
    };

    expect(qrlStore.isFiatNetwork).toBe(false);
    expect(priceStore.setRefreshEnabled).toHaveBeenLastCalledWith(false);
  });

  it("never polls on the verified testnet", async () => {
    const { qrlStore, priceStore } = await wireOn(DEFAULT_BLOCKCHAIN);

    await qrlStore.fetchQrlConnection();

    expect(qrlStore.qrlConnection.isConnected).toBe(true);
    expect(priceStore.setRefreshEnabled).not.toHaveBeenCalledWith(true);
  });
});
