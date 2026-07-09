import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverNftCollections,
  discoverTokens,
} from "./assetDiscovery";

const TESTNET_CHAIN_ID = "0x539";
const HOLDER = "Q1111111111111111111111111111111111111111";

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
          contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "Alpha",
          symbol: "ALP",
          decimals: 12,
        },
        {
          contractAddress: "qbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          name: "",
          symbol: "",
          decimals: 0,
        },
        {
          contractAddress: "Qcccccccccccccccccccccccccccccccccccccccc",
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
        address: "Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Alpha",
        symbol: "ALP",
        decimals: 12,
      },
      {
        address: "Qbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        name: "Unknown Token",
        symbol: "UNK",
        // 0 is a valid decimals value and must not fall through to 18
        decimals: 0,
      },
      {
        address: "Qcccccccccccccccccccccccccccccccccccccccc",
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
  it("groups per-token rows into ZRC-721 collections", async () => {
    const fetchMock = mockFetchJson({
      address: HOLDER,
      count: 4,
      nfts: [
        {
          contractAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
          tokenID: "1",
          tokenStandard: "ERC-721",
          collectionName: "Doodles",
          collectionSymbol: "DOO",
        },
        {
          contractAddress: "Qdddddddddddddddddddddddddddddddddddddddd",
          tokenID: "2",
          tokenStandard: "ERC-721",
          collectionName: "Doodles",
          collectionSymbol: "DOO",
        },
        {
          // 1155 rows are dropped: the extension gallery is 721-only
          contractAddress: "Qeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          tokenID: "7",
          tokenStandard: "ERC-1155",
          collectionName: "Multi",
          collectionSymbol: "MUL",
        },
        {
          contractAddress: "Qffffffffffffffffffffffffffffffffffffffff",
          tokenID: "9",
          tokenStandard: "ERC-721",
        },
      ],
    });

    const collections = await discoverNftCollections(
      HOLDER,
      TESTNET_CHAIN_ID,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://zondscan.com/api/address/${HOLDER}/nfts`,
    );
    expect(collections).toEqual([
      {
        address: "Qdddddddddddddddddddddddddddddddddddddddd",
        name: "Doodles",
        symbol: "DOO",
        standard: "ZRC721",
        tokenCount: 2,
      },
      {
        address: "Qffffffffffffffffffffffffffffffffffffffff",
        name: "",
        symbol: "",
        standard: "ZRC721",
        tokenCount: 1,
      },
    ]);
  });

  it("returns an empty list on malformed responses", async () => {
    mockFetchJson({ unexpected: true });
    expect(await discoverNftCollections(HOLDER, TESTNET_CHAIN_ID)).toEqual(
      [],
    );
  });
});
