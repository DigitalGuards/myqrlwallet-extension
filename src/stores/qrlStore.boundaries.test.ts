import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
import {
  DEFAULT_BLOCKCHAIN,
  type BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import { ERC_721_INTERFACE_ID, NFT_UNITS_OF_GAS } from "@/constants/nftToken";
import { malformed } from "@/test-utils/malformed";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import StorageUtil from "@/utilities/storageUtil";
import type { AddedBlockchainData } from "@/utilities/approvalGuards";
import QrlStore, { BALANCE_POLL_INTERVAL_MS } from "./qrlStore";

const { responses, call, estimateGas, encodeABI, rpc, discover } = vi.hoisted(
  () => ({
    responses: new Map<string, unknown>(),
    call: vi.fn<(method: string, args: unknown[]) => Promise<unknown>>(),
    estimateGas: vi.fn<() => Promise<unknown>>(),
    encodeABI: vi.fn<() => string>(),
    rpc: {
      getBlock: vi.fn<() => Promise<unknown>>(),
      getBalance: vi.fn<() => Promise<unknown>>(),
      getTransactionCount: vi.fn<() => Promise<unknown>>(),
      requestManager: { send: vi.fn<() => Promise<unknown>>() },
      net: { isListening: vi.fn<() => Promise<unknown>>() },
      accounts: { signTransaction: vi.fn<() => Promise<unknown>>() },
      sendSignedTransaction: vi.fn<() => unknown>(),
    },
    discover: vi.fn<() => Promise<{ tokenId: string; standard: string }[]>>(),
  }),
);

vi.mock("@theqrl/web3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@theqrl/web3")>();
  const method =
    (name: string) =>
    (...args: unknown[]) => ({
      call: () => call(name, args),
      estimateGas,
      encodeABI,
    });
  class Contract {
    methods = {
      name: method("name"),
      symbol: method("symbol"),
      decimals: method("decimals"),
      totalSupply: method("totalSupply"),
      balanceOf: method("balanceOf"),
      supportsInterface: method("supportsInterface"),
      tokenOfOwnerByIndex: method("tokenOfOwnerByIndex"),
      ownerOf: method("ownerOf"),
      tokenURI: method("tokenURI"),
      uri: method("uri"),
      transfer: method("transfer"),
      safeTransferFrom: method("safeTransferFrom"),
    };
  }
  return {
    ...actual,
    default: class {
      qrl = { ...rpc, Contract };
    },
  };
});

vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/assetDiscovery", () => ({
  discoverOwnedNftTokens: discover,
}));
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "test-seed",
}));

const OWNER = `Q${"a".repeat(128)}`;
const RECIPIENT = `Q${"b".repeat(128)}`;
const CONTRACT = `Q${"c".repeat(128)}`;
const signed = { transactionHash: "0xhash", rawTransaction: "0xraw" };

const originalTx: TransactionHistoryEntry = {
  id: "original",
  from: OWNER,
  to: RECIPIENT,
  amount: "1",
  tokenSymbol: "Quanta",
  tokenName: "Quanta",
  isZrc20Token: false,
  tokenContractAddress: "",
  tokenDecimals: 18,
  transactionHash: "0xoriginal",
  blockNumber: "",
  gasUsed: "",
  effectiveGasPrice: "",
  status: false,
  timestamp: 1,
  chainId: DEFAULT_BLOCKCHAIN.chainId,
  nonce: 7,
};

