import { DEFAULT_LOCALE, LOCALES, LOCALE_PACKS, getLocalePack } from "./locales/index.js";

export { DEFAULT_LOCALE, LOCALES, LOCALE_PACKS };

export const TRANSLATIONS = Object.fromEntries(
  Object.values(LOCALE_PACKS).map((locale) => [locale.id, locale.messages]),
);

function resolveKey(source, key) {
  return key.split(".").reduce((current, part) => current?.[part], source);
}

function interpolate(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

export function createTranslator(locale) {
  const dictionary = getLocalePack(locale).messages;

  return (key, values) => {
    const value = resolveKey(dictionary, key);
    if (typeof value !== "string") return key;
    return interpolate(value, values);
  };
}

export function getTranslationValue(locale, key) {
  return resolveKey(getLocalePack(locale).messages, key);
}

export function getLocaleOption(locale) {
  const selected = getLocalePack(locale);
  return {
    id: selected.id,
    label: selected.label,
    nativeName: selected.nativeName,
    htmlLang: selected.htmlLang,
  };
}

export function getHtmlLang(locale) {
  return getLocaleOption(locale).htmlLang;
}
