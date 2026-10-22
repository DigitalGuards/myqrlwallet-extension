import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";

const catalogs: Record<string, Record<string, string>> = {
  en,
  de,
  es,
  ru,
  "zh-CN": zhCN,
};
const english: Record<string, string> = en;
const pluralSuffix = /_(one|few|many|other)$/;
const pluralRoots = Object.keys(en)
  .filter((key) => key.endsWith("_one"))
  .map((key) => key.replace(pluralSuffix, ""));
const placeholders = (value: string) =>
  [...value.matchAll(/\{\{[^{}]+\}\}/g)].map(([match]) => match).sort();

describe.each(Object.entries(catalogs))("%s catalog", (language, catalog) => {
  it("contains every English key and only valid additional plural forms", () => {
    const expectedKeys = new Set(Object.keys(en));
    for (const key of expectedKeys) {
      expect(catalog, key).toHaveProperty([key]);
    }
    for (const key of Object.keys(catalog)) {
      if (expectedKeys.has(key)) continue;
      expect(key, key).toMatch(pluralSuffix);
      expect(pluralRoots, key).toContain(key.replace(pluralSuffix, ""));
      expect(
        new Intl.PluralRules(language).resolvedOptions().pluralCategories,
        key,
      ).toContain(key.split("_").slice(-1)[0]);
    }
    expect(
      [
        ...new Set(
          Object.keys(catalog).map((key) => key.replace(pluralSuffix, "")),
        ),
      ].sort(),
    ).toEqual(
      [
        ...new Set(Object.keys(en).map((key) => key.replace(pluralSuffix, ""))),
      ].sort(),
    );
  });

  it("preserves every interpolation placeholder in nonempty string values", () => {
    for (const [key, value] of Object.entries(catalog)) {
      const source =
        english[key] ?? english[key.replace(pluralSuffix, "_other")];
      expect(typeof value, key).toBe("string");
      expect(value.trim(), key).not.toBe("");
      expect(placeholders(value), key).toEqual(placeholders(source));
    }
  });
});

describe("localized plurals", () => {
  it("supplies every Russian cardinal form for each English plural family", () => {
    for (const root of pluralRoots) {
      for (const suffix of ["one", "few", "many", "other"]) {
        expect(ru).toHaveProperty([`${root}_${suffix}`]);
      }
    }
  });

  it.each(["ru", "zh-CN"])(
    "renders %s counts through i18next",
    async (language) => {
      const catalog = catalogs[language];
      const instance = createInstance();
      await instance.init({
        lng: language,
        fallbackLng: false,
        resources: { [language]: { translation: catalog } },
      });
      for (const count of [0, 1, 2, 5, 11, 21, 22, 25, 101, 1.5]) {
        const suffix = new Intl.PluralRules(language).select(count);
        for (const root of pluralRoots) {
          expect(instance.t(root, { count }), `${root}: ${count}`).toBe(
            catalog[`${root}_${suffix}`].replace("{{count}}", String(count)),
          );
        }
      }
      if (language === "ru") {
        expect(instance.t("discovery.itemCount", { count: 1 })).toBe(
          "1 объект",
        );
        expect(instance.t("discovery.itemCount", { count: 2 })).toBe(
          "2 объекта",
        );
        expect(instance.t("discovery.itemCount", { count: 5 })).toBe(
          "5 объектов",
        );
        expect(instance.t("discovery.itemCount", { count: 21 })).toBe(
          "21 объект",
        );
      }
    },
  );
});
