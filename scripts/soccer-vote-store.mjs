import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { campaignMatches, roundDefinitions } from '../src/app/data/worldCupCampaign.js'
import {
  getSharedInsiderGrantTicketsUsed,
  getTicketBreakdownForRound,
  roundAllowsSharedInsiderGrantTickets,
} from '../src/app/data/ticketEligibility.js'
import { buildMatchResultIndex, confirmedMatchResultFor } from './soccer-match-results.mjs'
import { findLedgerEntryByAddress } from './soccer-ledger-api.mjs'

export const STATE_VERSION = 1

const matchesById = new Map(campaignMatches.map((match) => [match.id, match]))
const roundsById = new Map(roundDefinitions.map((round) => [round.id, round]))

export function nowIso() {
  return new Date().toISOString()
}

export function unixNow() {
  return Math.floor(Date.now() / 1000)
}

export function toPositiveInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

export function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

export function normalizeId(value) {
  return String(value || '').trim()
}

function getMatchCutoffTime(match) {
  const cutoffTime = Date.parse(match?.cutoffAt || '')
  return Number.isFinite(cutoffTime) ? cutoffTime : null
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

function writeJsonAtomic(path, payload) {
  ensureParent(path)
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmpPath, path)
}

function emptyState() {
  return {
    version: STATE_VERSION,
    generatedAt: null,
    updatedAt: null,
    allocations: [],
    eventCount: 0,
  }
}

export function readVoteState(statePath) {
  if (!existsSync(statePath)) return emptyState()
  const payload = JSON.parse(readFileSync(statePath, 'utf8'))
  return {
    ...emptyState(),
    ...payload,
    allocations: Array.isArray(payload.allocations) ? payload.allocations : [],
    eventCount: toPositiveInteger(payload.eventCount),
  }
}

export function writeVoteState(statePath, state) {
  const normalized = {
    ...state,
    version: STATE_VERSION,
    generatedAt: state.generatedAt || nowIso(),
    updatedAt: nowIso(),
    allocations: Array.isArray(state.allocations) ? state.allocations : [],
    eventCount: toPositiveInteger(state.eventCount),
  }
  writeJsonAtomic(statePath, normalized)
  return normalized
}

export function writeVotePreview(previewPath, state, options = {}) {
  if (!previewPath) return null
  const preview = buildVotePreview(state, options)
  writeJsonAtomic(previewPath, preview)
  return preview
}

