import { afterEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";
import {
  discoverNftCollections,
  discoverOwnedNftTokens,
  discoverTokens,
  MAX_DISCOVERED_COLLECTIONS,
  MAX_DISCOVERED_TOKENS,
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

  it.each([undefined, null])(
    "keeps metadata defaults for nullish values: %s",
    async (missing) => {
      mockFetchJson({
        tokens: [
          {
            contractAddress: `Q${"a".repeat(128)}`,
            name: missing,
            symbol: missing,
            decimals: missing,
          },
        ],
      });

      expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([
        {
          address: toChecksumAddress(`Q${"a".repeat(128)}`),
          name: "Unknown Token",
          symbol: "UNK",
          decimals: 18,
        },
      ]);
    },
  );

  it.each([
    null,
    42,
    "invalid",
    [],
    {},
    { tokens: null },
    { tokens: {} },
    { tokens: "invalid" },
  ])(
    "returns an empty list for malformed token responses: %j",
    async (body) => {
      mockFetchJson(body);
      expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
    },
  );

  const tokenRow = {
    contractAddress: `Q${"a".repeat(128)}`,
    name: "Alpha",
    symbol: "ALP",
    decimals: 18,
  };

  it.each([
    null,
    42,
    "invalid",
    [],
    {},
    { ...tokenRow, contractAddress: 42 },
    { ...tokenRow, contractAddress: "invalid" },
    { ...tokenRow, name: {} },
    { ...tokenRow, symbol: false },
    { ...tokenRow, decimals: "18" },
    { ...tokenRow, decimals: -1 },
    { ...tokenRow, decimals: 1.5 },
    { ...tokenRow, decimals: 256 },
    { ...tokenRow, decimals: Number.NaN },
    { ...tokenRow, decimals: Number.POSITIVE_INFINITY },
  ])(
    "skips malformed token rows and keeps valid row order: %j",
    async (row) => {
      mockFetchJson({
        tokens: [tokenRow, row, { ...tokenRow, decimals: 255 }],
      });

      expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([
        {
          address: toChecksumAddress(tokenRow.contractAddress),
          name: "Alpha",
          symbol: "ALP",
          decimals: 18,
        },
        {
          address: toChecksumAddress(tokenRow.contractAddress),
          name: "Alpha",
          symbol: "ALP",
          decimals: 255,
        },
      ]);
    },
  );

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

describe("NFT explorer validation", () => {
  const contractAddress = toChecksumAddress(`Q${"d".repeat(128)}`);
  const nftRow = {
    contractAddress,
    tokenID: "1",
    tokenStandard: "ERC-1155",
    collectionName: "Multi",
    collectionSymbol: "MUL",
    balance: "3",
  };
  const candidateRow = { ...nftRow, tokenID: "3" };

  it.each([
    null,
    42,
    "invalid",
    [],
    {},
    { ...candidateRow, contractAddress: 42 },
    { ...candidateRow, contractAddress: "invalid" },
    { ...candidateRow, tokenID: 1 },
    { ...candidateRow, tokenID: "" },
    { ...candidateRow, tokenStandard: {} },
    { ...candidateRow, tokenStandard: "ERC-20" },
    { ...candidateRow, collectionName: {} },
    { ...candidateRow, collectionSymbol: false },
    { ...candidateRow, balance: 3 },
    { ...candidateRow, balance: null },
  ])("skips malformed NFT rows in both discovery paths: %j", async (row) => {
    mockFetchJson({
      nfts: [nftRow, row, { ...nftRow, tokenID: "2" }],
    });

    expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual([
      {
        address: contractAddress,
        name: "Multi",
        symbol: "MUL",
        standard: "ZRC1155",
        tokenCount: 2,
      },
    ]);
    expect(
      await discoverOwnedNftTokens(HOLDER, TESTNET_CHAIN_ID, contractAddress),
    ).toEqual([
      { tokenId: "1", standard: "ZRC1155", balance: "3" },
      { tokenId: "2", standard: "ZRC1155", balance: "3" },
    ]);
  });

  it.each([undefined, null, ""])(
    "fills missing collection metadata from later rows: %s",
    async (missing) => {
      mockFetchJson({
        nfts: [
          { ...nftRow, collectionName: missing, collectionSymbol: missing },
          { ...nftRow, tokenID: "2" },
        ],
      });

      expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual([
        {
          address: contractAddress,
          name: "Multi",
          symbol: "MUL",
          standard: "ZRC1155",
          tokenCount: 2,
        },
      ]);
    },
  );

  it.each([null, 42, "invalid", [], {}, { nfts: null }, { nfts: {} }])(
    "returns empty lists for malformed NFT responses: %j",
    async (body) => {
      mockFetchJson(body);
      expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual(
        [],
      );
      expect(
        await discoverOwnedNftTokens(HOLDER, TESTNET_CHAIN_ID, contractAddress),
      ).toEqual([]);
    },
  );

  it("returns empty lists when parsing the explorer JSON rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Invalid JSON")),
      }),
    );

    expect(await discoverTokens(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
    expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual([]);
    expect(
      await discoverOwnedNftTokens(HOLDER, TESTNET_CHAIN_ID, contractAddress),
    ).toEqual([]);
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

describe("discovery caps", () => {
  // A hostile or spam-flooded index must not be able to grow either
  // picker without limit: the rows render in a 360px panel and each
  // collection costs further chain reads.
  const hexAddress = (index: number) =>
    `Q${index.toString(16).padStart(128, "0")}`;

  it("caps discovered tokens", async () => {
    mockFetchJson({
      address: HOLDER,
      count: MAX_DISCOVERED_TOKENS + 25,
      tokens: Array.from(
        { length: MAX_DISCOVERED_TOKENS + 25 },
        (_unused, index) => ({
          contractAddress: hexAddress(index + 1),
          name: `Spam ${index}`,
          symbol: "SPAM",
          decimals: 18,
        }),
      ),
    });

    const tokens = await discoverTokens(HOLDER, TESTNET_CHAIN_ID);

    expect(tokens).toHaveLength(MAX_DISCOVERED_TOKENS);
  });

  it("caps discovered NFT collections", async () => {
    mockFetchJson({
      address: HOLDER,
      count: MAX_DISCOVERED_COLLECTIONS + 25,
      nfts: Array.from(
        { length: MAX_DISCOVERED_COLLECTIONS + 25 },
        (_unused, index) => ({
          contractAddress: hexAddress(index + 1),
          tokenID: "1",
          tokenStandard: "ERC-721",
          collectionName: `Spam ${index}`,
          collectionSymbol: "SPAM",
        }),
      ),
    });

    const collections = await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID);

    expect(collections).toHaveLength(MAX_DISCOVERED_COLLECTIONS);
  });

  it("still counts further tokens of a collection already inside the cap", async () => {
    mockFetchJson({
      address: HOLDER,
      count: 3,
      nfts: [
        {
          contractAddress: hexAddress(1),
          tokenID: "1",
          tokenStandard: "ERC-721",
          collectionName: "Kept",
          collectionSymbol: "KEP",
        },
        {
          contractAddress: hexAddress(1),
          tokenID: "2",
          tokenStandard: "ERC-721",
          collectionName: "Kept",
          collectionSymbol: "KEP",
        },
      ],
    });

    const collections = await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID);

    expect(collections).toHaveLength(1);
    expect(collections[0].tokenCount).toBe(2);
  });
});
