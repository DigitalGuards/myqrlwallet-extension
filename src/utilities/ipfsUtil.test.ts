import { describe, expect, it, vi, beforeEach } from "vitest";
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null for empty URI", async () => {
    const result = await fetchMetadata("");
    expect(result).toBeNull();
  });

  it("should return parsed JSON on success", async () => {
    const mockData = { name: "Test NFT", image: "ipfs://Qm123" };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockData),
      }),
    ) as any;

    const result = await fetchMetadata("ipfs://QmMetadata");
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://qrlwallet.com/api/ipfs/QmMetadata",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("should fall back to the public gateway when the proxy fails", async () => {
    const mockData = { name: "Rescued NFT" };
    global.fetch = vi
      .fn()
      // Primary (proxy) throttled or rejecting the URI shape.
      .mockResolvedValueOnce({ ok: false, status: 429 })
      // Fallback (ipfs.io) succeeds.
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      }) as any;

    const result = await fetchMetadata("ipfs://QmMetadata");
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://qrlwallet.com/api/ipfs/QmMetadata",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://ipfs.io/ipfs/QmMetadata",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("should not retry non-gateway URIs after a failure", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false })) as any;

    const result = await fetchMetadata("https://example.com/meta.json");
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should return null when both gateways fail", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false }),
    ) as any;

    const result = await fetchMetadata("ipfs://QmBad");
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should return null on fetch error for both gateways", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("Network error")),
    ) as any;

    const result = await fetchMetadata("ipfs://QmFail");
    expect(result).toBeNull();
  });
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
