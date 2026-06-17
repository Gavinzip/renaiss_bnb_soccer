import zhHantLocale from "./zh-Hant.js";
import enLocale from "./en.js";

export const DEFAULT_LOCALE = "zh-Hant";

export const LOCALE_PACKS = {
  [zhHantLocale.id]: zhHantLocale,
  [enLocale.id]: enLocale,
};

export const LOCALES = Object.values(LOCALE_PACKS).map(({ id, label, nativeName, htmlLang }) => ({
  id,
  label,
  nativeName,
  htmlLang,
}));

export function getLocalePack(locale) {
  return LOCALE_PACKS[locale] ?? LOCALE_PACKS[DEFAULT_LOCALE];
}
