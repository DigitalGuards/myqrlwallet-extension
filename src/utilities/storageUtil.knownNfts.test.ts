import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageUtil from "./storageUtil";
import { ACCOUNT, CHAIN, NFT } from "./__mocks__/storageFixtures";

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

const OTHER_NFT = { ...NFT, address: "nft-b" };
const at = (value: unknown, key: string): unknown =>
  Reflect.get(Object(value), key);
const storedCollections = (): unknown[] => {
  const list = at(
    at(at(at(h.store, "NFT_COLLECTIONS"), "ALL_NFT_COLLECTIONS"), ACCOUNT),
    CHAIN.chainId,
  );
  const records = at(list, "collections");
  if (!Array.isArray(records)) throw new Error("No stored collections");
  return records;
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.store)) Reflect.deleteProperty(h.store, key);
  h.store.BLOCKCHAINS = {
    ALL_BLOCKCHAINS: [CHAIN],
    ACTIVE_BLOCKCHAIN: CHAIN.chainId,
  };
});

describe("remembered NFT token ids", () => {
  it("round-trips ids and balances inside the collection's own record", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
      { tokenId: "3", balance: "5" },
    ]);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "7" },
      { tokenId: "3", balance: "5" },
    ]);
    expect(storedCollections()).toHaveLength(1);
    expect(await StorageUtil.getNFTCollectionsList(ACCOUNT)).toHaveLength(1);
  });

  it("does nothing for a collection that is not stored", async () => {
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
    ]);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual(
      [],
    );
  });

  it("keeps ids of one collection apart from another", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTCollectionsList(ACCOUNT, OTHER_NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "1" },
    ]);
    expect(
      await StorageUtil.getNFTKnownTokens(ACCOUNT, OTHER_NFT.address),
    ).toEqual([]);
  });

  it("forgets the ids with an empty list, with the collection and with the account", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "1" },
    ]);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, []);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual(
      [],
    );

    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "1" },
    ]);
    await StorageUtil.clearFromNFTCollectionsList(ACCOUNT, NFT.address);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual(
      [],
    );
    expect(JSON.stringify(h.store)).not.toContain("knownTokens");

    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "1" },
    ]);
    await StorageUtil.clearAllAccountData(ACCOUNT);
    expect(JSON.stringify(h.store)).not.toContain("knownTokens");
  });

  it("survives adding the same collection again", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "1" },
    ]);
    await StorageUtil.setNFTCollectionsList(ACCOUNT, { ...NFT, name: "New" });
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "1" },
    ]);
  });

  it("stores at most 50 ids and reads only well-formed ones", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(
      ACCOUNT,
      NFT.address,
      Array.from({ length: 80 }, (_unused, i) => ({ tokenId: String(i) })),
    );
    expect(
      await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address),
    ).toHaveLength(50);

    const [record] = storedCollections();
    Reflect.set(Object(record), "knownTokens", [
      { tokenId: "9" },
      { tokenId: "0x9" },
      { tokenId: "-1" },
      { tokenId: 4 },
      { tokenId: "5", balance: "x" },
      "junk",
      { tokenId: "6", balance: "2" },
    ]);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "9" },
      { tokenId: "6", balance: "2" },
    ]);
    Reflect.set(Object(record), "knownTokens", "not a list");
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual(
      [],
    );
  });

  it("reads ids through one canonical spelling and drops repeats", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
    ]);
    const [record] = storedCollections();
    Reflect.set(Object(record), "knownTokens", [
      { tokenId: "07" },
      { tokenId: "0x7" },
      { tokenId: "7" },
      { tokenId: " 7" },
      { tokenId: "0b111" },
      { tokenId: "9".repeat(79) },
      { tokenId: "8" },
    ]);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "7" },
      { tokenId: "8" },
    ]);
  });

  it("writes nothing when the remembered list is already the same", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
    ]);
    h.local.set.mockClear();
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
    ]);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, OTHER_NFT.address, []);
    expect(h.local.set).not.toHaveBeenCalled();
  });
});

