import { useMemo } from "react";
import { formatCompactVoteCount, formatDateTime, formatNumber } from "../data/ticketMath";
import { TEAM_NAMES, VENUE_NAMES } from "./entities";
import { useI18n } from "./I18nProvider";
import { getTranslationValue } from "./translations";

const SOURCE_LABEL_KEYS = {
  bundled: "data.bundledMilestoneSource",
  "verified-bsc-ledger": "data.verifiedLedgerSource",
  "live-ledger-api": "data.liveLedgerSource",
  "live-milestone-api": "data.liveMilestoneSource",
};

export function useCampaignCopy() {
  const { locale, localeOption, locales, setLocale, t } = useI18n();

  return useMemo(() => {
    function teamName(team) {
      if (!team) return "";
      if (team.revealState === "unrevealed") return t("liveQualification.unrevealed");
      return TEAM_NAMES[locale]?.[team.id] ?? team.name ?? team.id;
    }

    function venueName(venue) {
      if (!venue) return "";
      return VENUE_NAMES[locale]?.[venue] ?? venue;
    }

    function sourceLabel(label) {
      if (!label) return t("ledger.missingSourceLabel");
      const translationKey = SOURCE_LABEL_KEYS[label];
      return translationKey ? t(translationKey) : label;
    }

    function roundLabel(round, field = "label") {
      if (!round) return "";
      const key = `rounds.${round.id}.${field}`;
      const translated = t(key);
      return translated === key ? round.id : translated;
    }

    function roundPrize(round) {
      if (!round) return "";
      const key = `rounds.${round.id}.prize`;
      const translated = t(key, { count: formatNumber(round.prizeCount ?? 0, locale) });
      return translated === key ? round.id : translated;
    }

    function matchStatus(status) {
      return t(`matchStatus.${status}`);
    }

    function matchStatusCompact(status) {
      const value = t(`matchStatusCompact.${status}`);
      return value === `matchStatusCompact.${status}` ? matchStatus(status) : value;
    }

    function roundStatus(round, draw) {
      if (draw?.drawStatusResolved === "eligible_ready") return t("roundStatus.eligible_ready");
      if (draw?.drawStatusResolved === "pending_results") return t("roundStatus.pending_results");
      return t(`roundStatus.${round?.status || "scheduled"}`);
    }

    function milestoneLabel(milestone) {
      const value = getTranslationValue(locale, `milestones.${milestone.id}`);
      if (Array.isArray(value)) return value[0];
      return t("milestones.fallbackLabel", { index: milestone.labelFallbackIndex ?? "" });
    }

    function milestonePrize(milestone) {
      const value = getTranslationValue(locale, `milestones.${milestone.id}`);
      if (Array.isArray(value)) return value[1];
      return t("milestones.fallbackPrize", { index: milestone.prizeFallbackIndex ?? "" });
    }

    function metricType(type) {
      return t(`metricTypes.${type}`) === `metricTypes.${type}` ? String(type || "").replace(/[_-]/g, " ") : t(`metricTypes.${type}`);
    }

    function copyList(key) {
      const value = getTranslationValue(locale, key);
      return Array.isArray(value) ? value : [];
    }

    return {
      locale,
      localeOption,
      locales,
      setLocale,
      t,
      dateTime: (value) => formatDateTime(value, locale),
      number: (value) => formatNumber(value, locale),
      compactVotes: (value) => formatCompactVoteCount(value, locale),
      teamName,
      venueName,
      sourceLabel,
      roundLabel,
      roundPrize,
      roundStatus,
      matchStatus,
      matchStatusCompact,
      milestoneLabel,
      milestonePrize,
      metricType,
      copyList,
    };
  }, [locale, localeOption, locales, setLocale, t]);
}