const createStore = () => {
  const store = new QrlStore();
  store.qrlInstance = new Web3().qrl;
  store.activeAccount = { accountAddress: OWNER };
  return store;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue();
  responses.clear();
  for (const [name, value] of Object.entries({
    name: "Collection",
    symbol: "COL",
    decimals: 2n,
    totalSupply: 10000n,
    balanceOf: 250n,
    supportsInterface: true,
    tokenOfOwnerByIndex: 9n,
    ownerOf: OWNER,
    tokenURI: "ipfs://collection/9.json",
    uri: "ipfs://collection/{id}.json",
    transfer: true,
  })) {
    responses.set(name, value);
  }
  call.mockImplementation((name) => Promise.resolve(responses.get(name)));
  estimateGas.mockResolvedValue(75000n);
  encodeABI.mockReturnValue("0xencoded");
  rpc.getBlock.mockResolvedValue({ baseFeePerGas: 100n });
  rpc.getBalance.mockResolvedValue(5n * 10n ** 18n);
  rpc.getTransactionCount.mockResolvedValue(7n);
  rpc.requestManager.send.mockResolvedValue("0x2");
  rpc.net.isListening.mockResolvedValue(true);
  rpc.accounts.signTransaction.mockResolvedValue(signed);
  discover.mockResolvedValue([{ tokenId: "9", standard: "ZRC721" }]);
  vi.spyOn(StorageUtil, "getAllAccounts").mockResolvedValue([OWNER]);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("contract response boundaries", () => {
  it("keeps token values and read ordering for valid responses", async () => {
    const store = createStore();
    expect(await store.getZrc20TokenDetails(CONTRACT)).toEqual({
      error: "",
      token: {
        name: "Collection",
        symbol: "COL",
        decimals: 2n,
        totalSupply: 100,
        balance: 2.5,
        balanceBaseUnits: "250",
        image: "",
      },
    });
    expect(call.mock.calls).toEqual([
      ["name", []],
      ["symbol", []],
      ["decimals", []],
      ["totalSupply", []],
      ["balanceOf", [OWNER]],
    ]);
  });

  it.each([
    ["name", {}],
    ["symbol", null],
    ["decimals", "2"],
    ["totalSupply", -1n],
    ["balanceOf", false],
  ])(
    "rejects a malformed token %s through the existing error result",
    async (name, value) => {
      responses.set(name, value);
      expect(await createStore().getZrc20TokenDetails(CONTRACT)).toEqual({
        token: undefined,
        error: "Could not retreive the token with the entered contract address",
      });
    },
  );

  it("retains valid collection details for both NFT standards", async () => {
    const store = createStore();
    expect(await store.getNftCollectionDetails(CONTRACT)).toEqual({
      error: "",
      collection: {
        name: "Collection",
        symbol: "COL",
        balance: 250,
        standard: "ZRC721",
      },
    });
    call.mockImplementation((name, args) =>
      Promise.resolve(
        name === "supportsInterface"
          ? args[0] !== ERC_721_INTERFACE_ID
          : responses.get(name),
      ),
    );
    expect(await store.getNftCollectionDetails(CONTRACT)).toEqual({
      error: "",
      collection: { name: "Collection", symbol: "COL", standard: "ZRC1155" },
    });
  });

  it.each(["false", 1, {}, null])(
    "rejects non-boolean NFT interface responses: %j",
    async (value) => {
      responses.set("supportsInterface", value);
      expect(await createStore().getNftCollectionDetails(CONTRACT)).toEqual({
        error:
          "Could not retrieve the NFT collection with the entered contract address",
      });
    },
  );

  it("uses empty optional 1155 metadata when its response is malformed", async () => {
    call.mockImplementation((name, args) =>
      Promise.resolve(
        name === "supportsInterface"
          ? args[0] !== ERC_721_INTERFACE_ID
          : { malformed: true },
      ),
    );
    expect(await createStore().getNftCollectionDetails(CONTRACT)).toEqual({
      error: "",
      collection: { name: "", symbol: "", standard: "ZRC1155" },
    });
  });

  it("keeps enumerable token order and rejects malformed IDs", async () => {
    responses.set("balanceOf", 2n);
    let nextId: unknown = 3n;
    call.mockImplementation((name, args) =>
      Promise.resolve(
        name === "tokenOfOwnerByIndex"
          ? args[1] === 0
            ? 9n
            : nextId
          : responses.get(name),
      ),
    );
    const store = createStore();
    expect(await store.getOwnedNftTokens(CONTRACT)).toEqual({
      tokens: [{ tokenId: "9" }, { tokenId: "3" }],
      failed: false,
    });
    nextId = { toString: () => "3" };
    expect(await store.getOwnedNftTokens(CONTRACT)).toEqual({
      tokens: [],
      failed: true,
    });
  });

  it("checks explorer candidates when the enumerable response is malformed", async () => {
    responses.set("supportsInterface", "true");
    const store = createStore();
    expect(await store.getOwnedNftTokens(CONTRACT)).toEqual({
      tokens: [{ tokenId: "9" }],
      failed: false,
    });
    expect(discover).toHaveBeenCalledWith(
      OWNER,
      DEFAULT_BLOCKCHAIN.chainId,
      CONTRACT,
    );
    responses.set("ownerOf", { toLowerCase: () => OWNER.toLowerCase() });
    expect(await store.getOwnedNftTokens(CONTRACT)).toEqual({
      tokens: [],
      failed: false,
    });
  });

  it("preserves exact 1155 balances and skips malformed discovered balances", async () => {
    const store = createStore();
    responses.set("balanceOf", 9007199254740993n);
    expect(await store.getErc1155TokenBalance(CONTRACT, "9")).toBe(
      "9007199254740993",
    );
    expect(await store.getOwnedNftTokens(CONTRACT, "ZRC1155")).toEqual({
      tokens: [{ tokenId: "9", balance: "9007199254740993" }],
      failed: false,
    });
    responses.set("balanceOf", "4");
    expect(await store.getErc1155TokenBalance(CONTRACT, "9")).toBeUndefined();
    expect(await store.getOwnedNftTokens(CONTRACT, "ZRC1155")).toEqual({
      tokens: [],
      failed: false,
    });
    expect(await store.getOwnedNftTokens(CONTRACT, "ZRC721")).toEqual({
      tokens: [],
      failed: true,
    });
  });

  it("preserves URI substitution and returns an empty URI for malformed data", async () => {
    const store = createStore();
    expect(await store.getNftTokenUri(CONTRACT, "9")).toBe(
      "ipfs://collection/9.json",
    );
    expect(await store.getNftTokenUri(CONTRACT, "9", "ZRC1155")).toBe(
      `ipfs://collection/${"9".padStart(64, "0")}.json`,
    );
    responses.set("tokenURI", { url: "ipfs://collection/9.json" });
    responses.set("uri", null);
    expect(await store.getNftTokenUri(CONTRACT, "9")).toBe("");
    expect(await store.getNftTokenUri(CONTRACT, "9", "ZRC1155")).toBe("");
  });
});

describe("RPC response boundaries", () => {
  it.each(["0x2", "2", 2, 2n])(
    "keeps valid priority-fee quantity %s",
    async (tip) => {
      rpc.requestManager.send.mockResolvedValue(tip);
      expect(await createStore().getGasFeeData()).toEqual({
        baseFeePerGas: 100n,
        maxPriorityFeePerGas: 3n,
        maxFeePerGas: 103n,
      });
      expect(rpc.requestManager.send).toHaveBeenCalledWith({
        method: "qrl_maxPriorityFeePerGas",
        params: [],
      });
    },
  );

  it.each([
    true,
    { valueOf: () => 9n },
    [],
    undefined,
    "garbage",
    1.5,
    -1n,
    "0x0",
  ])(
    "uses the existing default tip for malformed or zero quantities: %s",
    async (tip) => {
      rpc.requestManager.send.mockResolvedValue(tip);
      expect(await createStore().getGasFeeData({ tier: "low" })).toEqual({
        baseFeePerGas: 100n,
        maxPriorityFeePerGas: 2000000000n,
        maxFeePerGas: 2000000100n,
      });
    },
  );

  it.each([
    undefined,
    null,
    {},
    { baseFeePerGas: undefined },
    { baseFeePerGas: null },
    { baseFeePerGas: 0n },
  ])("preserves nullish and zero block fees: %s", async (block) => {
    const store = createStore();
    rpc.getBlock.mockResolvedValue(block);
    expect(await store.getGasFeeData({ tier: "advanced" })).toEqual({
      baseFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 0n,
    });
  });

  it("rejects malformed supplied block fees", async () => {
    const store = createStore();
    rpc.getBlock.mockResolvedValue({ baseFeePerGas: "100" });
    await expect(store.getGasFeeData()).rejects.toThrow(
      "Invalid provider response",
    );
    rpc.getBlock.mockResolvedValue([]);
    await expect(store.getGasFeeData()).rejects.toThrow(
      "Invalid block response",
    );
  });

  it("retains balances on malformed background reads and preserves nullish zero fallback", async () => {
    const store = createStore();
    await store.fetchAccounts();
    const previous = store.qrlAccounts.accounts;
    rpc.getBalance.mockResolvedValue("5000000000000000000");
    expect(await store.refreshBalancesQuietly()).toBe(false);
    expect(store.qrlAccounts.accounts).toEqual(previous);
    expect(store.qrlConnection.areBalancesStale).toBe(true);
    await store.fetchAccounts();
    expect(store.qrlAccounts.accounts).toEqual([
      { accountAddress: OWNER, accountBalance: "0.0 Quanta" },
    ]);
    rpc.getBalance.mockResolvedValue(null);
    expect(await store.refreshBalancesQuietly()).toBe(true);
    expect(store.qrlAccounts.accounts).toEqual([
      { accountAddress: OWNER, accountBalance: "0.0 Quanta" },
    ]);
  });

  it("accepts boolean listening results and rejects truthy malformed results", async () => {
    const store = createStore();
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(true);
    rpc.net.isListening.mockResolvedValue("false");
    await store.fetchQrlConnection();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlConnection.isLoading).toBe(false);
  });
});