function appendVoteEvent(eventsPath, event) {
  ensureParent(eventsPath)
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`)
}

export function allocationKey({ walletAddress, roundId, matchId, teamId }) {
  return `${walletAddress}:${roundId}:${matchId}:${teamId}`
}

export function allocationId({ walletAddress, matchId, teamId }) {
  return `${walletAddress}-${matchId}-${teamId}`
}

export function normalizeAllocation(row) {
  const walletAddress = normalizeAddress(row?.walletAddress)
  const roundId = normalizeId(row?.roundId)
  const matchId = normalizeId(row?.matchId)
  const teamId = normalizeId(row?.teamId)
  const tickets = toPositiveInteger(row?.tickets)
  if (!walletAddress || !roundId || !matchId || !teamId || tickets <= 0) return null

  return {
    id: String(row.id || allocationId({ walletAddress, matchId, teamId })),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets,
    source: String(row.source || 'server-vote-store'),
    official: Boolean(row.official),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}

export function normalizeStateAllocations(state) {
  return (Array.isArray(state.allocations) ? state.allocations : []).map(normalizeAllocation).filter(Boolean)
}

export function assertVoteInput(input, options = {}) {
  const walletAddress = normalizeAddress(input?.walletAddress)
  const roundId = normalizeId(input?.roundId)
  const matchId = normalizeId(input?.matchId)
  const teamId = normalizeId(input?.teamId)
  const tickets = toPositiveInteger(input?.tickets)
  const resultIndex = options.resultIndex || buildMatchResultIndex(options.matchResults)

  if (!walletAddress) throw Object.assign(new Error('walletAddress must be a valid 0x address.'), { statusCode: 400 })
  if (!roundId || !roundsById.has(roundId)) throw Object.assign(new Error('roundId is invalid.'), { statusCode: 400 })
  if (!matchId || !matchesById.has(matchId)) throw Object.assign(new Error('matchId is invalid.'), { statusCode: 400 })
  if (!teamId) throw Object.assign(new Error('teamId is required.'), { statusCode: 400 })
  if (tickets <= 0) throw Object.assign(new Error('tickets must be a positive integer.'), { statusCode: 400 })

  const match = matchesById.get(matchId)
  if (match.roundId !== roundId) {
    throw Object.assign(new Error('matchId does not belong to roundId.'), { statusCode: 400 })
  }
  if (!match.teams.includes(teamId)) {
    throw Object.assign(new Error('teamId is not in this match.'), { statusCode: 400 })
  }
  if (match.status === 'official_final' || confirmedMatchResultFor(resultIndex, matchId)) {
    throw Object.assign(new Error('This match already has a backend-confirmed official result.'), { statusCode: 409 })
  }

  const cutoffTime = getMatchCutoffTime(match)
  if (cutoffTime !== null && Date.now() >= cutoffTime) {
    throw Object.assign(new Error('This match closed one hour before kickoff and is not accepting votes.'), { statusCode: 409 })
  }

  return { walletAddress, roundId, matchId, teamId, tickets, match }
}

export function roundTicketsUsedByWallet(allocations, walletAddress, roundId, exceptKey = '') {
  return allocations.reduce((total, allocation) => {
    if (allocation.walletAddress !== walletAddress || allocation.roundId !== roundId) return total
    if (exceptKey && allocationKey(allocation) === exceptKey) return total
    return total + toPositiveInteger(allocation.tickets)
  }, 0)
}

export function findLedgerTickets(ledger, walletAddress) {
  const entry = findLedgerEntryByAddress(ledger, walletAddress)
  const breakdown = getTicketBreakdownForRound(entry, '')
  return {
    entry,
    rawTickets: breakdown.rawTickets,
    carryoverTickets: breakdown.carryoverTickets,
    insiderPracticeTickets: breakdown.insiderPracticeTickets,
    insiderGrantTickets: breakdown.insiderGrantTickets,
    finalTickets: breakdown.finalTickets,
    totalTickets: breakdown.totalTickets,
  }
}

export function findRoundLedgerTickets(ledger, walletAddress, roundId) {
  const ledgerTickets = findLedgerTickets(ledger, walletAddress)
  const breakdown = getTicketBreakdownForRound(ledgerTickets.entry, roundId)
  return {
    ...ledgerTickets,
    ...breakdown,
  }
}

export function submitVote({ statePath, eventsPath, previewPath, ledger, input, matchResults = null }) {
  const resultIndex = buildMatchResultIndex(matchResults)
  const normalizedInput = assertVoteInput(input, { resultIndex })
  const { walletAddress, roundId, matchId, teamId, tickets } = normalizedInput
  const state = readVoteState(statePath)
  const allocations = normalizeStateAllocations(state)
  const key = allocationKey({ walletAddress, roundId, matchId, teamId })
  const existingIndex = allocations.findIndex((allocation) => allocationKey(allocation) === key)
  const ledgerTickets = findRoundLedgerTickets(ledger, walletAddress, roundId)

  if (!ledgerTickets.entry) {
    throw Object.assign(new Error('Wallet is not in the ticket ledger.'), { statusCode: 403 })
  }

  const usedOutsideCurrentTeam = roundTicketsUsedByWallet(allocations, walletAddress, roundId, key)
  const currentTeamTickets = existingIndex >= 0 ? allocations[existingIndex].tickets : 0
  const nextTeamTickets = currentTeamTickets + tickets
  const nextRoundTickets = usedOutsideCurrentTeam + nextTeamTickets

  if (nextRoundTickets > ledgerTickets.usableTickets) {
    throw Object.assign(new Error('Vote amount exceeds available tickets for this round.'), {
      statusCode: 409,
      availableTickets: Math.max(0, ledgerTickets.usableTickets - usedOutsideCurrentTeam - currentTeamTickets),
      lockedRawTickets: ledgerTickets.lockedRawTickets,
      lockedCarryoverTickets: ledgerTickets.lockedCarryoverTickets,
      lockedInsiderPracticeTickets: ledgerTickets.lockedInsiderPracticeTickets,
      lockedInsiderGrantTickets: ledgerTickets.lockedInsiderGrantTickets,
    })
  }

  const sharedInsiderGrantTicketsUsed = roundAllowsSharedInsiderGrantTickets(roundId)
    ? getSharedInsiderGrantTicketsUsed(allocations, walletAddress, ledgerTickets.entry, {
      overrideRoundId: roundId,
      overrideRoundTickets: nextRoundTickets,
    })
    : 0

  if (sharedInsiderGrantTicketsUsed > ledgerTickets.insiderGrantTickets) {
    const usedOutsideThisRound = getSharedInsiderGrantTicketsUsed(allocations, walletAddress, ledgerTickets.entry, {
      excludeRoundId: roundId,
    })
    throw Object.assign(new Error('Vote amount exceeds shared insider reward tickets.'), {
      statusCode: 409,
      availableTickets: Math.max(
        0,
        ledgerTickets.baseTickets
          + Math.max(0, ledgerTickets.insiderGrantTickets - usedOutsideThisRound)
          - usedOutsideCurrentTeam
          - currentTeamTickets,
      ),
      sharedInsiderGrantTickets: ledgerTickets.insiderGrantTickets,
      sharedInsiderGrantTicketsUsed: usedOutsideThisRound,
    })
  }

  const event = {
    id: randomUUID(),
    type: 'vote-submitted',
    status: 'accepted',
    createdAt: nowIso(),
    createdAtUnix: unixNow(),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets,
    previousTeamTickets: currentTeamTickets,
    nextTeamTickets,
    previousMatchTickets: currentTeamTickets,
    nextMatchTickets: nextTeamTickets,
    finalRoundTickets: ledgerTickets.usableTickets,
    rawRoundTickets: ledgerTickets.rawTickets,
    lockedRawTickets: ledgerTickets.lockedRawTickets,
    carryoverRoundTickets: ledgerTickets.carryoverUnlocked ? ledgerTickets.carryoverTickets : 0,
    lockedCarryoverTickets: ledgerTickets.lockedCarryoverTickets,
    insiderPracticeRoundTickets: ledgerTickets.usableInsiderPracticeTickets,
    insiderGrantRoundTickets: ledgerTickets.usableInsiderGrantTickets,
    lockedInsiderPracticeTickets: ledgerTickets.lockedInsiderPracticeTickets,
    lockedInsiderGrantTickets: ledgerTickets.lockedInsiderGrantTickets,
    sharedInsiderGrantTickets: ledgerTickets.insiderGrantTickets,
    sharedInsiderGrantTicketsUsed,
    sharedInsiderGrantTicketsRemaining: Math.max(0, ledgerTickets.insiderGrantTickets - sharedInsiderGrantTicketsUsed),
    requestId: normalizeId(input?.requestId) || null,
  }

  appendVoteEvent(eventsPath, event)

  const updatedAllocation = {
    id: allocationId({ walletAddress, matchId, teamId }),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets: nextTeamTickets,
    source: 'server-vote-store',
    official: false,
    createdAt: existingIndex >= 0 ? allocations[existingIndex].createdAt : event.createdAt,
    updatedAt: event.createdAt,
  }

  if (existingIndex >= 0) {
    allocations[existingIndex] = updatedAllocation
  } else {
    allocations.push(updatedAllocation)
  }

  const nextState = writeVoteState(statePath, {
    ...state,
    generatedAt: state.generatedAt || event.createdAt,
    allocations,
    eventCount: toPositiveInteger(state.eventCount) + 1,
  })
  const preview = writeVotePreview(previewPath, nextState, { matchResults })

  return {
    event,
    allocation: updatedAllocation,
    state: nextState,
    preview,
  }
}

function buildOutcomes(allocations, resultIndex) {
  return allocations.map((allocation) => {
    const matchResult = confirmedMatchResultFor(resultIndex, allocation.matchId)
    const result = matchResult
      ? allocation.teamId === matchResult.winnerTeamId
        ? 'won'
        : 'lost'
      : 'pending'

    return {
      id: `${allocation.id}-outcome`,
      allocationId: allocation.id,
      walletAddress: allocation.walletAddress,
      roundId: allocation.roundId,
      matchId: allocation.matchId,
      teamId: allocation.teamId,
      tickets: allocation.tickets,
      result,
      lostTickets: result === 'lost' ? allocation.tickets : 0,
      official: Boolean(matchResult),
      resultSourceStatus: matchResult?.resultStatus || 'pending',
      resultSourceUrl: matchResult?.sourceUrl || null,
      resultFetchedAt: matchResult?.fetchedAt || null,
      winnerTeamId: matchResult?.winnerTeamId || null,
    }
  })
}

function buildRoundSummaries(outcomes, resultIndex) {
  const summaries = new Map()
  for (const round of roundDefinitions) {
    const roundMatches = campaignMatches.filter((match) => match.roundId === round.id)
    summaries.set(round.id, {
      roundId: round.id,
      matchCount: roundMatches.length,
      officialFinalCount: roundMatches.filter((match) => confirmedMatchResultFor(resultIndex, match.id)).length,
      submittedTickets: 0,
      settledTickets: 0,
      wonTickets: 0,
      lostTickets: 0,
      pendingTickets: 0,
    })
  }

  for (const outcome of outcomes) {
    const summary = summaries.get(outcome.roundId) || {
      roundId: outcome.roundId,
      matchCount: 0,
      officialFinalCount: 0,
      submittedTickets: 0,
      settledTickets: 0,
      wonTickets: 0,
      lostTickets: 0,
      pendingTickets: 0,
    }
    summary.submittedTickets += outcome.tickets
    if (outcome.result !== 'pending') summary.settledTickets += outcome.tickets
    if (outcome.result === 'won') summary.wonTickets += outcome.tickets
    if (outcome.result === 'lost') summary.lostTickets += outcome.lostTickets
    summary.pendingTickets = Math.max(0, summary.submittedTickets - summary.settledTickets)
    summaries.set(outcome.roundId, summary)
  }

  return Array.from(summaries.values()).filter((summary) => summary.submittedTickets > 0)
}

export function buildVotePreview(state, options = {}) {
  const allocations = normalizeStateAllocations(state)
  const resultIndex = options.resultIndex || buildMatchResultIndex(options.matchResults)
  const filteredAllocations = options.walletAddress
    ? allocations.filter((allocation) => allocation.walletAddress === normalizeAddress(options.walletAddress))
    : allocations
  const outcomes = buildOutcomes(filteredAllocations, resultIndex)

  return {
    sourceLabel: state.sourceLabel || 'server-vote-store',
    sourceStatus: state.sourceStatus || 'live',
    generatedAt: nowIso(),
    eventCount: toPositiveInteger(state.eventCount),
    allocations: filteredAllocations,
    outcomes,
    roundSummaries: buildRoundSummaries(outcomes, resultIndex),
    matchResults: {
      sourceLabel: options.matchResults?.sourceLabel || null,
      sourceStatus: options.matchResults?.sourceStatus || 'missing',
      generatedAt: options.matchResults?.generatedAt || null,
      hash: options.matchResults?.hash || null,
    },
  }
}

export function readVotePreview({ statePath, walletAddress = '', matchResults = null }) {
  return buildVotePreview(readVoteState(statePath), { walletAddress, matchResults })
}
