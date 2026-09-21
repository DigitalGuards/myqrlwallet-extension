import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
const profileStorageKey = (key: string) => `${V3_STORAGE_PREFIX}${key}`;
import { beforeEach, describe, expect, it, vi } from "vitest";
import HiddenAccountsStore from "./hiddenAccountsStore";

const localStore: Record<string, any> = {};
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string | null) =>
          Promise.resolve(
            key === null
              ? { ...localStore }
              : key in localStore
                ? { [key]: localStore[key] }
                : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key])
            delete localStore[item];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  },
}));

describe("HiddenAccountsStore", () => {
  let store: HiddenAccountsStore;

  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    store = new HiddenAccountsStore();
  });

  describe("loadHiddenAccounts", () => {
    it("should load hidden accounts from storage", async () => {
      localStore[profileStorageKey("HIDDEN_ACCOUNTS")] = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: true,
      };

      await store.loadHiddenAccounts();

      expect(store.hiddenAccounts).toEqual({
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: true,
      });
    });

    it("should return empty object when no hidden accounts in storage", async () => {
      await store.loadHiddenAccounts();

      expect(store.hiddenAccounts).toEqual({});
    });
  });

  describe("hideAccount", () => {
    it("should mark an account as hidden", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");

      expect(store.isHidden("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        true,
      );
    });

    it("should persist to storage", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");

      expect(localStore[profileStorageKey("HIDDEN_ACCOUNTS")]).toEqual({
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: true,
      });
    });

    it("should preserve existing hidden accounts", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");
      await store.hideAccount("Q20fB08fF1f1376A14C055E9F56df80563E16722b");

      expect(store.isHidden("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        true,
      );
      expect(store.isHidden("Q20fB08fF1f1376A14C055E9F56df80563E16722b")).toBe(
        true,
      );
    });
  });

  describe("unhideAccount", () => {
    it("should remove an account from hidden list", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");
      await store.unhideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");

      expect(store.isHidden("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        false,
      );
    });

    it("should persist to storage after unhide", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");
      await store.hideAccount("Q20fB08fF1f1376A14C055E9F56df80563E16722b");
      await store.unhideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");

      expect(localStore[profileStorageKey("HIDDEN_ACCOUNTS")]).toEqual({
        Q20fB08fF1f1376A14C055E9F56df80563E16722b: true,
      });
    });
  });

  describe("isHidden", () => {
    it("should return true for hidden account", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");

      expect(store.isHidden("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        true,
      );
    });

    it("should return false for non-hidden account", () => {
      expect(store.isHidden("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        false,
      );
    });
  });

  describe("hiddenAddresses", () => {
    it("should return list of hidden addresses", async () => {
      await store.hideAccount("Q20B714091cF2a62DADda2847803e3f1B9D2D3779");
      await store.hideAccount("Q20fB08fF1f1376A14C055E9F56df80563E16722b");

      expect(store.hiddenAddresses).toEqual(
        expect.arrayContaining([
          "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        ]),
      );
      expect(store.hiddenAddresses).toHaveLength(2);
    });

    it("should return empty array when no accounts hidden", () => {
      expect(store.hiddenAddresses).toEqual([]);
    });
  });
});