const signingPaths = [
  {
    name: "native",
    sign: (store: QrlStore) =>
      store.signNativeToken(OWNER, RECIPIENT, "1", "mnemonic"),
  },
  {
    name: "token",
    sign: (store: QrlStore) =>
      store.signZrc20Token(OWNER, RECIPIENT, "1", "mnemonic", CONTRACT, 2),
  },
  {
    name: "NFT",
    sign: (store: QrlStore) =>
      store.signNftTransfer(OWNER, RECIPIENT, "9", "mnemonic", CONTRACT),
  },
  {
    name: "replacement",
    sign: (store: QrlStore) =>
      store.signAndSendReplacementTransaction(originalTx, "cancel", "mnemonic"),
  },
];

describe("signing and gas boundaries", () => {
  it.each(signingPaths)(
    "preserves signed strings and rejects incomplete $name results",
    async ({ sign }) => {
      const store = createStore();
      expect(await sign(store)).toMatchObject({ ...signed, error: "" });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const response of [null, {}, { ...signed, rawTransaction: 12 }]) {
        rpc.accounts.signTransaction.mockResolvedValue(response);
        const result = await sign(store);
        expect(result.error).toContain("could not be signed");
        expect(result.rawTransaction).toBeUndefined();
        expect(result.transactionHash).toBeUndefined();
      }
    },
  );

  it.each(signingPaths)(
    "preserves $name error text",
    async ({ name, sign }) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      rpc.accounts.signTransaction.mockRejectedValue(
        new Error("signing failed"),
      );
      const prefix =
        name === "replacement"
          ? "Replacement transaction failed."
          : "Transaction could not be signed.";
      expect((await sign(createStore())).error).toBe(
        `${prefix} Error: signing failed`,
      );
      rpc.accounts.signTransaction.mockRejectedValue("signing failed");
      expect((await sign(createStore())).error).toBe(
        `${prefix} signing failed`,
      );
    },
  );

  it("preserves NFT estimation, fallback and advanced limits", async () => {
    const store = createStore();
    const sign = () =>
      store.signNftTransfer(OWNER, RECIPIENT, "9", "mnemonic", CONTRACT);
    expect((await sign()).gasLimit).toBe(90000);
    estimateGas.mockRejectedValue(new Error("estimate unavailable"));
    expect((await sign()).gasLimit).toBe(NFT_UNITS_OF_GAS);
    estimateGas.mockClear();
    const advanced = await store.signNftTransfer(
      OWNER,
      RECIPIENT,
      "9",
      "mnemonic",
      CONTRACT,
      "ZRC1155",
      "2",
      {
        tier: "advanced",
        gasLimit: 99000,
      },
    );
    expect(advanced.gasLimit).toBe(99000);
    expect(advanced.error).toBe("");
    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("blocks malformed gas estimates before signing", async () => {
    const store = createStore();
    estimateGas.mockResolvedValue("75000");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      (await store.signNftTransfer(OWNER, RECIPIENT, "9", "mnemonic", CONTRACT))
        .error,
    ).toContain("Invalid provider response");
    await expect(
      store.getZrc20TokenGas(OWNER, RECIPIENT, "1", CONTRACT, 2),
    ).rejects.toThrow("Invalid provider response");
    expect(rpc.accounts.signTransaction).not.toHaveBeenCalled();
  });

  it("delivers valid broadcast hashes before the receipt and reports malformed hashes", async () => {
    const store = createStore();
    const receipt = { transactionHash: "0xhash" };
    const events: string[] = [];
    let hash: unknown = "0xhash";
    const on = vi.fn((_event: string, listener: (value: unknown) => void) => {
      listener(hash);
    });
    rpc.sendSignedTransaction.mockImplementation(() =>
      Object.assign(Promise.resolve(receipt), { on }),
    );
    const onBroadcast = vi.fn((value: string) => {
      events.push(value);
    });
    expect(await store.sendRawTransaction("0xraw", onBroadcast)).toBe(receipt);
    events.push("receipt");
    expect(events).toEqual(["0xhash", "receipt"]);
    const report = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    hash = {};
    expect(await store.sendRawTransaction("0xraw", onBroadcast)).toBe(receipt);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      "[sendRawTransaction] Invalid transaction hash",
    );
  });
});

