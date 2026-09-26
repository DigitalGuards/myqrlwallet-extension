import { afterEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";
import {
  discoverNftCollections,
  discoverOwnedNftTokens,
  discoverTokens,
} from "./assetDiscovery";

const TESTNET_CHAIN_ID = "0x301825";
const HOLDER = toChecksumAddress(`Q${"1".repeat(128)}`);

const mockFetchJson = (body: unknown, ok = true, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverTokens", () => {
  it("maps explorer rows and normalises addresses to the Q prefix", async () => {
    const fetchMock = mockFetchJson({
      address: HOLDER,
      count: 3,
      tokens: [
        {
          contractAddress: `0x${"a".repeat(128)}`,
          name: "Alpha",
          symbol: "ALP",
          decimals: 12,
        },
        {
          contractAddress: `q${"b".repeat(128)}`,
          name: "",
          symbol: "",
          decimals: 0,
        },
        {
          contractAddress: toChecksumAddress(`Q${"c".repeat(128)}`),
          name: "Gamma",
          symbol: "GAM",
          decimals: null,
        },
      ],
    });

    const tokens = await discoverTokens(HOLDER, TESTNET_CHAIN_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://zondscan.com/api/address/${HOLDER}/tokens?standard=ERC-20`,
    );
    expect(tokens).toEqual([
      {
        address: toChecksumAddress(`Q${"a".repeat(128)}`),
        name: "Alpha",
        symbol: "ALP",
        decimals: 12,
      },
      {
        address: toChecksumAddress(`Q${"b".repeat(128)}`),
        name: "Unknown Token",
        symbol: "UNK",
        // 0 is a valid decimals value and must not fall through to 18
        decimals: 0,
      },
      {
        address: toChecksumAddress(`Q${"c".repeat(128)}`),
        name: "Gamma",
        symbol: "GAM",
        decimals: 18,
      },
    ]);
  });

  it("returns an empty list on a non-2xx response", async () => {
    mockFetchJson({}, false, 404);
    expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
  });

  it("returns an empty list when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
  });

  it("skips the network entirely on chains without an explorer", async () => {
    const fetchMock = mockFetchJson({});
    expect(await discoverTokens(HOLDER, "0x1")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("discoverNftCollections", () => {
  it("groups per-token rows into collections for both standards", async () => {
    const fetchMock = mockFetchJson({
      address: HOLDER,
      count: 4,
      nfts: [
        {
          contractAddress: `0x${"d".repeat(128)}`,
          tokenID: "1",
          tokenStandard: "ERC-721",
          collectionName: "Doodles",
          collectionSymbol: "DOO",
        },
        {
          contractAddress: toChecksumAddress(`Q${"d".repeat(128)}`),
          tokenID: "2",
          tokenStandard: "ERC-721",
          collectionName: "Doodles",
          collectionSymbol: "DOO",
        },
        {
          // duplicate (contract, tokenID) row must not inflate tokenCount
          contractAddress: toChecksumAddress(`Q${"d".repeat(128)}`),
          tokenID: "2",
          tokenStandard: "ERC-721",
          collectionName: "Doodles",
          collectionSymbol: "DOO",
        },
        {
          contractAddress: toChecksumAddress(`Q${"e".repeat(128)}`),
          tokenID: "7",
          tokenStandard: "ERC-1155",
          collectionName: "Multi",
          collectionSymbol: "MUL",
        },
        {
          contractAddress: toChecksumAddress(`Q${"f".repeat(128)}`),
          tokenID: "9",
          tokenStandard: "ERC-721",
        },
      ],
    });

    const collections = await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://zondscan.com/api/address/${HOLDER}/nfts`,
    );
    expect(collections).toEqual([
      {
        address: toChecksumAddress(`Q${"d".repeat(128)}`),
        name: "Doodles",
        symbol: "DOO",
        standard: "ZRC721",
        tokenCount: 2,
      },
      {
        address: toChecksumAddress(`Q${"e".repeat(128)}`),
        name: "Multi",
        symbol: "MUL",
        standard: "ZRC1155",
        tokenCount: 1,
      },
      {
        address: toChecksumAddress(`Q${"f".repeat(128)}`),
        name: "",
        symbol: "",
        standard: "ZRC721",
        tokenCount: 1,
      },
    ]);
  });

  it("returns an empty list on malformed responses", async () => {
    mockFetchJson({ unexpected: true });
    expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
  });
});

describe("discoverOwnedNftTokens", () => {
  const NFTS = {
    address: HOLDER,
    count: 4,
    nfts: [
      {
        contractAddress: `0x${"d".repeat(128)}`,
        tokenID: "1",
        tokenStandard: "ERC-721",
      },
      {
        contractAddress: toChecksumAddress(`Q${"d".repeat(128)}`),
        tokenID: "2",
        tokenStandard: "ERC-721",
      },
      {
        // duplicate row for the same id must be deduped
        contractAddress: toChecksumAddress(`Q${"d".repeat(128)}`),
        tokenID: "2",
        tokenStandard: "ERC-721",
      },
      {
        contractAddress: toChecksumAddress(`Q${"e".repeat(128)}`),
        tokenID: "42",
        tokenStandard: "ERC-1155",
        balance: "3",
      },
    ],
  };

  it("filters rows to the requested contract across address encodings", async () => {
    mockFetchJson(NFTS);
    const tokens = await discoverOwnedNftTokens(
      HOLDER,
      TESTNET_CHAIN_ID,
      `0x${"D".repeat(128)}`,
    );
    expect(tokens).toEqual([
      { tokenId: "1", standard: "ZRC721", balance: undefined },
      { tokenId: "2", standard: "ZRC721", balance: undefined },
    ]);
  });

  it("carries the explorer balance for 1155 rows", async () => {
    mockFetchJson(NFTS);
    const tokens = await discoverOwnedNftTokens(
      HOLDER,
      TESTNET_CHAIN_ID,
      toChecksumAddress(`Q${"e".repeat(128)}`),
    );
    expect(tokens).toEqual([
      { tokenId: "42", standard: "ZRC1155", balance: "3" },
    ]);
  });

  it("returns an empty list on chains without an explorer", async () => {
    const fetchMock = mockFetchJson(NFTS);
    expect(
      await discoverOwnedNftTokens(
        HOLDER,
        "0x1",
        toChecksumAddress(`Q${"d".repeat(128)}`),
      ),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the candidate list so a hostile response cannot drive an unbounded RPC loop", async () => {
    mockFetchJson({
      address: HOLDER,
      count: 80,
      nfts: Array.from({ length: 80 }, (_, i) => ({
        contractAddress: toChecksumAddress(`Q${"d".repeat(128)}`),
        tokenID: String(i + 1),
        tokenStandard: "ERC-721",
      })),
    });
    const tokens = await discoverOwnedNftTokens(
      HOLDER,
      TESTNET_CHAIN_ID,
      toChecksumAddress(`Q${"d".repeat(128)}`),
    );
    expect(tokens).toHaveLength(50);
  });
});
