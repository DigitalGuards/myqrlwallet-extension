import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { hasLegacyWalletData } from "./legacyWalletData";

const local: Record<string, unknown> = {};
const legacyAddress = `Q${"a".repeat(40)}`;

beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
    const wanted =
      keys === null
        ? Object.keys(local)
        : typeof keys === "string"
          ? [keys]
          : (keys as string[]);
    return Object.fromEntries(
      wanted.filter((key) => key in local).map((key) => [key, local[key]]),
    );
  });
});

describe("hasLegacyWalletData", () => {
  it("reports nothing on a clean install", async () => {
    expect(await hasLegacyWalletData()).toBe(false);
  });

  it("detects a pre-v3 keystore under the unprefixed key", async () => {
    local.KEYSTORES = JSON.stringify([
      { address: legacyAddress, crypto: { ciphertext: "preserved" } },
    ]);
    expect(await hasLegacyWalletData()).toBe(true);
  });

  it("detects a pre-v3 account list under the unprefixed key", async () => {
    local.ACCOUNTS = { ALL_ACCOUNTS: [legacyAddress] };
    expect(await hasLegacyWalletData()).toBe(true);
  });

  it("ignores empty leftovers with nothing to recover", async () => {
    local.KEYSTORES = JSON.stringify([]);
    local.ACCOUNTS = { ALL_ACCOUNTS: [], ACTIVE_ACCOUNT: "" };
    expect(await hasLegacyWalletData()).toBe(false);
  });

  it("ignores unreadable or malformed leftovers", async () => {
    local.KEYSTORES = "not json";
    local.ACCOUNTS = "not an object";
    expect(await hasLegacyWalletData()).toBe(false);
  });

  it("ignores v3 records, which carry the prefixed keys", async () => {
    local[
      "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:KEYSTORES"
    ] = JSON.stringify([{ address: legacyAddress }]);
    expect(await hasLegacyWalletData()).toBe(false);
  });

  it("never throws when the storage area rejects", async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValue(
      new Error("storage unavailable"),
    );
    expect(await hasLegacyWalletData()).toBe(false);
  });
});
