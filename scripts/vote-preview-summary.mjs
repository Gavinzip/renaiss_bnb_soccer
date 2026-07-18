import { canonicalMatchId } from './official-match-identity.mjs'

function toTicketInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

export function buildVoteTotalsPreview(preview = {}) {
  const totalsByMatchTeam = new Map()
  const walletsByMatch = new Map()

  for (const allocation of Array.isArray(preview.allocations) ? preview.allocations : []) {
    const roundId = String(allocation?.roundId || '').trim()
    const matchId = canonicalMatchId(allocation?.matchId)
    const teamId = String(allocation?.teamId || '').trim()
    const walletAddress = String(allocation?.walletAddress || '').trim().toLowerCase()
    const tickets = toTicketInteger(allocation?.tickets)
    if (!roundId || !matchId || !teamId || tickets <= 0) continue

    const totalKey = `${matchId}:${teamId}`
    const current = totalsByMatchTeam.get(totalKey) || { roundId, matchId, teamId, tickets: 0 }
    current.tickets += tickets
    totalsByMatchTeam.set(totalKey, current)

    if (walletAddress) {
      const wallets = walletsByMatch.get(matchId) || { roundId, matchId, values: new Set() }
      wallets.values.add(walletAddress)
      walletsByMatch.set(matchId, wallets)
    }
  }

  return {
    sourceLabel: String(preview.sourceLabel || 'vote-store-summary'),
    sourceStatus: String(preview.sourceStatus || 'live'),
    generatedAt: preview.generatedAt || null,
    roundSummaries: Array.isArray(preview.roundSummaries) ? preview.roundSummaries : [],
    matchTeamTotals: [...totalsByMatchTeam.values()].sort((left, right) => (
      left.matchId.localeCompare(right.matchId) || left.teamId.localeCompare(right.teamId)
    )),
    matchVoterCounts: [...walletsByMatch.values()]
      .map(({ roundId, matchId, values }) => ({ roundId, matchId, voters: values.size }))
      .sort((left, right) => left.matchId.localeCompare(right.matchId)),
  }
}
