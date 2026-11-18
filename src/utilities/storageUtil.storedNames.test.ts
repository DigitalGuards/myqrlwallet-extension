import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageUtil from "./storageUtil";
import {
  isStoredTransactionValues,
  isTransactionValues,
} from "./storageGuards";
import { historyEntryView, nftCollectionView } from "./storageViews";
import { isTransactionDetailEntry } from "./transactionHistoryGuards";
import {
  ACCOUNT,
  OTHER_ACCOUNT,
  CHAIN,
  TOKEN,
  NFT,
  STORED_NFT,
  HISTORY,
  STORED_HISTORY,
} from "./__mocks__/storageFixtures";

// Chrome storage serializes to JSON; the mock does the same round trip.
const h = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const roundTrip = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value));
  const local = {
    get: vi.fn((key: string) =>
      Promise.resolve(
        Object.prototype.hasOwnProperty.call(store, key)
          ? { [key]: roundTrip(store[key]) }
          : {},
      ),
    ),
    set: vi.fn((value: Record<string, unknown>) => {
      Object.assign(store, roundTrip(value));
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      Reflect.deleteProperty(store, key);
      return Promise.resolve();
    }),
    clear: vi.fn(),
  };
  return { store, local, roundTrip };
});
vi.mock("@/utilities/profileStorage", () => ({
  walletLocalStorage: h.local,
  walletSessionStorage: h.local,
}));

const seedList = (
  root: string,
  all: string,
  field: string,
  records: unknown[],
) => {
  h.store[root] = {
    [all]: {
      [ACCOUNT]: { [CHAIN.chainId]: { [field]: h.roundTrip(records) } },
    },
  };
};
const seedHistory = (records: unknown[]) => {
  seedList("TX_HISTORY", "ALL_TX_HISTORY", "transactions", records);
};
const seedNfts = (records: unknown[]) => {
  seedList("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections", records);
};
const at = (value: unknown, key: string): unknown =>
  Reflect.get(Object(value), key);
const storedList = (root: string, all: string, field: string): unknown[] => {
  const list = at(at(at(at(h.store, root), all), ACCOUNT), CHAIN.chainId);
  const records = at(list, field);
  if (!Array.isArray(records)) throw new Error(`No stored ${field}`);
  return records;
};
const storedHistory = () =>
  storedList("TX_HISTORY", "ALL_TX_HISTORY", "transactions");
const storedNfts = () =>
  storedList("NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS", "collections");
const draftKey = `${CHAIN.chainId}_TRANSACTION_VALUES`;
const bytes = (value: unknown) => JSON.stringify(value);

const tokenDetails = {
  tokenContractAddress: TOKEN.address,
  tokenDecimals: 18,
  tokenImage: false,
  tokenBalance: "10",
  tokenName: "Token",
  tokenSymbol: "TOK",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.store)) Reflect.deleteProperty(h.store, key);
  h.store.BLOCKCHAINS = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
});

