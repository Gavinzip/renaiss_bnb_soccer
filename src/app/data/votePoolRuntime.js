import { canonicalMatchId } from "./matchIds.js";

export function buildLiveVoteStats(source) {
  const totalsByMatchTeam = new Map();
  const voterCountsByMatch = new Map();

  if (source?.sourceStatus !== "live" || source?.hasGlobalTotals !== true) {
    return { totalsByMatchTeam, voterCountsByMatch };
  }

  source.matchTeamTotals.forEach((row) => {
    const matchId = canonicalMatchId(row.matchId);
    if (!matchId || !row.teamId) return;
    totalsByMatchTeam.set(`${matchId}:${row.teamId}`, Math.max(0, Number(row.tickets) || 0));
  });

  source.matchVoterCounts.forEach((row) => {
    const matchId = canonicalMatchId(row.matchId);
    if (!matchId) return;
    voterCountsByMatch.set(matchId, Math.max(0, Number(row.voters) || 0));
  });

  return { totalsByMatchTeam, voterCountsByMatch };
}
