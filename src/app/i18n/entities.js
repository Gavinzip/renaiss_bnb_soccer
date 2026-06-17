import { LOCALE_PACKS } from "./locales/index.js";

export const TEAM_NAMES = Object.fromEntries(
  Object.values(LOCALE_PACKS).map((locale) => [locale.id, locale.teams]),
);

export const VENUE_NAMES = Object.fromEntries(
  Object.values(LOCALE_PACKS).map((locale) => [locale.id, locale.venues]),
);
