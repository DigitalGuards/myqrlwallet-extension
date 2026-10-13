import { describe, expect, it } from "vitest";
import { getExplorerApiBase } from "./assetDiscoveryConfig";

describe("explorer API lookup", () => {
  it.each(["0x301825", "0X301825"])(
    "resolves the known chain %s",
    (chainId) => {
      expect(getExplorerApiBase(chainId)).toBe("https://zondscan.com");
    },
  );

  it.each([
    undefined,
    null,
    42,
    {},
    [],
    "",
    "0x539",
    "constructor",
    "__proto__",
  ])("skips discovery for an unknown or malformed chain: %j", (chainId) => {
    expect(getExplorerApiBase(chainId)).toBeUndefined();
  });
});