describe("the collection's standard", () => {
  it("changes only the standard field, in place", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, {
      ...NFT,
      name: "",
      standard: "QRC1155",
    });
    await StorageUtil.setNFTCollectionsList(ACCOUNT, OTHER_NFT);
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "7" },
    ]);
    await StorageUtil.setNFTCollectionStandard(ACCOUNT, NFT.address, "QRC721");
    const [first, second] = storedCollections();
    expect(first).toEqual({
      address: NFT.address,
      name: "",
      symbol: NFT.symbol,
      image: "",
      standard: "ZRC721",
      knownTokens: [{ tokenId: "7" }],
    });
    expect(at(second, "address")).toBe(OTHER_NFT.address);
  });

  it("writes nothing for a matching standard or a collection that is not stored", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    h.local.set.mockClear();
    await StorageUtil.setNFTCollectionStandard(ACCOUNT, NFT.address, "QRC721");
    await StorageUtil.setNFTCollectionStandard(ACCOUNT, "missing", "QRC1155");
    expect(h.local.set).not.toHaveBeenCalled();
  });
});

describe("serialised writes to the NFT collections store", () => {
  const slowReads = () => {
    const original = h.local.get.getMockImplementation();
    h.local.get.mockImplementation(async (key: string) => {
      const value = (await original?.(key)) ?? {};
      await new Promise((resolve) => setTimeout(resolve, 15));
      return value;
    });
    return () => {
      if (original) h.local.get.mockImplementation(original);
    };
  };

  it("keeps both writes when two collections change at once", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTCollectionsList(ACCOUNT, OTHER_NFT);
    const restore = slowReads();
    try {
      await Promise.all([
        StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [{ tokenId: "1" }]),
        StorageUtil.setNFTKnownTokens(ACCOUNT, OTHER_NFT.address, [
          { tokenId: "2" },
        ]),
        StorageUtil.setNFTCollectionStandard(
          ACCOUNT,
          OTHER_NFT.address,
          "QRC1155",
        ),
      ]);
    } finally {
      restore();
    }
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "1" },
    ]);
    expect(
      await StorageUtil.getNFTKnownTokens(ACCOUNT, OTHER_NFT.address),
    ).toEqual([{ tokenId: "2" }]);
    expect(JSON.stringify(storedCollections())).toContain("ZRC1155");
  });

  it("does not bring a removed collection back", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    await StorageUtil.setNFTCollectionsList(ACCOUNT, OTHER_NFT);
    const restore = slowReads();
    try {
      await Promise.all([
        StorageUtil.clearFromNFTCollectionsList(ACCOUNT, NFT.address),
        StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [{ tokenId: "1" }]),
        StorageUtil.setNFTCollectionStandard(ACCOUNT, NFT.address, "QRC1155"),
        StorageUtil.setNFTKnownTokens(ACCOUNT, OTHER_NFT.address, [
          { tokenId: "2" },
        ]),
      ]);
    } finally {
      restore();
    }
    const collections = await StorageUtil.getNFTCollectionsList(ACCOUNT);
    expect(collections.map((c) => c.address)).toEqual([OTHER_NFT.address]);
    expect(
      await StorageUtil.getNFTKnownTokens(ACCOUNT, OTHER_NFT.address),
    ).toEqual([{ tokenId: "2" }]);
  });

  it("keeps the chain going after a failed write", async () => {
    await StorageUtil.setNFTCollectionsList(ACCOUNT, NFT);
    h.local.set.mockRejectedValueOnce(new Error("quota"));
    await expect(
      StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [{ tokenId: "1" }]),
    ).rejects.toThrow("quota");
    await StorageUtil.setNFTKnownTokens(ACCOUNT, NFT.address, [
      { tokenId: "2" },
    ]);
    expect(await StorageUtil.getNFTKnownTokens(ACCOUNT, NFT.address)).toEqual([
      { tokenId: "2" },
    ]);
  });
});
