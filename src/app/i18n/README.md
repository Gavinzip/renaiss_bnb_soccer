# I18n Module

All reader-facing campaign copy lives in `locales/`. Data files should keep ids,
numbers, dates, statuses, and asset references only.

To add a language:

1. Copy `locales/en.js` or `locales/zh-Hant.js`.
2. Change the locale `id`, `label`, `nativeName`, and `htmlLang`.
3. Translate `messages`, `teams`, and `venues`.
4. Import and register the pack in `locales/index.js`.
5. Run `npm run i18n:check` and `npm run build`.

Components should use `useCampaignCopy()` or `t()` instead of inline UI strings.
Round labels, milestone labels, team names, and venue names are all resolved
through locale packs so future languages can be added without touching screen
components or campaign data.
