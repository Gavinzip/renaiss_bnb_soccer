const emptyPreviewVoteData = {
  allocations: [],
  outcomes: [],
  roundSummaries: [],
  sourceLabel: "empty",
  sourceStatus: "empty",
  generatedAt: null,
};

function normalizeTickets(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeAllocation(row, index) {
  if (!row || typeof row !== "object") return null;
  const walletAddress = String(row.walletAddress ?? row.wallet_address ?? "").trim();
  const roundId = String(row.roundId ?? row.round_id ?? "").trim();
  const matchId = String(row.matchId ?? row.match_id ?? "").trim();
  const teamId = String(row.teamId ?? row.team_id ?? "").trim();
  const tickets = normalizeTickets(row.tickets);

  if (!walletAddress || !roundId || !matchId || !teamId || tickets <= 0) return null;

  return {
    id: String(row.id ?? `${walletAddress}-${matchId}-${teamId}-${index}`),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets,
    source: String(row.source ?? "preview-vote-api"),
    official: Boolean(row.official),
  };
}

function normalizeOutcome(row, index) {
  if (!row || typeof row !== "object") return null;
  const walletAddress = String(row.walletAddress ?? row.wallet_address ?? "").trim();
  const roundId = String(row.roundId ?? row.round_id ?? "").trim();
  const matchId = String(row.matchId ?? row.match_id ?? "").trim();
  const teamId = String(row.teamId ?? row.team_id ?? "").trim();
  const tickets = normalizeTickets(row.tickets);
  const result = String(row.result ?? row.status ?? "pending").trim();

  if (!walletAddress || !roundId || !matchId || !teamId || tickets <= 0) return null;

  return {
    id: String(row.id ?? `${walletAddress}-${matchId}-${teamId}-outcome-${index}`),
    allocationId: String(row.allocationId ?? row.allocation_id ?? ""),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets,
    result: ["won", "lost", "pending"].includes(result) ? result : "pending",
    lostTickets: normalizeTickets(row.lostTickets ?? row.lost_tickets),
  };
}

function normalizeRoundSummary(row) {
  if (!row || typeof row !== "object") return null;
  const roundId = String(row.roundId ?? row.round_id ?? "").trim();
  if (!roundId) return null;

  return {
    roundId,
    submittedTickets: normalizeTickets(row.submittedTickets ?? row.submitted_tickets),
    settledTickets: normalizeTickets(row.settledTickets ?? row.settled_tickets),
    wonTickets: normalizeTickets(row.wonTickets ?? row.won_tickets),
    lostTickets: normalizeTickets(row.lostTickets ?? row.lost_tickets),
  };
}

export function normalizePreviewVotePayload(payload) {
  if (!payload || typeof payload !== "object") return emptyPreviewVoteData;

  return {
    allocations: Array.isArray(payload.allocations)
      ? payload.allocations.map(normalizeAllocation).filter(Boolean)
      : [],
    outcomes: Array.isArray(payload.outcomes)
      ? payload.outcomes.map(normalizeOutcome).filter(Boolean)
      : [],
    roundSummaries: Array.isArray(payload.roundSummaries ?? payload.round_summaries)
      ? (payload.roundSummaries ?? payload.round_summaries).map(normalizeRoundSummary).filter(Boolean)
      : [],
    sourceLabel: String(payload.sourceLabel ?? payload.source_label ?? "preview-vote-api"),
    sourceStatus: String(payload.sourceStatus ?? payload.source_status ?? "preview"),
    generatedAt: payload.generatedAt ?? payload.generated_at ?? null,
  };
}

export function getEmptyPreviewVoteData() {
  return emptyPreviewVoteData;
}

export function getRoundOutcomeSummary(previewVoteData, roundId) {
  return previewVoteData?.roundSummaries?.find((entry) => entry.roundId === roundId) ?? {
    roundId,
    submittedTickets: 0,
    settledTickets: 0,
    wonTickets: 0,
    lostTickets: 0,
  };
}
