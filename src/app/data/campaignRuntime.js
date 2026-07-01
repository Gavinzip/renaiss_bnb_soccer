import { verifiedLedgerSnapshot } from "./ticketLedgerSnapshot";
import { campaignMatches, roundDefinitions } from "./worldCupCampaign";
import { estimateMultiPrizeChance } from "./ticketMath";
import { toTicketInteger } from "./ticketEligibility";

export const DEFAULT_VIEW_ID = "home";
export const DEFAULT_ROUND_ID = "round32";
export const DEFAULT_MATCH_ID = "m57";
export const DEFAULT_TICKET_AMOUNT = 12;

export const commandViews = [
  { id: "home" },
  { id: "schedule" },
  { id: "vote" },
  { id: "draw" },
  { id: "winners" },
];

function toLedgerTickets(value) {
  return toTicketInteger(value);
}

export function normalizeFootballLedgerEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;

  const carryoverTickets = toLedgerTickets(entry.carryoverTickets ?? entry.carryover_tickets);
  const insiderPracticeTickets = toLedgerTickets(entry.insiderPracticeTickets ?? entry.insider_practice_tickets);
  const insiderGrantTickets = toLedgerTickets(entry.insiderGrantTickets ?? entry.insider_grant_tickets);
  const fallbackFinalTickets = toLedgerTickets(entry.finalTickets ?? entry.final_tickets);
  const rawTickets = toLedgerTickets(
    entry.rawTickets ?? entry.raw_tickets ?? Math.max(0, fallbackFinalTickets - carryoverTickets),
  );
  const finalTickets = Math.max(fallbackFinalTickets, rawTickets + carryoverTickets);
  const totalVotingTickets = rawTickets + carryoverTickets + insiderPracticeTickets + insiderGrantTickets;
  const ticketIntervals = Array.isArray(entry.ticketIntervals)
    ? entry.ticketIntervals.filter((interval) => interval?.namespace !== "bonus" && interval?.source !== "sbt-bonus")
    : entry.ticketIntervals;

  return {
    ...entry,
    rawTickets,
    bonusTickets: 0,
    carryoverTickets,
    insiderPracticeTickets,
    insiderGrantTickets,
    finalTickets,
    totalVotingTickets,
    sbt: "none",
    sbtMultiplier: 1,
    ticketIntervals,
  };
}

export function normalizeFootballLedger(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const leaderboardEntries = Array.isArray(payload.leaderboardEntries)
    ? payload.leaderboardEntries.map(normalizeFootballLedgerEntry)
    : payload.leaderboardEntries;
  const entries = Array.isArray(payload.entries)
    ? payload.entries.map(normalizeFootballLedgerEntry)
    : payload.entries;
  const rawTotal = toLedgerTickets(payload.totalRawTickets ?? payload.total_raw_tickets);
  const carryoverTotal = toLedgerTickets(payload.totalCarryoverTickets ?? payload.total_carryover_tickets);
  const insiderPracticeTotal = toLedgerTickets(payload.totalInsiderPracticeTickets ?? payload.total_insider_practice_tickets);
  const insiderGrantTotal = toLedgerTickets(payload.totalInsiderGrantTickets ?? payload.total_insider_grant_tickets);
  const totalFinalTickets = rawTotal + carryoverTotal || (Array.isArray(leaderboardEntries)
    ? leaderboardEntries.reduce((sum, entry) => sum + toLedgerTickets(entry?.finalTickets), 0)
    : toLedgerTickets(payload.totalFinalTickets ?? payload.total_final_tickets));
  const totalVotingTickets = totalFinalTickets + insiderPracticeTotal + insiderGrantTotal;

  return {
    ...payload,
    leaderboardEntries,
    entries,
    totalBonusTickets: 0,
    totalCarryoverTickets: carryoverTotal,
    totalInsiderPracticeTickets: insiderPracticeTotal,
    totalInsiderGrantTickets: insiderGrantTotal,
    totalFinalTickets,
    totalVotingTickets,
    bonusShuffleVersion: null,
    bonusShuffleSeed: null,
    bonusShuffleLocked: false,
    bonusShuffleLockedAt: 0,
  };
}

export function normalizeLedgerSummary(payload) {
  if (!payload || typeof payload !== "object") return null;
  const entries = Array.isArray(payload.leaderboardEntries)
    ? payload.leaderboardEntries
    : Array.isArray(payload.entries)
      ? payload.entries.slice(0, 8)
      : [];

  if (!payload.totalFinalTickets || entries.length === 0) return null;

  return normalizeFootballLedger({
    ...verifiedLedgerSnapshot,
    ...payload,
    sourceLabel: payload.sourceLabel || "live-ledger-api",
    packRules: Array.isArray(payload.packRules) && payload.packRules.length > 0
      ? payload.packRules
      : verifiedLedgerSnapshot.packRules,
    leaderboardEntries: entries,
  });
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
    "totalRawTickets",
    "total_raw_tickets",
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

export function summarizeRoundDraw(round, allocations, outcomeSummary = null, userOutcomeSummary = null) {
  const matches = getMatchesForRound(round.id);
  const roundAllocations = allocations.filter((allocation) => allocation.roundId === round.id);
  const submittedTickets = outcomeSummary?.submittedTickets
    ?? roundAllocations.reduce((total, allocation) => total + allocation.tickets, 0);
  const settledTickets = outcomeSummary?.settledTickets ?? 0;
  const eligibleEntries = Math.max(0, Math.floor(Number(outcomeSummary?.wonTickets ?? 0) || 0)) * round.multiplier;
  const pendingEntries = outcomeSummary?.pendingTickets ?? Math.max(0, submittedTickets - settledTickets);
  const totalPoolEntries = Math.max(eligibleEntries + pendingEntries, eligibleEntries);
  const userEligibleEntries = Math.max(0, Math.floor(Number(userOutcomeSummary?.wonTickets ?? outcomeSummary?.wonTickets ?? 0) || 0)) * round.multiplier;
  const userLostEntries = Math.max(0, Math.floor(Number(userOutcomeSummary?.lostTickets ?? outcomeSummary?.lostTickets ?? 0) || 0));
  const userPendingEntries = Math.max(0, Math.floor(Number(userOutcomeSummary?.pendingTickets ?? outcomeSummary?.pendingTickets ?? 0) || 0));

  const drawStatusResolved =
    eligibleEntries > 0
        ? "eligible_ready"
        : round.drawStatus;

  return {
    ...round,
    matchCount: outcomeSummary?.matchCount ?? matches.length,
    officialFinalCount: outcomeSummary?.officialFinalCount ?? 0,
    totalPoolEntries,
    eligibleEntries,
    lostEntries: userLostEntries,
    pendingEntries,
    userEligibleEntries,
    userLostEntries,
    userPendingEntries,
    estimatedChance: estimateMultiPrizeChance(userEligibleEntries, totalPoolEntries, round.prizeCount),
    drawStatusResolved,
  };
}

export function getPreviewNotice(matchAllocation, t) {
  if (!matchAllocation) return "";
  return t("data.previewNotice");
}
