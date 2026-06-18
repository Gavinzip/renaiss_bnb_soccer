import { readFileSync, statSync } from 'node:fs'

export const SUMMARY_LEADERBOARD_LIMIT = 10
export const DEFAULT_ENTRY_INTERVAL_LIMIT = 0
export const MAX_ENTRY_INTERVAL_LIMIT = 240

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
