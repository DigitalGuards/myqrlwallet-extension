import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import AccountLabelsStore from "./accountLabelsStore";

const localStore: Record<string, any> = {};
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete localStore[key];
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

describe("AccountLabelsStore", () => {
  let store: AccountLabelsStore;
  const noLedger = () => false;

  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    store = new AccountLabelsStore();
  });

  describe("loadLabels", () => {
    it("should load labels from storage", async () => {
      localStore["ACCOUNT_LABELS"] = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      await store.loadLabels();

      expect(store.labels).toEqual({
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      });
      expect(store.isLoading).toBe(false);
    });

    it("should return empty object when no labels in storage", async () => {
      await store.loadLabels();

      expect(store.labels).toEqual({});
      expect(store.isLoading).toBe(false);
    });
  });

  describe("syncLabels", () => {
    it("should auto-generate labels for new accounts", async () => {
      const accounts = [
        { accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779" },
        { accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b" },
      ];

      await store.syncLabels(accounts, noLedger);

      expect(store.getLabel("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        "Account 1",
      );
      expect(store.getLabel("Q20fB08fF1f1376A14C055E9F56df80563E16722b")).toBe(
        "Account 2",
      );
    });

    it("should label Ledger accounts with 'Ledger' prefix", async () => {
      const accounts = [
        { accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779" },
        { accountAddress: "Q30aA00aA0a0000A00A000A0A00aa00000A00000c" },
      ];
      const isLedger = (addr: string) =>
        addr === "Q30aA00aA0a0000A00A000A0A00aa00000A00000c";

      await store.syncLabels(accounts, isLedger);

      expect(store.getLabel("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        "Account 1",
      );
      expect(store.getLabel("Q30aA00aA0a0000A00A000A0A00aa00000A00000c")).toBe(
        "Ledger 1",
      );
    });

    it("should avoid number collisions with existing labels", async () => {
      // Pre-seed: "Account 2" already taken
      localStore["ACCOUNT_LABELS"] = {
        Q20fB08fF1f1376A14C055E9F56df80563E16722b: "Account 2",
      };

      const accounts = [
        { accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b" },
        { accountAddress: "Q30aA00aA0a0000A00A000A0A00aa00000A00000c" },
      ];

      await store.syncLabels(accounts, noLedger);

      // Existing label preserved
      expect(store.getLabel("Q20fB08fF1f1376A14C055E9F56df80563E16722b")).toBe(
        "Account 2",
      );
      // New account gets "Account 1" (not "Account 2" which is taken)
      expect(store.getLabel("Q30aA00aA0a0000A00A000A0A00aa00000A00000c")).toBe(
        "Account 1",
      );
    });

    it("should persist labels to storage when new labels are generated", async () => {
      const accounts = [
        { accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779" },
      ];

      await store.syncLabels(accounts, noLedger);

      expect(localStore["ACCOUNT_LABELS"]).toEqual({
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      });
    });

    it("should not write to storage if no new labels needed", async () => {
      localStore["ACCOUNT_LABELS"] = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      const accounts = [
        { accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779" },
      ];

      const browser = (await import("webextension-polyfill")).default;
      const setCalls = (browser.storage.local.set as Mock).mock.calls
        .length;

      await store.syncLabels(accounts, noLedger);

      // set should not be called again since label already exists
      expect(
        (browser.storage.local.set as Mock).mock.calls.length,
      ).toBe(setCalls);
    });

    it("should preserve existing labels on sync", async () => {
      localStore["ACCOUNT_LABELS"] = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "My Main",
      };

      const accounts = [
        { accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779" },
        { accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b" },
      ];

      await store.syncLabels(accounts, noLedger);

      expect(store.getLabel("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        "My Main",
      );
      expect(store.getLabel("Q20fB08fF1f1376A14C055E9F56df80563E16722b")).toBe(
        "Account 1",
      );
    });
  });

  describe("setLabel", () => {
    it("should update a single label", async () => {
      store.labels = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      await store.setLabel(
        "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
        "My Wallet",
      );

      expect(store.getLabel("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        "My Wallet",
      );
    });

    it("should persist the updated label to storage", async () => {
      store.labels = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      await store.setLabel(
        "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
        "My Wallet",
      );

      expect(localStore["ACCOUNT_LABELS"]).toEqual({
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "My Wallet",
      });
    });

    it("should preserve other labels when updating one", async () => {
      store.labels = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
        Q20fB08fF1f1376A14C055E9F56df80563E16722b: "Account 2",
      };

      await store.setLabel(
        "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
        "My Wallet",
      );

      expect(store.getLabel("Q20fB08fF1f1376A14C055E9F56df80563E16722b")).toBe(
        "Account 2",
      );
    });
  });

  describe("getLabel", () => {
    it("should return label for known address", () => {
      store.labels = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      expect(store.getLabel("Q20B714091cF2a62DADda2847803e3f1B9D2D3779")).toBe(
        "Account 1",
      );
    });

    it("should return empty string for unknown address", () => {
      expect(store.getLabel("Q0000000000000000000000000000000000000000")).toBe(
        "",
      );
    });
  });

  describe("ensureLabel", () => {
    const ADDRESS = "Q20B714091cF2a62DADda2847803e3f1B9D2D3779";
    const OTHER = "Q20fB08fF1f1376A14C055E9F56df80563E16722b";

    it("names a brand-new account immediately", async () => {
      // Without this the header falls back to the raw address until some
      // other screen happens to run syncLabels.
      await store.ensureLabel(ADDRESS);

      expect(store.getLabel(ADDRESS)).toBe("Account 1");
      expect(localStore["ACCOUNT_LABELS"][ADDRESS]).toBe("Account 1");
    });

    it("does not renumber an account that already has a label", async () => {
      localStore["ACCOUNT_LABELS"] = { [ADDRESS]: "Savings" };

      await store.ensureLabel(ADDRESS);

      expect(store.getLabel(ADDRESS)).toBe("Savings");
    });

    it("picks the next free number alongside existing labels", async () => {
      localStore["ACCOUNT_LABELS"] = { [OTHER]: "Account 1" };

      await store.ensureLabel(ADDRESS);

      expect(store.getLabel(ADDRESS)).toBe("Account 2");
    });

    it("does not collide with numbers syncLabels would hand out", async () => {
      await store.ensureLabel(ADDRESS);
      await store.syncLabels([{ accountAddress: OTHER }], noLedger);

      expect(store.getLabel(ADDRESS)).toBe("Account 1");
      expect(store.getLabel(OTHER)).toBe("Account 2");
    });

    it("uses the Ledger prefix and its own numbering", async () => {
      localStore["ACCOUNT_LABELS"] = { [OTHER]: "Account 1" };

      await store.ensureLabel(ADDRESS, true);

      expect(store.getLabel(ADDRESS)).toBe("Ledger 1");
    });

    it("ignores an empty address", async () => {
      await store.ensureLabel("");

      expect(localStore["ACCOUNT_LABELS"]).toBeUndefined();
    });
  });

  describe("clearLabels", () => {
    it("should clear all labels from store and storage", async () => {
      store.labels = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };
      localStore["ACCOUNT_LABELS"] = {
        Q20B714091cF2a62DADda2847803e3f1B9D2D3779: "Account 1",
      };

      await store.clearLabels();

      expect(store.labels).toEqual({});
      expect(localStore["ACCOUNT_LABELS"]).toBeUndefined();
    });
  });
});
