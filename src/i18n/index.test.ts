import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";

const { init, instance } = vi.hoisted(() => {
  const init = vi.fn<() => Promise<unknown>>();
  return { init, instance: { use: vi.fn(() => ({ init })) } };
});

vi.mock("i18next", () => ({ default: instance }));

beforeEach(() => {
  vi.resetModules();
  init.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("translation initialization", () => {
  it("retains the bundled resources and initial language", async () => {
    const { default: i18n } = await import("./index");
    expect(i18n).toBe(instance);
    expect(init).toHaveBeenCalledWith({
      resources: {
        en: { translation: en },
        es: { translation: es },
        de: { translation: de },
      },
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  it("reports a rejected initialization", async () => {
    const error = new Error("Translation initialization failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    init.mockRejectedValueOnce(error);
    await import("./index");
    expect(report).toHaveBeenCalledWith(
      "Failed to initialize translations:",
      error,
    );
  });

  it("awaits test translations before exporting the instance", async () => {
    const { default: i18n } = await import("../__mocks__/i18nTestSetup");
    expect(i18n).toBe(instance);
    expect(init).toHaveBeenCalledWith({
      resources: { en: { translation: en } },
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  it("fails test setup when translations cannot initialize", async () => {
    const error = new Error("Test translations failed");
    init.mockRejectedValueOnce(error);
    await expect(import("../__mocks__/i18nTestSetup")).rejects.toBe(error);
  });
});
