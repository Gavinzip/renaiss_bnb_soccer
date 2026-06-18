import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { campaignMatches, roundDefinitions } from '../src/app/data/worldCupCampaign.js'
import { findLedgerEntryByAddress } from './soccer-ledger-api.mjs'

const STATE_VERSION = 1

const matchesById = new Map(campaignMatches.map((match) => [match.id, match]))
const roundsById = new Map(roundDefinitions.map((round) => [round.id, round]))

function nowIso() {
  return new Date().toISOString()
}

function unixNow() {
  return Math.floor(Date.now() / 1000)
}

function toPositiveInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function normalizeId(value) {
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

function writeVoteState(statePath, state) {
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

function writeVotePreview(previewPath, state, options = {}) {
  if (!previewPath) return null
  const preview = buildVotePreview(state, options)
  writeJsonAtomic(previewPath, preview)
  return preview
}

function appendVoteEvent(eventsPath, event) {
  ensureParent(eventsPath)
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`)
}

function allocationKey({ walletAddress, roundId, matchId, teamId }) {
  return `${walletAddress}:${roundId}:${matchId}:${teamId}`
}

function allocationId({ walletAddress, matchId, teamId }) {
  return `${walletAddress}-${matchId}-${teamId}`
}

function normalizeAllocation(row) {
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

function normalizeStateAllocations(state) {
  return (Array.isArray(state.allocations) ? state.allocations : []).map(normalizeAllocation).filter(Boolean)
}

function assertVoteInput(input) {
  const walletAddress = normalizeAddress(input?.walletAddress)
  const roundId = normalizeId(input?.roundId)
  const matchId = normalizeId(input?.matchId)
  const teamId = normalizeId(input?.teamId)
  const tickets = toPositiveInteger(input?.tickets)

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
  if (!['open', 'closing_soon'].includes(match.status)) {
    throw Object.assign(new Error('This match is not accepting votes.'), { statusCode: 409 })
  }

  const cutoffTime = getMatchCutoffTime(match)
  if (cutoffTime !== null && Date.now() >= cutoffTime) {
    throw Object.assign(new Error('This match closed one hour before kickoff and is not accepting votes.'), { statusCode: 409 })
  }

  return { walletAddress, roundId, matchId, teamId, tickets, match }
}

function roundTicketsUsedByWallet(allocations, walletAddress, roundId, exceptKey = '') {
  return allocations.reduce((total, allocation) => {
    if (allocation.walletAddress !== walletAddress || allocation.roundId !== roundId) return total
    if (exceptKey && allocationKey(allocation) === exceptKey) return total
    return total + toPositiveInteger(allocation.tickets)
  }, 0)
}

function findLedgerTickets(ledger, walletAddress) {
  const entry = findLedgerEntryByAddress(ledger, walletAddress)
  return {
    entry,
    finalTickets: toPositiveInteger(entry?.finalTickets),
  }
}

export function submitVote({ statePath, eventsPath, previewPath, ledger, input }) {
  const normalizedInput = assertVoteInput(input)
  const { walletAddress, roundId, matchId, teamId, tickets } = normalizedInput
  const state = readVoteState(statePath)
  const allocations = normalizeStateAllocations(state)
  const key = allocationKey({ walletAddress, roundId, matchId, teamId })
  const existingIndex = allocations.findIndex((allocation) => allocationKey(allocation) === key)
  const ledgerTickets = findLedgerTickets(ledger, walletAddress)

  if (!ledgerTickets.entry) {
    throw Object.assign(new Error('Wallet is not in the ticket ledger.'), { statusCode: 403 })
  }

  const usedOutsideCurrentTeam = roundTicketsUsedByWallet(allocations, walletAddress, roundId, key)
  const currentTeamTickets = existingIndex >= 0 ? allocations[existingIndex].tickets : 0
  const nextTeamTickets = currentTeamTickets + tickets
  const nextRoundTickets = usedOutsideCurrentTeam + nextTeamTickets

  if (nextRoundTickets > ledgerTickets.finalTickets) {
    throw Object.assign(new Error('Vote amount exceeds available tickets for this round.'), {
      statusCode: 409,
      availableTickets: Math.max(0, ledgerTickets.finalTickets - usedOutsideCurrentTeam - currentTeamTickets),
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
    finalRoundTickets: ledgerTickets.finalTickets,
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
  const preview = writeVotePreview(previewPath, nextState)

  return {
    event,
    allocation: updatedAllocation,
    state: nextState,
    preview,
  }
}

function buildOutcomes(allocations) {
  return allocations.map((allocation) => {
    const match = matchesById.get(allocation.matchId)
    const result =
      match?.status === 'official_final' && match.advancingTeamId
        ? allocation.teamId === match.advancingTeamId
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
    }
  })
}

function buildRoundSummaries(outcomes) {
  const summaries = new Map()
  for (const round of roundDefinitions) {
    summaries.set(round.id, {
      roundId: round.id,
      submittedTickets: 0,
      settledTickets: 0,
      wonTickets: 0,
      lostTickets: 0,
    })
  }

  for (const outcome of outcomes) {
    const summary = summaries.get(outcome.roundId) || {
      roundId: outcome.roundId,
      submittedTickets: 0,
      settledTickets: 0,
      wonTickets: 0,
      lostTickets: 0,
    }
    summary.submittedTickets += outcome.tickets
    if (outcome.result !== 'pending') summary.settledTickets += outcome.tickets
    if (outcome.result === 'won') summary.wonTickets += outcome.tickets
    if (outcome.result === 'lost') summary.lostTickets += outcome.lostTickets
    summaries.set(outcome.roundId, summary)
  }

  return Array.from(summaries.values()).filter((summary) => summary.submittedTickets > 0)
}

export function buildVotePreview(state, options = {}) {
  const allocations = normalizeStateAllocations(state)
  const filteredAllocations = options.walletAddress
    ? allocations.filter((allocation) => allocation.walletAddress === normalizeAddress(options.walletAddress))
    : allocations
  const outcomes = buildOutcomes(filteredAllocations)

  return {
    sourceLabel: 'server-vote-store',
    sourceStatus: 'live',
    generatedAt: nowIso(),
    eventCount: toPositiveInteger(state.eventCount),
    allocations: filteredAllocations,
    outcomes,
    roundSummaries: buildRoundSummaries(outcomes),
  }
}

export function readVotePreview({ statePath, walletAddress = '' }) {
  return buildVotePreview(readVoteState(statePath), { walletAddress })
}
