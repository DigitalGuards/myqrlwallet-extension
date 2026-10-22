export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "zh-CN", label: "简体中文" },
];

export const resolveLanguage = (language: string): string =>
  LANGUAGE_OPTIONS.some((option) => option.value === language)
    ? language
    : "en";
