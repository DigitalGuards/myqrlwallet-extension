import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANGUAGE_OPTIONS } from "./languages";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      de: { translation: de },
      ru: { translation: ru },
      "zh-CN": { translation: zhCN },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: LANGUAGE_OPTIONS.map(({ value }) => value),
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize translations:", error);
  });

export default i18n;
