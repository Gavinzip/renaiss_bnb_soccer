import { readFileSync, statSync } from 'node:fs'

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
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
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

export function readLedgerPayload(ledgerPath) {
  const stat = statSync(ledgerPath)
  if (ledgerCache.ledger && ledgerCache.path === ledgerPath && ledgerCache.mtimeMs === stat.mtimeMs) {
    return ledgerCache.ledger
  }

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
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
    finalTickets: toInteger(entry.finalTickets),
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
    totalFinalTickets: toInteger(ledger.totalFinalTickets),
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

  return (
    ledger.entries.find((entry) => entryAddresses(entry).some((address) => address.includes(normalized))) || null
  )
}

export function findLedgerEntryByAddress(ledger, address) {
  const normalized = normalizeAddress(address)
  if (!normalized || !Array.isArray(ledger.entries)) return null

  return (
    ledger.entries.find((entry) => entryAddresses(entry).some((entryAddress) => entryAddress === normalized)) || null
  )
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