describe("token flag in history entries", () => {
  it("reads an entry stored under the earlier name only as token and as native", async () => {
    seedHistory([
      STORED_HISTORY,
      {
        ...STORED_HISTORY,
        id: "native",
        transactionHash: "native",
        isZrc20Token: false,
      },
    ]);
    const views = (await StorageUtil.getTransactionHistory(ACCOUNT)).map(
      historyEntryView,
    );
    expect(views.map((view) => view.isQrc20Token)).toEqual([true, false]);
  });

  it("returns a pending token transfer stored under the earlier name as a token transfer for Speed Up and Cancel", async () => {
    seedHistory([STORED_HISTORY]);
    const [pending] = await StorageUtil.getPendingTransactions(ACCOUNT);
    expect(pending.pendingStatus).toBe("pending");
    const view = historyEntryView(pending);
    expect(view.isQrc20Token).toBe(true);
    // The detail screen accepts the view, so the replacement is built from it.
    expect(isTransactionDetailEntry(view)).toBe(true);
    expect(view.tokenContractAddress).toBe(TOKEN.address);
  });

  it("stores a new entry under both names with equal values", async () => {
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, {
      ...HISTORY,
      id: "native",
      transactionHash: "native",
      isQrc20Token: false,
    });
    const [native, token] = storedHistory();
    expect(native).toMatchObject({ isQrc20Token: false, isZrc20Token: false });
    expect(token).toMatchObject({ isQrc20Token: true, isZrc20Token: true });
  });

  it("keeps both names equal after an update", async () => {
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    await StorageUtil.updateTransactionHistoryEntry(
      ACCOUNT,
      HISTORY.transactionHash,
      { amount: "9" },
    );
    expect(storedHistory()[0]).toMatchObject({
      amount: "9",
      isQrc20Token: true,
      isZrc20Token: true,
    });
    await StorageUtil.updateTransactionHistoryEntry(
      ACCOUNT,
      HISTORY.transactionHash,
      { isQrc20Token: false },
    );
    expect(storedHistory()[0]).toMatchObject({
      isQrc20Token: false,
      isZrc20Token: false,
    });
  });

  it("adds the current name beside the earlier one when an old entry is replaced", async () => {
    seedHistory([STORED_HISTORY]);
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
    expect(storedHistory()).toEqual([
      { ...STORED_HISTORY, isQrc20Token: true },
    ]);
  });

  it("reads the earlier name when both names differ, as after a rewrite by a version from before the rename", async () => {
    seedHistory([
      { ...STORED_HISTORY, isQrc20Token: false, isZrc20Token: true },
      {
        ...STORED_HISTORY,
        id: "b",
        transactionHash: "b",
        isQrc20Token: true,
        isZrc20Token: false,
      },
    ]);
    const views = (await StorageUtil.getTransactionHistory(ACCOUNT)).map(
      historyEntryView,
    );
    expect(views.map((view) => view.isQrc20Token)).toEqual([true, false]);
  });

  it("reads the current name when the earlier one is not a boolean", async () => {
    seedHistory([{ ...STORED_HISTORY, isQrc20Token: true, isZrc20Token: 1 }]);
    const [view] = (await StorageUtil.getTransactionHistory(ACCOUNT)).map(
      historyEntryView,
    );
    expect(view.isQrc20Token).toBe(true);
  });

  it("falls back to the earlier name when the current one is not a boolean", async () => {
    seedHistory([{ ...STORED_HISTORY, isQrc20Token: "yes" }]);
    const [view] = (await StorageUtil.getTransactionHistory(ACCOUNT)).map(
      historyEntryView,
    );
    expect(view.isQrc20Token).toBe(true);
  });
});

describe("token flag in the transfer draft", () => {
  it("reads a draft stored under the earlier name only under the current one", async () => {
    h.store[draftKey] = {
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isZrc20Token: true },
    };
    // Readable as a stored draft; a draft this version works with carries
    // the flag under its current name.
    expect(isStoredTransactionValues(h.store[draftKey])).toBe(true);
    expect(isTransactionValues(h.store[draftKey])).toBe(false);
    const values = await StorageUtil.getTransactionValues();
    expect(values.tokenDetails).toEqual({
      ...tokenDetails,
      isQrc20Token: true,
    });
    expect(values.tokenDetails).not.toHaveProperty("isZrc20Token");
  });

  it("reads the earlier name of a draft that 1.4.4 rewrote after this version wrote it", async () => {
    // 1.4.4 updates the name it knows and carries the unfamiliar current
    // name along unchanged.
    h.store[draftKey] = {
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isQrc20Token: true, isZrc20Token: false },
    };
    const values = await StorageUtil.getTransactionValues();
    expect(values.tokenDetails?.isQrc20Token).toBe(false);
    expect(values.tokenDetails).not.toHaveProperty("isZrc20Token");
  });

  it("stores a draft written now under both names", async () => {
    await StorageUtil.setTransactionValues({
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isQrc20Token: true },
    });
    expect(h.store[draftKey]).toEqual({
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isQrc20Token: true, isZrc20Token: true },
    });
  });

  it("rejects a draft whose flag is under neither name", () => {
    expect(isStoredTransactionValues({ tokenDetails })).toBe(false);
    expect(
      isStoredTransactionValues({
        tokenDetails: { ...tokenDetails, isZrc20Token: "true" },
      }),
    ).toBe(false);
  });

  it("leaves a draft unread when one of the two names holds something else", async () => {
    const stored = {
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isQrc20Token: true, isZrc20Token: "yes" },
    };
    h.store[draftKey] = stored;
    expect(isStoredTransactionValues(stored)).toBe(false);
    const values = await StorageUtil.getTransactionValues();
    expect(values.tokenDetails).toBeUndefined();
    expect(h.store[draftKey]).toEqual(stored);
  });

  it("does not take a draft with the flag under the earlier name only for one to store", () => {
    const draft: unknown = {
      receiverAddress: OTHER_ACCOUNT,
      amount: "1",
      tokenDetails: { ...tokenDetails, isZrc20Token: true },
    };
    expect(isTransactionValues(draft)).toBe(false);
  });
});

