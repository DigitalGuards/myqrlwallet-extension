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
});
