import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { toTicketInteger } from '../src/app/data/ticketEligibility.js'
import { stableStringify } from './lucky-draw/utils.mjs'

export const SUMMARY_LEADERBOARD_LIMIT = 10
export const DEFAULT_ENTRY_INTERVAL_LIMIT = 0
export const MAX_ENTRY_INTERVAL_LIMIT = 240
export const DEFAULT_TICKET_LOOKUP_LIMIT = 100
export const MAX_TICKET_LOOKUP_LIMIT = 500

let ledgerCache = {
  ledger: null,
  mtimeMs: -1,
  path: '',
}

function toInteger(value) {
  return toTicketInteger(value)
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function entryAddresses(entry) {
  return [
    entry?.userAddress,
    ...(Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : []),
  ].map(normalizeAddress).filter(Boolean)
}

function normalizeRangeEndpoint(start, end) {
  const normalizedStart = Math.max(1, toInteger(start))
  const normalizedEnd = Math.max(normalizedStart, toInteger(end || normalizedStart))
  return {
    start: normalizedStart,
    end: normalizedEnd,
  }
}

function rawTicketIntervals(entry) {
  if (!Array.isArray(entry?.ticketIntervals)) return entry?.ticketIntervals
  return entry.ticketIntervals.filter((interval) => interval?.namespace !== 'bonus' && interval?.source !== 'sbt-bonus')
}

export function normalizeFootballLedgerEntry(entry) {
  const carryoverTickets = toInteger(entry?.carryoverTickets ?? entry?.carryover_tickets)
  const insiderPracticeTickets = toInteger(entry?.insiderPracticeTickets ?? entry?.insider_practice_tickets)
  const insiderGrantTickets = toInteger(entry?.insiderGrantTickets ?? entry?.insider_grant_tickets)
  const fallbackFinalTickets = toInteger(entry?.finalTickets ?? entry?.final_tickets)
  const rawTickets = toInteger(
    entry?.rawTickets ?? entry?.raw_tickets ?? Math.max(0, fallbackFinalTickets - carryoverTickets),
  )
  const finalTickets = Math.max(fallbackFinalTickets, rawTickets + carryoverTickets)
  const totalVotingTickets = rawTickets + carryoverTickets + insiderPracticeTickets + insiderGrantTickets
  const ticketIntervals = rawTicketIntervals(entry)
  const ranges = Array.isArray(ticketIntervals)
    ? ticketIntervals.filter((range) => toInteger(range?.end) >= toInteger(range?.start))
    : []

  return {
    ...entry,
    rawTickets,
    bonusTickets: 0,
    carryoverTickets,
    insiderPracticeTickets,
    insiderGrantTickets,
    finalTickets,
    totalVotingTickets,
    sbt: 'none',
    sbtMultiplier: 1,
    ticketIntervals,
    ticketStart: ranges.length ? Math.min(...ranges.map((range) => toInteger(range.start))) : null,
    ticketEnd: ranges.length ? Math.max(...ranges.map((range) => toInteger(range.end))) : null,
  }
}

function sortLedgerEntries(entries) {
  return entries
    .filter(
      (entry) =>
        toInteger(entry.finalTickets)
          + toInteger(entry.insiderPracticeTickets)
          + toInteger(entry.insiderGrantTickets)
          > 0,
    )
    .sort((left, right) => {
      if (left.finalTickets !== right.finalTickets) return right.finalTickets - left.finalTickets
      if (left.rawTickets !== right.rawTickets) return right.rawTickets - left.rawTickets
      if ((left.totalVotingTickets || 0) !== (right.totalVotingTickets || 0)) {
        return (right.totalVotingTickets || 0) - (left.totalVotingTickets || 0)
      }
      const leftTs = left.firstBuybackAt || Number.MAX_SAFE_INTEGER
      const rightTs = right.firstBuybackAt || Number.MAX_SAFE_INTEGER
      if (leftTs !== rightTs) return leftTs - rightTs
      return String(left.userAddress || '').localeCompare(String(right.userAddress || ''))
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

function normalizedLedgerHash(ledger, entries, totals) {
  const payload = {
    campaignStart: toInteger(ledger.campaignStart),
    campaignEnd: toInteger(ledger.campaignEnd),
    source: ledger.source ?? null,
    bonusShuffleVersion: null,
    bonusShuffleSeed: null,
    totalRawTickets: totals.totalRawTickets,
    totalBonusTickets: 0,
    totalCarryoverTickets: totals.totalCarryoverTickets,
    totalInsiderPracticeTickets: totals.totalInsiderPracticeTickets,
    totalInsiderGrantTickets: totals.totalInsiderGrantTickets,
    totalFinalTickets: totals.totalFinalTickets,
    totalVotingTickets: totals.totalVotingTickets,
    entries: entries.map((entry) => ({
      userAddress: entry.userAddress,
      finalTickets: entry.finalTickets,
      insiderPracticeTickets: entry.insiderPracticeTickets,
      insiderGrantTickets: entry.insiderGrantTickets,
      totalVotingTickets: entry.totalVotingTickets,
      ticketIntervals: entry.ticketIntervals,
    })),
  }

  return `0x${createHash('sha256').update(stableStringify(payload)).digest('hex')}`
}

export function normalizeFootballLedger(ledger) {
  if (!ledger || typeof ledger !== 'object') return ledger

  const entries = Array.isArray(ledger.entries)
    ? sortLedgerEntries(ledger.entries.map(normalizeFootballLedgerEntry))
    : []
  if (entries.length === 0) return ledger

  const totalRawTickets = entries.reduce((sum, entry) => sum + toInteger(entry.rawTickets), 0)
  const totalCarryoverTickets = entries.reduce((sum, entry) => sum + toInteger(entry.carryoverTickets), 0)
  const totalInsiderPracticeTickets = entries.reduce((sum, entry) => sum + toInteger(entry.insiderPracticeTickets), 0)
  const totalInsiderGrantTickets = entries.reduce((sum, entry) => sum + toInteger(entry.insiderGrantTickets), 0)
  const totalFinalTickets = totalRawTickets + totalCarryoverTickets
  const totalVotingTickets = totalFinalTickets + totalInsiderPracticeTickets + totalInsiderGrantTickets
  const noBonusNote = 'This football campaign does not apply SBT ticket bonuses; final tickets equal raw buyback plus carryover tickets.'
  const notes = Array.isArray(ledger.notes) ? [...ledger.notes] : []
  if (!notes.includes(noBonusNote)) notes.push(noBonusNote)

  return {
    ...ledger,
    entries,
    totalEntries: entries.length,
    totalRawTickets,
    totalBonusTickets: 0,
    totalCarryoverTickets,
    totalInsiderPracticeTickets,
    totalInsiderGrantTickets,
    totalFinalTickets,
    totalVotingTickets,
    bonusShuffleVersion: null,
    bonusShuffleSeed: null,
    bonusShuffleLocked: false,
    bonusShuffleLockedAt: null,
    ledgerHash: normalizedLedgerHash(ledger, entries, {
      totalRawTickets,
      totalCarryoverTickets,
      totalInsiderPracticeTickets,
      totalInsiderGrantTickets,
      totalFinalTickets,
      totalVotingTickets,
    }),
    notes,
  }
}

export function readLedgerPayload(ledgerPath) {
  const stat = statSync(ledgerPath)
  if (ledgerCache.ledger && ledgerCache.path === ledgerPath && ledgerCache.mtimeMs === stat.mtimeMs) {
    return ledgerCache.ledger
  }

  const ledger = normalizeFootballLedger(JSON.parse(readFileSync(ledgerPath, 'utf8')))
  ledgerCache = {
    ledger,
    mtimeMs: stat.mtimeMs,
    path: ledgerPath,
  }
  return ledger
}

function buildLeaderboardEntries(ledger, limit) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  return entries.slice(0, limit).map((entry, index) => ({
    rank: toInteger(entry.rank || index + 1),
    userAddress: entry.userAddress || '',
    sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
    packs: entry.packs && typeof entry.packs === 'object' ? entry.packs : {},
    rawTickets: toInteger(entry.rawTickets),
    bonusTickets: toInteger(entry.bonusTickets),
    carryoverTickets: toInteger(entry.carryoverTickets),
    insiderPracticeTickets: toInteger(entry.insiderPracticeTickets),
    insiderGrantTickets: toInteger(entry.insiderGrantTickets),
    finalTickets: toInteger(entry.finalTickets),
    totalVotingTickets: toInteger(entry.totalVotingTickets),
    sbt: entry.sbt || 'none',
    sbtMultiplier: Number(entry.sbtMultiplier || 1),
    eventCount: toInteger(entry.eventCount),
    firstBuybackAt: toInteger(entry.firstBuybackAt),
    lastBuybackAt: toInteger(entry.lastBuybackAt),
    ticketStart: entry.ticketStart ?? null,
    ticketEnd: entry.ticketEnd ?? null,
  }))
}

export function buildLedgerSummary(ledger) {
  return {
    mode: ledger.mode,
    generatedAt: toInteger(ledger.generatedAt),
    campaignStart: toInteger(ledger.campaignStart),
    campaignEnd: toInteger(ledger.campaignEnd),
    totalEntries: toInteger(ledger.totalEntries),
    totalRawTickets: toInteger(ledger.totalRawTickets),
    totalBonusTickets: toInteger(ledger.totalBonusTickets),
    totalCarryoverTickets: toInteger(ledger.totalCarryoverTickets),
    totalInsiderPracticeTickets: toInteger(ledger.totalInsiderPracticeTickets),
    totalInsiderGrantTickets: toInteger(ledger.totalInsiderGrantTickets),
    totalFinalTickets: toInteger(ledger.totalFinalTickets),
    totalVotingTickets: toInteger(ledger.totalVotingTickets),
    sourceEntries: toInteger(ledger.sourceEntries),
    candidateSourceLimited: Boolean(ledger.candidateSourceLimited),
    ledgerHash: ledger.ledgerHash || null,
    drawContractAddress: ledger.drawContractAddress || null,
    bonusShuffleVersion: ledger.bonusShuffleVersion || null,
    bonusShuffleSeed: ledger.bonusShuffleSeed || null,
    bonusShuffleLocked: Boolean(ledger.bonusShuffleLocked),
    bonusShuffleLockedAt: toInteger(ledger.bonusShuffleLockedAt),
    packRules: Array.isArray(ledger.packRules) ? ledger.packRules : [],
    entries: [],
    leaderboardEntries: buildLeaderboardEntries(ledger, SUMMARY_LEADERBOARD_LIMIT),
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
  }
}

export function findLedgerEntry(ledger, query) {
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized || !Array.isArray(ledger.entries)) return null

  const entry = ledger.entries.find((row) => entryAddresses(row).some((address) => address.includes(normalized))) || null
  return entry ? normalizeFootballLedgerEntry(entry) : null
}

export function findLedgerEntryByAddress(ledger, address) {
  const normalized = normalizeAddress(address)
  if (!normalized || !Array.isArray(ledger.entries)) return null

  const entry = ledger.entries.find((row) => entryAddresses(row).some((entryAddress) => entryAddress === normalized)) || null
  return entry ? normalizeFootballLedgerEntry(entry) : null
}

export function parseEntryIntervalQuery(searchParams) {
  const hasLimit = searchParams.has('intervalLimit')
  const includeAll = searchParams.get('intervalLimit') === 'all'
  const includeIntervals = includeAll || searchParams.get('includeIntervals') === '1' || hasLimit
  const rawOffset = Number(searchParams.get('intervalOffset') || 0)
  const rawLimit = Number(searchParams.get('intervalLimit') || DEFAULT_ENTRY_INTERVAL_LIMIT)

  return {
    includeIntervals,
    intervalOffset: Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0,
    intervalLimit: includeAll
      ? 'all'
      : Number.isFinite(rawLimit)
        ? Math.min(MAX_ENTRY_INTERVAL_LIMIT, Math.max(0, Math.floor(rawLimit)))
        : DEFAULT_ENTRY_INTERVAL_LIMIT,
  }
}

export function parseTicketLookupQuery(searchParams) {
  const rawTicket = searchParams.get('ticket')
  const rawStart = rawTicket || searchParams.get('start') || searchParams.get('from') || '1'
  const rawEnd = rawTicket || searchParams.get('end') || searchParams.get('to') || rawStart
  const rawLimit = Number(searchParams.get('limit') || DEFAULT_TICKET_LOOKUP_LIMIT)
  const range = normalizeRangeEndpoint(rawStart, rawEnd)

  return {
    ...range,
    limit: Number.isFinite(rawLimit)
      ? Math.min(MAX_TICKET_LOOKUP_LIMIT, Math.max(1, Math.floor(rawLimit)))
      : DEFAULT_TICKET_LOOKUP_LIMIT,
  }
}

function intervalOverlap(interval, range) {
  const intervalStart = Math.max(1, toInteger(interval?.start))
  const intervalEnd = Math.max(intervalStart, toInteger(interval?.end || intervalStart))
  const start = Math.max(intervalStart, range.start)
  const end = Math.min(intervalEnd, range.end)
  if (start > end) return null

  return {
    start,
    end,
    tickets: end - start + 1,
  }
}

function buildTicketLookupHit(entry, interval, overlap) {
  return {
    userAddress: entry.userAddress || '',
    sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
    rank: toInteger(entry.rank),
    finalTickets: toInteger(entry.finalTickets),
    rawTickets: toInteger(entry.rawTickets),
    bonusTickets: toInteger(entry.bonusTickets),
    carryoverTickets: toInteger(entry.carryoverTickets),
    insiderPracticeTickets: toInteger(entry.insiderPracticeTickets),
    insiderGrantTickets: toInteger(entry.insiderGrantTickets),
    totalVotingTickets: toInteger(entry.totalVotingTickets),
    ticketStart: entry.ticketStart ?? null,
    ticketEnd: entry.ticketEnd ?? null,
    interval: {
      start: toInteger(interval.start),
      end: toInteger(interval.end),
      displayStart: interval.displayStart ?? null,
      displayEnd: interval.displayEnd ?? null,
      namespace: interval.namespace || 'raw',
      source: interval.source || null,
      pack: interval.pack || null,
      txHash: interval.txHash || null,
      timestamp: interval.timestamp ?? null,
      blockNumber: interval.blockNumber ?? null,
      ordinal: interval.ordinal ?? null,
    },
    overlap,
  }
}

export function buildTicketLookupResponse(ledger, options = {}) {
  const range = normalizeRangeEndpoint(options.start, options.end)
  const limit = Math.min(MAX_TICKET_LOOKUP_LIMIT, Math.max(1, toInteger(options.limit || DEFAULT_TICKET_LOOKUP_LIMIT)))
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  const hits = []
  let totalHits = 0

  for (const entry of entries) {
    const intervals = Array.isArray(entry.ticketIntervals) ? entry.ticketIntervals : []
    for (const interval of intervals) {
      const overlap = intervalOverlap(interval, range)
      if (!overlap) continue

      totalHits += 1
      if (hits.length < limit) hits.push(buildTicketLookupHit(entry, interval, overlap))
    }
  }

  return {
    query: {
      start: range.start,
      end: range.end,
      limit,
      totalFinalTickets: toInteger(ledger.totalFinalTickets),
      totalCarryoverTickets: toInteger(ledger.totalCarryoverTickets),
      totalInsiderPracticeTickets: toInteger(ledger.totalInsiderPracticeTickets),
      totalInsiderGrantTickets: toInteger(ledger.totalInsiderGrantTickets),
      totalVotingTickets: toInteger(ledger.totalVotingTickets),
      ledgerHash: ledger.ledgerHash || null,
      generatedAt: toInteger(ledger.generatedAt),
    },
    hits,
    hitCount: totalHits,
    returnedHitCount: hits.length,
    truncated: totalHits > hits.length,
  }
}

export function buildLedgerEntryResponse(entry, options = {}) {
  if (!entry) return null

  const allIntervals = Array.isArray(entry.ticketIntervals) ? entry.ticketIntervals : []
  const intervalCount = allIntervals.length
  const includeIntervals = Boolean(options.includeIntervals)
  const intervalOffset = includeIntervals ? Math.min(Number(options.intervalOffset || 0), intervalCount) : 0
  const intervalLimit = options.intervalLimit === 'all' ? intervalCount : Number(options.intervalLimit || DEFAULT_ENTRY_INTERVAL_LIMIT)
  const boundedLimit =
    options.intervalLimit === 'all' ? intervalCount : Math.min(MAX_ENTRY_INTERVAL_LIMIT, Math.max(0, Math.floor(intervalLimit)))
  const ticketIntervals = includeIntervals ? allIntervals.slice(intervalOffset, intervalOffset + boundedLimit) : []

  return {
    ...entry,
    ticketIntervals,
    ticketIntervalCount: intervalCount,
    ticketIntervalsOffset: intervalOffset,
    ticketIntervalsLimit: includeIntervals ? boundedLimit : 0,
    ticketIntervalsComplete: intervalOffset + ticketIntervals.length >= intervalCount,
  }
}