describe("NFT standard", () => {
  it.each([
    ["ZRC721", "QRC721"],
    ["ZRC1155", "QRC1155"],
    ["QRC721", "QRC721"],
    ["QRC1155", "QRC1155"],
    ["future", undefined],
    [undefined, undefined],
    [721, undefined],
  ])("reads %s as %s", async (stored, typed) => {
    seedNfts([{ ...STORED_NFT, standard: stored }]);
    const [collection] = await StorageUtil.getNFTCollectionsList(ACCOUNT);
    expect(nftCollectionView(collection).standard).toBe(typed);
  });

  it.each([
    ["QRC721", "ZRC721"],
    ["QRC1155", "ZRC1155"],
  ] as const)("stores %s under its earlier value %s", async (typed, stored) => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, {
      ...NFT,
      standard: typed,
    });
    expect(storedNfts()).toEqual([{ ...STORED_NFT, standard: stored }]);
  });

  it("stores an unset standard as it is", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, {
      ...NFT,
      standard: undefined,
    });
    expect(storedNfts()).toEqual(
      [{ ...NFT, standard: undefined }].map(h.roundTrip),
    );
  });
});

describe("records the wallet cannot fully read stay as they are", () => {
  it("keeps history records with an unreadable flag byte for byte", async () => {
    const odd = {
      ...STORED_HISTORY,
      id: "odd",
      transactionHash: "odd",
      isZrc20Token: "yes",
      isQrc20Token: { future: true },
      extra: [1, 2],
    };
    const both = {
      ...STORED_HISTORY,
      id: "both",
      transactionHash: "both",
      isQrc20Token: false,
    };
    seedHistory([odd, both]);
    await StorageUtil.setTransactionHistoryEntry(ACCOUNT, {
      ...HISTORY,
      id: "new",
      transactionHash: "new",
    });
    await StorageUtil.updateTransactionHistoryEntry(ACCOUNT, "other", {
      isQrc20Token: true,
    });
    await StorageUtil.updateTransactionHistoryEntry(ACCOUNT, "both", {
      amount: "3",
    });
    expect(bytes(storedHistory().slice(1, 2))).toBe(bytes([odd]));
    expect(bytes(storedHistory().slice(2))).toBe(
      bytes([{ ...both, amount: "3" }]),
    );
    const [, oddRecord] = await StorageUtil.getTransactionHistory(ACCOUNT);
    expect(historyEntryView(oddRecord).isQrc20Token).toBe(false);
  });

  it("keeps collections with an unknown standard byte for byte", async () => {
    const odd = {
      ...STORED_NFT,
      address: "odd",
      standard: "future",
      extra: { keep: true },
    };
    seedNfts([STORED_NFT, odd]);
    await StorageUtil.setNFTCollectionsList(ACCOUNT, {
      ...NFT,
      name: "Edited",
    });
    expect(bytes(storedNfts())).toBe(
      bytes([odd, { ...STORED_NFT, name: "Edited" }]),
    );
  });

  it("keeps a draft with an unreadable flag and does not overwrite it with a read", async () => {
    const draft = {
      receiverAddress: OTHER_ACCOUNT,
      tokenDetails: { ...tokenDetails, isZrc20Token: "true" },
    };
    h.store[draftKey] = draft;
    expect(await StorageUtil.getTransactionValues()).toEqual({
      receiverAddress: "",
      amount: 0,
    });
    expect(bytes(h.store[draftKey])).toBe(bytes(draft));
  });
});
