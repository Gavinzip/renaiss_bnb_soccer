import { verifiedLedgerSnapshot } from "./ticketLedgerSnapshot";
import { campaignMatches, roundDefinitions } from "./worldCupCampaign";
import { estimateMultiPrizeChance } from "./ticketMath";

export const DEFAULT_VIEW_ID = "home";
export const DEFAULT_ROUND_ID = "round16";
export const DEFAULT_MATCH_ID = "m74";
export const DEFAULT_TICKET_AMOUNT = 12;

export const commandViews = [
  { id: "home" },
  { id: "schedule" },
  { id: "vote" },
  { id: "draw" },
];

export function normalizeLedgerSummary(payload) {
  if (!payload || typeof payload !== "object") return null;
  const entries = Array.isArray(payload.leaderboardEntries)
    ? payload.leaderboardEntries
    : Array.isArray(payload.entries)
      ? payload.entries.slice(0, 8)
      : [];

  if (!payload.totalFinalTickets || entries.length === 0) return null;

  return {
    ...verifiedLedgerSnapshot,
    ...payload,
    sourceLabel: payload.sourceLabel || "live-ledger-api",
    packRules: Array.isArray(payload.packRules) && payload.packRules.length > 0
      ? payload.packRules
      : verifiedLedgerSnapshot.packRules,
    leaderboardEntries: entries,
  };
}

function readFirstDefined(source, keys) {
  return keys.reduce((result, key) => (result === undefined ? source?.[key] : result), undefined);
}

function normalizeMilestoneRow(row, index) {
  if (!row || typeof row !== "object") return null;

  const rawThreshold = readFirstDefined(row, [
    "threshold",
    "thresholdValue",
    "threshold_value",
    "target",
    "targetValue",
    "target_value",
  ]);
  const threshold = Math.max(0, Math.floor(Number(rawThreshold) || 0));
  if (threshold <= 0) return null;

  const label = readFirstDefined(row, ["label", "displayLabel", "display_label", "name"]);
  const prizeAddition = readFirstDefined(row, [
    "prizeAddition",
    "prize_addition",
    "prizeLabel",
    "prize_label",
    "description",
  ]);
  const rewardAmount = readFirstDefined(row, ["rewardAmount", "reward_amount", "amount", "cashAmount", "cash_amount"]);
  const rewardSlots = readFirstDefined(row, ["rewardSlots", "reward_slots", "prizeSlots", "prize_slots", "slots"]);

  return {
    id: String(readFirstDefined(row, ["id", "milestoneId", "milestone_id", "slug"]) ?? `milestone-${index + 1}`),
    threshold,
    label: label === undefined ? "" : String(label),
    labelFallbackIndex: index + 1,
    prizeAddition: prizeAddition === undefined ? "" : String(prizeAddition),
    prizeFallbackIndex: index + 1,
    rewardAmount: Math.max(0, Math.floor(Number(rewardAmount) || 0)),
    rewardCurrency: String(readFirstDefined(row, ["rewardCurrency", "reward_currency", "currency"]) ?? "USDT"),
    rewardSlots: Math.max(0, Math.floor(Number(rewardSlots) || 0)),
    status: String(readFirstDefined(row, ["status", "state"]) ?? "locked"),
    metricType: String(readFirstDefined(row, ["metricType", "metric_type"]) ?? "tickets_issued"),
  };
}

export function normalizeMilestoneSummary(payload) {
  if (!payload) return null;

  const source = Array.isArray(payload)
    ? { milestones: payload }
    : payload;

  if (!source || typeof source !== "object") return null;

  const rows = Array.isArray(source.milestones)
    ? source.milestones
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.data)
        ? source.data
        : [];

  const normalizedMilestones = rows
    .map(normalizeMilestoneRow)
    .filter(Boolean)
    .sort((left, right) => left.threshold - right.threshold);

  if (normalizedMilestones.length === 0) return null;

  const rawMetricValue = readFirstDefined(source, [
    "currentMetricValue",
    "current_metric_value",
    "metricValue",
    "metric_value",
    "currentValue",
    "current_value",
    "totalFinalTickets",
    "total_final_tickets",
  ]);
  const currentMetricValue = rawMetricValue === undefined
    ? null
    : Math.max(0, Math.floor(Number(rawMetricValue) || 0));

  return {
    milestones: normalizedMilestones,
    currentMetricValue,
    metricType: String(readFirstDefined(source, ["metricType", "metric_type"]) ?? normalizedMilestones[0].metricType),
    sourceLabel: String(readFirstDefined(source, ["sourceLabel", "source_label"]) ?? "live-milestone-api"),
    sourceStatus: String(readFirstDefined(source, ["sourceStatus", "source_status", "status"]) ?? "live"),
    generatedAt: readFirstDefined(source, ["generatedAt", "generated_at"]) ?? null,
  };
}

export function getMatchesForRound(roundId) {
  return campaignMatches.filter((match) => match.roundId === roundId);
}

export function getRoundById(roundId) {
  return roundDefinitions.find((round) => round.id === roundId) ?? roundDefinitions[0];
}

export function getMatchById(matchId) {
  return campaignMatches.find((match) => match.id === matchId) ?? campaignMatches[0];
}

export function summarizeRoundDraw(round, allocations) {
  const matches = getMatchesForRound(round.id);
  const officialMatches = matches.filter((match) => match.status === "official_final");
  const totalPoolEntries = Math.max(
    officialMatches.reduce((total, match) => total + (match.poolEntries || 0), 0),
    0,
  );
  const roundAllocations = allocations.filter((allocation) => allocation.roundId === round.id);

  const eligibleEntries = roundAllocations.reduce((total, allocation) => {
    const match = matches.find((entry) => entry.id === allocation.matchId);
    if (match?.status !== "official_final" || allocation.teamId !== match.advancingTeamId) return total;
    return total + allocation.tickets * round.multiplier;
  }, 0);

  const lostEntries = roundAllocations.reduce((total, allocation) => {
    const match = matches.find((entry) => entry.id === allocation.matchId);
    if (match?.status !== "official_final" || allocation.teamId === match.advancingTeamId) return total;
    return total + allocation.tickets;
  }, 0);

  const pendingEntries = roundAllocations.reduce((total, allocation) => {
    const match = matches.find((entry) => entry.id === allocation.matchId);
    return match?.status === "official_final" ? total : total + allocation.tickets;
  }, 0);

  const drawStatusResolved =
    officialMatches.length === matches.length && matches.length > 0
      ? "eligible_ready"
      : eligibleEntries > 0
        ? "eligible_ready"
        : round.drawStatus;

  return {
    ...round,
    matchCount: matches.length,
    officialFinalCount: officialMatches.length,
    totalPoolEntries,
    eligibleEntries,
    lostEntries,
    pendingEntries,
    estimatedChance: estimateMultiPrizeChance(eligibleEntries, totalPoolEntries, round.prizeCount),
    drawStatusResolved,
  };
}

export function getPreviewNotice(matchAllocation, t) {
  if (!matchAllocation) return "";
  return t("data.previewNotice");
}
