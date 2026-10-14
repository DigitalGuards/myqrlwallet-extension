import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
import { deferred } from "@/test-utils/deferred";
import { SIDE_PANEL_PATH } from "@/scripts/utils/sidePanelPreference";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi
    .fn<(message: unknown) => Promise<void>>()
    .mockResolvedValue(undefined),
}));

const localStore: Record<string, unknown> = {};
vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        ),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          Reflect.deleteProperty(localStore, key);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore))
            Reflect.deleteProperty(localStore, k);
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
    runtime: {
      sendMessage: mockSendMessage,
    },
    alarms: {
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
    },
  },
}));

import browser from "webextension-polyfill";
import SettingsStore from "./settingsStore";
import StorageUtil from "@/utilities/storageUtil";

const mockedBrowser = vi.mocked(browser, true);

describe("SettingsStore", () => {
  let store: SettingsStore;

  beforeEach(() => {
    for (const k of Object.keys(localStore))
      Reflect.deleteProperty(localStore, k);

    // Provide minimal DOM stubs for the constructor
    const root = document.documentElement;
    root.classList.remove("dark", "light");

    store = new SettingsStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should initialize with default values", () => {
    expect(store.themePreference).toBe("system");
    expect(store.autoLockMinutes).toBe(15);
    expect(store.currency).toBe("USD");
    expect(store.language).toBe("en");
  });

  it("should have a theme based on system preference", () => {
    expect(["dark", "light"]).toContain(store.theme);
    expect(typeof store.isDarkMode).toBe("boolean");
  });

  describe("setThemePreference", () => {
    it("should update themePreference to light", async () => {
      await store.setThemePreference("light");

      expect(store.themePreference).toBe("light");
      expect(store.theme).toBe("light");
      expect(store.isDarkMode).toBe(false);
    });

    it("should update themePreference to dark", async () => {
      await store.setThemePreference("dark");

      expect(store.themePreference).toBe("dark");
      expect(store.theme).toBe("dark");
      expect(store.isDarkMode).toBe(true);
    });

    it("should persist the preference to storage", async () => {
      await store.setThemePreference("dark");

      const settings = await StorageUtil.getSettings();
      expect(settings.themePreference).toBe("dark");
    });

    it("should update themePreference to system", async () => {
      await store.setThemePreference("dark");
      await store.setThemePreference("system");

      expect(store.themePreference).toBe("system");
      expect(["dark", "light"]).toContain(store.theme);
    });
  });

  describe("setAutoLockMinutes", () => {
    it("should update autoLockMinutes", async () => {
      await store.setAutoLockMinutes(5);

      expect(store.autoLockMinutes).toBe(5);
    });

    it("should persist to storage", async () => {
      await store.setAutoLockMinutes(30);

      const settings = await StorageUtil.getSettings();
      expect(settings.autoLockMinutes).toBe(30);
    });

    it("should allow setting to 0 (never)", async () => {
      await store.setAutoLockMinutes(0);

      expect(store.autoLockMinutes).toBe(0);

      const settings = await StorageUtil.getSettings();
      expect(settings.autoLockMinutes).toBe(0);
    });

    it("should send UPDATE_AUTO_LOCK message to service worker", async () => {
      await store.setAutoLockMinutes(10);

      expect(mockSendMessage).toHaveBeenCalledWith({
        name: "LOCK_MANAGER_UPDATE_AUTO_LOCK",
      });
    });

    it("should not throw if sendMessage fails", async () => {
      mockSendMessage.mockRejectedValueOnce(new Error("SW not ready"));

      await expect(store.setAutoLockMinutes(5)).resolves.not.toThrow();
      expect(store.autoLockMinutes).toBe(5);
    });
  });

  describe("setCurrency", () => {
    it("should update currency", async () => {
      await store.setCurrency("EUR");

      expect(store.currency).toBe("EUR");
    });

    it("should persist to storage", async () => {
      await store.setCurrency("PLN");

      const settings = await StorageUtil.getSettings();
      expect(settings.currency).toBe("PLN");
    });
  });

  describe("setLanguage", () => {
    it("should update language", async () => {
      await store.setLanguage("pl");

      expect(store.language).toBe("pl");
    });

    it("should persist to storage", async () => {
      await store.setLanguage("de");

      const settings = await StorageUtil.getSettings();
      expect(settings.language).toBe("de");
    });

    it("reports a language change rejection and persists the selected language", async () => {
      await store.whenSettingsLoaded();
      const error = new Error("language unavailable");
      vi.spyOn(i18n, "changeLanguage").mockRejectedValueOnce(error);
      const report = vi.spyOn(console, "error").mockImplementation(() => {});

      await store.setLanguage("de");

      expect(store.language).toBe("de");
      expect(await StorageUtil.getSettings()).toMatchObject({ language: "de" });
      expect(report).toHaveBeenCalledWith("Failed to change language:", error);
    });

    it("starts persistence while the language change is still pending", async () => {
      await store.whenSettingsLoaded();
      const languageChange =
        deferred<Awaited<ReturnType<typeof i18n.changeLanguage>>>();
      const change = vi
        .spyOn(i18n, "changeLanguage")
        .mockReturnValueOnce(languageChange.promise);
      const persist = vi.spyOn(StorageUtil, "setSettings");

      await store.setLanguage("de");

      expect(change).toHaveBeenCalledWith("de");
      expect(persist).toHaveBeenCalledTimes(1);
      expect(change.mock.invocationCallOrder[0]).toBeLessThan(
        persist.mock.invocationCallOrder[0],
      );
      languageChange.resolve(i18n.t.bind(i18n));
    });
  });

  describe("side panel preference", () => {
    it("persists the choice before configuring the panel in order", async () => {
      await store.whenSettingsLoaded();
      const persist = vi.spyOn(StorageUtil, "setSettings");
      const setPanelBehavior = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      const setOptions = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      vi.stubGlobal("chrome", { sidePanel: { setPanelBehavior, setOptions } });

      await store.setSidePanelPreferred(true);

      expect(setPanelBehavior).toHaveBeenCalledWith({
        openPanelOnActionClick: true,
      });
      expect(setOptions).toHaveBeenCalledWith({ path: SIDE_PANEL_PATH });
      expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
        setPanelBehavior.mock.invocationCallOrder[0],
      );
      expect(setPanelBehavior.mock.invocationCallOrder[0]).toBeLessThan(
        setOptions.mock.invocationCallOrder[0],
      );
      expect(await StorageUtil.getSettings()).toMatchObject({
        sidePanelSurface: "panel",
        sidePanelNoticePending: false,
        sidePanelNoticeSeen: true,
      });

      await store.setSidePanelPreferred(false);
      expect(setPanelBehavior).toHaveBeenLastCalledWith({
        openPanelOnActionClick: false,
      });
      expect(setOptions).toHaveBeenCalledTimes(1);
    });

    it.each([
      undefined,
      null,
      {},
      { sidePanel: {} },
      { sidePanel: { setPanelBehavior: "unavailable" } },
    ])(
      "persists the choice when the native API is unavailable: %j",
      async (nativeApi) => {
        await store.whenSettingsLoaded();
        vi.stubGlobal("chrome", nativeApi);
        await store.setSidePanelPreferred(true);
        expect(await StorageUtil.getSettings()).toMatchObject({
          sidePanelSurface: "panel",
        });
      },
    );

    it("retains the choice when native configuration rejects", async () => {
      await store.whenSettingsLoaded();
      const setOptions = vi.fn();
      vi.stubGlobal("chrome", {
        sidePanel: {
          setPanelBehavior: vi.fn().mockRejectedValue(new Error("unavailable")),
          setOptions,
        },
      });
      await store.setSidePanelPreferred(true);
      expect(setOptions).not.toHaveBeenCalled();
      expect(await StorageUtil.getSettings()).toMatchObject({
        sidePanelSurface: "panel",
      });
    });
  });

  describe("loadSettings (via constructor)", () => {
    it("reports a language load rejection and finishes loading the other settings", async () => {
      await store.whenSettingsLoaded();
      await StorageUtil.setSettings({
        language: "fr",
        currency: "GBP",
        notificationsEnabled: false,
      });
      const error = new Error("language unavailable");
      vi.spyOn(i18n, "changeLanguage").mockRejectedValueOnce(error);
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const loaded = new SettingsStore();

      await loaded.whenSettingsLoaded();

      expect(loaded.language).toBe("fr");
      expect(loaded.currency).toBe("GBP");
      expect(loaded.notificationsEnabled).toBe(false);
      expect(report).toHaveBeenCalledWith("Failed to change language:", error);
    });

    it("preserves unreadable and future settings when another field changes", async () => {
      await store.whenSettingsLoaded();
      const key = `${V3_STORAGE_PREFIX}SETTINGS`;
      const stored = {
        language: { future: "locale" },
        currency: "GBP",
        future: [1, 2],
      };
      localStore[key] = stored;
      const loaded = new SettingsStore();
      await loaded.whenSettingsLoaded();
      expect(loaded.language).toBe("en");

      await loaded.setCurrency("EUR");

      expect(localStore[key]).toEqual({ ...stored, currency: "EUR" });
    });
    it("should load persisted settings on construction", async () => {
      await StorageUtil.setSettings({
        themePreference: "dark",
        autoLockMinutes: 30,
        currency: "GBP",
        language: "fr",
      });

      const newStore = new SettingsStore();

      // Wait for async loadSettings to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(newStore.themePreference).toBe("dark");
      expect(newStore.autoLockMinutes).toBe(30);
      expect(newStore.currency).toBe("GBP");
      expect(newStore.language).toBe("fr");
    });

    it("should keep defaults when no settings in storage", async () => {
      const newStore = new SettingsStore();

      await new Promise((r) => setTimeout(r, 50));

      expect(newStore.themePreference).toBe("system");
      expect(newStore.autoLockMinutes).toBe(15);
      expect(newStore.currency).toBe("USD");
      expect(newStore.language).toBe("en");
    });
  });
  describe("a failed settings read", () => {
    it("resolves whenSettingsLoaded with the defaults", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockedBrowser.storage.local.get.mockRejectedValueOnce(
        new Error("storage unavailable"),
      );

      const failing = new SettingsStore();
      // A rejection here would reject everything chained off it, and the
      // price refresh (wired through this promise) would never be armed.
      await expect(failing.whenSettingsLoaded()).resolves.toBeUndefined();
      expect(failing.showBalanceAndPrice).toBe(true);
      expect(failing.currency).toBe("USD");
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});