describe("background failures and chain edits", () => {
  it("reports constructor initialization rejections", async () => {
    const error = new Error("storage unavailable");
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockRejectedValue(
      error,
    );
    const report = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    new QrlStore();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith("[initializeBlockchain] Error:", error);
  });

  it("reports poll storage failures and allows the next tick to retry", async () => {
    vi.useFakeTimers();
    const error = new Error("storage unavailable");
    vi.spyOn(StorageUtil, "getAllAccounts").mockRejectedValueOnce(error);
    const report = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const store = createStore();
    store.startBalancePolling();
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    expect(report).toHaveBeenCalledWith(
      "[pollBalancesAndConnection] Error:",
      error,
    );
    await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS);
    expect(store.qrlAccounts.accounts).toEqual([
      { accountAddress: OWNER, accountBalance: "5.0 Quanta" },
    ]);
    store.stopBalancePolling();
  });

  it("preserves unrelated chain records, extra fields and ordering", async () => {
    const first = {
      ...DEFAULT_BLOCKCHAIN,
      chainId: "0xA",
      customField: { retained: true },
    };
    const second = {
      ...DEFAULT_BLOCKCHAIN,
      chainId: "0xB",
      customField: ["retained"],
    };
    vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue([
      first,
      second,
    ]);
    const persist = vi
      .spyOn(StorageUtil, "setAllBlockChains")
      .mockResolvedValue();
    const store = createStore();
    const chainData = {
      ...DEFAULT_BLOCKCHAIN,
      chainId: " 0xa ",
      chainName: ` ${"n".repeat(110)} `,
    };
    const added = await store.addChain(chainData);
    expect(added.chainFound).toBe(true);
    expect(added.updatedChainList).toEqual([
      first,
      second,
      { ...chainData, chainId: "0xa", chainName: "n".repeat(100) },
    ]);
    expect((await store.editChain(chainData)).updatedChainList).toEqual([
      { ...first, ...chainData, chainId: "0xa", chainName: "n".repeat(100) },
      second,
    ]);
    expect(first.customField).toEqual({ retained: true });
    expect(persist).not.toHaveBeenCalled();
  });

  it("accepts dApp chains with omitted metadata lists and a null currency", async () => {
    const chainData = {
      chainId: " 0x2 ",
      chainName: " Optional metadata ",
      rpcUrls: ["https://rpc.example.test"],
      nativeCurrency: null,
      defaultRpcUrl: "https://rpc.example.test",
      defaultBlockExplorerUrl: "",
      defaultIconUrl: "",
      isTestnet: true,
      defaultWsRpcUrl: "",
      isCustomChain: true,
      customField: { retained: true },
    };
    vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue([
      DEFAULT_BLOCKCHAIN,
    ]);
    const persist = vi
      .spyOn(StorageUtil, "setAllBlockChains")
      .mockResolvedValue();

    expect(await createStore().addChain(chainData)).toEqual({
      chainFound: false,
      updatedChainList: [
        DEFAULT_BLOCKCHAIN,
        { ...chainData, chainId: "0x2", chainName: "Optional metadata" },
      ],
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("propagates chain read failures without replacing stored records", async () => {
    const error = new Error("unreadable chains");
    vi.spyOn(StorageUtil, "getAllBlockChains").mockRejectedValue(error);
    const persist = vi
      .spyOn(StorageUtil, "setAllBlockChains")
      .mockResolvedValue();
    const store = createStore();
    await expect(store.addChain(DEFAULT_BLOCKCHAIN)).rejects.toBe(error);
    await expect(store.editChain(DEFAULT_BLOCKCHAIN)).rejects.toBe(error);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects malformed chain parameters before reading or writing records", async () => {
    const read = vi
      .spyOn(StorageUtil, "getAllBlockChains")
      .mockResolvedValue([]);
    const persist = vi
      .spyOn(StorageUtil, "setAllBlockChains")
      .mockResolvedValue();
    const store = createStore();
    await expect(
      store.addChain(malformed<AddedBlockchainData>({ chainId: "0x1" })),
    ).rejects.toThrow("Invalid blockchain data");
    await expect(
      store.editChain(malformed<BlockchainDataType>({ chainId: "0x1" })),
    ).rejects.toThrow("Invalid blockchain data");
    expect(read).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
