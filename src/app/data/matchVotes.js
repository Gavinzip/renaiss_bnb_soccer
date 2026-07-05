export function getMatchTeamVotes(match, team) {
  const teamId = team?.id;
  const matchVotes = teamId ? match?.voteTotalsByTeamId?.[teamId] : undefined;
  const value = matchVotes ?? team?.votes ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function getMatchVoteTotal(match, teams = []) {
  return teams.reduce((total, team) => total + getMatchTeamVotes(match, team), 0);
}
