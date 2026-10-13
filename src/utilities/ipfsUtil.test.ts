import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  resolveIpfsUrl,
  resolveIpfsFallbackUrl,
  fetchMetadata,
  substituteErc1155TokenId,
} from "./ipfsUtil";

describe("resolveIpfsUrl", () => {
  it("should return empty string for empty input", () => {
    expect(resolveIpfsUrl("")).toBe("");
  });

  it("should resolve ipfs://ipfs/ URIs", () => {
    expect(resolveIpfsUrl("ipfs://ipfs/QmTest123")).toBe(
      "https://qrlwallet.com/api/ipfs/QmTest123",
    );
  });

  it("should resolve ipfs:// URIs", () => {
    expect(resolveIpfsUrl("ipfs://QmTest123")).toBe(
      "https://qrlwallet.com/api/ipfs/QmTest123",
    );
  });

  it("should return data URIs as-is", () => {
    const dataUri = "data:image/png;base64,abc123";
    expect(resolveIpfsUrl(dataUri)).toBe(dataUri);
  });

  it("should return http URLs as-is", () => {
    const url = "http://example.com/image.png";
    expect(resolveIpfsUrl(url)).toBe(url);
  });

  it("should return https URLs as-is", () => {
    const url = "https://example.com/image.png";
    expect(resolveIpfsUrl(url)).toBe(url);
  });

  it("should treat bare strings as CIDs", () => {
    expect(resolveIpfsUrl("QmTest123")).toBe(
      "https://qrlwallet.com/api/ipfs/QmTest123",
    );
  });
});

describe("fetchMetadata", () => {
  const abortSignal: unknown = expect.any(AbortSignal);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should return null for empty URI", async () => {
    const result = await fetchMetadata("");
    expect(result).toBeNull();
  });

  it("should return parsed JSON on success", async () => {
    const mockData = { name: "Test NFT", image: "ipfs://Qm123" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(mockData)));

    const result = await fetchMetadata("ipfs://QmMetadata");
    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qrlwallet.com/api/ipfs/QmMetadata",
      expect.objectContaining({ signal: abortSignal }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should fall back to the public gateway when the proxy fails", async () => {
    const mockData = { name: "Rescued NFT" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // Primary (proxy) throttled or rejecting the URI shape.
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      // Fallback (ipfs.io) succeeds.
      .mockResolvedValueOnce(new Response(JSON.stringify(mockData)));

    const result = await fetchMetadata("ipfs://QmMetadata");
    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://qrlwallet.com/api/ipfs/QmMetadata",
      expect.objectContaining({ signal: abortSignal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://ipfs.io/ipfs/QmMetadata",
      expect.objectContaining({ signal: abortSignal }),
    );
  });

  it("should not retry non-gateway URIs after a failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));

    const result = await fetchMetadata("https://example.com/meta.json");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should return null when both gateways fail", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));

    const result = await fetchMetadata("ipfs://QmBad");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should return null on fetch error for both gateways", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await fetchMetadata("ipfs://QmFail");
    expect(result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, [], ["metadata"], "metadata", 42, true])(
    "rejects a non-record JSON response (%j)",
    async (metadata) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify(metadata)));

      expect(await fetchMetadata("https://example.com/meta.json")).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("falls back after a non-record primary response", async () => {
    const metadata = { name: "Fallback", extra: { preserved: [null, 42] } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata)));

    expect(await fetchMetadata("ipfs://QmMetadata")).toEqual(metadata);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves empty metadata objects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    expect(await fetchMetadata("ipfs://QmMetadata")).toEqual({});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cleans up the timeout when JSON parsing fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid"));

    expect(await fetchMetadata("https://example.com/meta.json")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a pending fetch and tries the fallback", async () => {
    const metadata = { name: "Fallback" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata)));

    const result = fetchMetadata("ipfs://QmMetadata");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await result).toEqual(metadata);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "http://example.com/meta.json",
    "https://example.com/meta.json",
    "ipfs://QmMetadata",
  ])(
    "accepts a slow response body after timely headers for %s",
    async (uri) => {
      const metadata = {
        name: "Slow valid NFT",
        image: "ipfs://QmImage",
        extra: { preserved: [2, 1] },
      };
      const body = new TextEncoder().encode(JSON.stringify(metadata));
      const onAbort = vi.fn();
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce((_url, options) => {
          const response = new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(body.slice(0, 12));
                const bodyTimeoutId = setTimeout(() => {
                  controller.enqueue(body.slice(12));
                  controller.close();
                }, 11_000);
                options?.signal?.addEventListener("abort", () => {
                  onAbort();
                  clearTimeout(bodyTimeoutId);
                  controller.error(new Error("aborted"));
                });
              },
            }),
          );
          return Promise.resolve(response);
        })
        .mockResolvedValue(new Response('{"name":"Fallback"}'));

      const result = fetchMetadata(uri);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onAbort).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(await result).toEqual(metadata);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("resolveIpfsFallbackUrl", () => {
  it("returns the public gateway URL for ipfs URIs", () => {
    expect(resolveIpfsFallbackUrl("ipfs://QmTest123")).toBe(
      "https://ipfs.io/ipfs/QmTest123",
    );
  });

  it("returns empty for URIs that never touch a gateway", () => {
    expect(resolveIpfsFallbackUrl("https://example.com/a.png")).toBe("");
    expect(resolveIpfsFallbackUrl("data:image/png;base64,abc")).toBe("");
    expect(resolveIpfsFallbackUrl("")).toBe("");
  });
});

describe("substituteErc1155TokenId", () => {
  it("substitutes {id} with 64-char zero-padded lowercase hex", () => {
    expect(
      substituteErc1155TokenId("ipfs://QmX/{id}.json", "42"),
    ).toBe(
      "ipfs://QmX/000000000000000000000000000000000000000000000000000000000000002a.json",
    );
  });

  it("replaces every occurrence of the placeholder", () => {
    expect(substituteErc1155TokenId("https://x/{id}/{id}.json", "1")).toBe(
      `https://x/${"0".repeat(63)}1/${"0".repeat(63)}1.json`,
    );
  });

  it("returns URIs without a placeholder unchanged", () => {
    expect(substituteErc1155TokenId("ipfs://QmX/1.json", "42")).toBe(
      "ipfs://QmX/1.json",
    );
  });

  it("returns the URI unchanged when the tokenId is not an integer", () => {
    expect(substituteErc1155TokenId("https://x/{id}.json", "not-a-number")).toBe(
      "https://x/{id}.json",
    );
  });

  it("handles empty input", () => {
    expect(substituteErc1155TokenId("", "1")).toBe("");
  });
});
