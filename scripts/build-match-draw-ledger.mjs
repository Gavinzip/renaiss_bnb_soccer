#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { campaignMatches, roundDefinitions } from '../src/app/data/worldCupCampaign.js'
import {
  SHARED_INSIDER_GRANT_ROUND_IDS,
  getTicketBreakdownForRound,
  roundUsesSharedVotingTicketPool,
} from '../src/app/data/ticketEligibility.js'
import { canonicalMatchId } from './official-match-identity.mjs'
import { readEnvFile, toNumber } from './lucky-draw/utils.mjs'
import { findLedgerEntryByAddress, readLedgerPayload } from './soccer-ledger-api.mjs'
import {
  buildMatchResultIndex,
  confirmedMatchResultFor,
  readMatchResultsSnapshot,
  snapshotHash,
  stableStringify,
  summarizeMatchResults,
  writeJsonAtomic,
} from './soccer-match-results.mjs'
import { readVoteState } from './soccer-vote-store.mjs'
import { readVoteStateFromSqlite } from './soccer-vote-store-sqlite.mjs'

const OUTPUT_VERSION = 1
const DRAW_LEDGER_HASH_VERSION = 'match-draw-ledger-v2'
const ROUND_DRAW_LEDGER_HASH_VERSION = 'round-draw-ledger-v2'
const DEFAULT_MATCH_PRIZE_SLOT_COUNT = 1
const DEFAULT_ALTERNATE_COUNT = 2

const roundsById = new Map(roundDefinitions.map((round) => [round.id, round]))
const roundOrder = new Map(roundDefinitions.map((round, index) => [round.id, index]))
const roundIdByMatchId = new Map(campaignMatches.map((match) => [
  canonicalMatchId(match.id),
  String(match.roundId || '').trim(),
]))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function parseArgs(argv) {
  const args = {
    envFile: '',
    baseLedgerPath: process.env.LUCKY_DRAW_BASE_LEDGER_PATH || process.env.LUCKY_DRAW_LEDGER_PATH || 'public/lucky-draw-ledger.json',
    voteStore: process.env.SOCCER_VOTE_STORE || 'json',
    voteDbPath: process.env.SOCCER_VOTE_DB_PATH || 'data/soccer/votes/vote-store.sqlite',
    voteStatePath: process.env.SOCCER_VOTE_STATE_PATH || 'data/soccer/votes/vote-state.json',
    matchResultsPath: process.env.SOCCER_MATCH_RESULTS_PATH || 'data/soccer/match-results.json',
    out: process.env.SOCCER_MATCH_DRAW_LEDGER_PATH || process.env.LUCKY_DRAW_LEDGER_PATH || 'public/lucky-draw-ledger.json',
    roundId: '',
    sourceRoundId: '',
    matchId: '',
    prizeSlotCount: 0,
    alternateCount: toNumber(process.env.SOCCER_DRAW_ALTERNATE_COUNT || DEFAULT_ALTERNATE_COUNT),
    ledgerUriBase: process.env.SOCCER_MATCH_DRAW_LEDGER_URI || process.env.LUCKY_DRAW_LEDGER_URI || '',
    lockedRoundsDir: process.env.SOCCER_MATCH_DRAW_LEDGER_LOCKED_DIR || '',
    dryRun: false,
    replaceExistingRound: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--base-ledger') args.baseLedgerPath = argv[++index] || args.baseLedgerPath
    else if (arg === '--vote-store') args.voteStore = argv[++index] || args.voteStore
    else if (arg === '--vote-db') args.voteDbPath = argv[++index] || args.voteDbPath
    else if (arg === '--vote-state') args.voteStatePath = argv[++index] || args.voteStatePath
    else if (arg === '--match-results') args.matchResultsPath = argv[++index] || args.matchResultsPath
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--round-id') args.roundId = argv[++index] || ''
    else if (arg === '--source-round-id') args.sourceRoundId = argv[++index] || ''
    else if (arg === '--match-id') args.matchId = argv[++index] || ''
    else if (arg === '--prize-slots') args.prizeSlotCount = toNumber(argv[++index] || 0)
    else if (arg === '--alternates') args.alternateCount = toNumber(argv[++index] || DEFAULT_ALTERNATE_COUNT)
    else if (arg === '--ledger-uri-base') args.ledgerUriBase = argv[++index] || ''
    else if (arg === '--locked-rounds-dir') args.lockedRoundsDir = argv[++index] || ''
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--replace-existing-round' || arg === '--force-replace-round') args.replaceExistingRound = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  if (args.envFile) {
    const envValues = readEnvFile(args.envFile)
    args.baseLedgerPath = envValues.LUCKY_DRAW_BASE_LEDGER_PATH || args.baseLedgerPath
    args.voteStore = envValues.SOCCER_VOTE_STORE || args.voteStore
    args.voteDbPath = envValues.SOCCER_VOTE_DB_PATH || args.voteDbPath
    args.voteStatePath = envValues.SOCCER_VOTE_STATE_PATH || args.voteStatePath
    args.matchResultsPath = envValues.SOCCER_MATCH_RESULTS_PATH || args.matchResultsPath
    args.out = envValues.SOCCER_MATCH_DRAW_LEDGER_PATH || envValues.LUCKY_DRAW_LEDGER_PATH || args.out
    args.sourceRoundId = envValues.SOCCER_MATCH_DRAW_SOURCE_ROUND_ID || args.sourceRoundId
    args.alternateCount = toNumber(envValues.SOCCER_DRAW_ALTERNATE_COUNT || args.alternateCount)
    args.ledgerUriBase = envValues.SOCCER_MATCH_DRAW_LEDGER_URI || envValues.LUCKY_DRAW_LEDGER_URI || args.ledgerUriBase
    args.lockedRoundsDir = envValues.SOCCER_MATCH_DRAW_LEDGER_LOCKED_DIR || args.lockedRoundsDir
  }

  args.prizeSlotCount = Math.max(0, Math.floor(args.prizeSlotCount || 0))
  args.alternateCount = Math.max(DEFAULT_ALTERNATE_COUNT, Math.floor(args.alternateCount || DEFAULT_ALTERNATE_COUNT))
  args.voteStore = normalizeVoteStoreMode(args.voteStore)
  args.roundId = String(args.roundId || '').trim()
  args.sourceRoundId = String(args.sourceRoundId || args.roundId || '').trim()
  if (args.sourceRoundId && !args.roundId) args.roundId = args.sourceRoundId
  args.matchId = canonicalMatchId(args.matchId)
  args.lockedRoundsDir = args.lockedRoundsDir || join(dirname(args.out), 'match-draw-ledgers')
  return args
}

function normalizeVoteStoreMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (!mode || mode === 'json') return 'json'
  if (mode === 'sqlite') return 'sqlite'
  throw new Error(`Unsupported vote store mode ${value}. Use json or sqlite.`)
}

function printHelp() {
  console.log(`Usage:
  node scripts/build-match-draw-ledger.mjs --base-ledger <path> --vote-state <path> --match-results <path> --out <path>

Builds per-match draw rows from backend vote allocations and backend-confirmed
FIFA result snapshots. Frontend fixture winners are not used.

Options:
  --env-file <path>       Optional env file.
  --base-ledger <path>    Buyback ticket ledger used to validate wallet capacity.
  --vote-store <mode>     Vote source: json or sqlite. Default json.
  --vote-db <path>        SQLite vote database when --vote-store sqlite.
  --vote-state <path>     Backend vote-state.json when --vote-store json.
  --match-results <path>  Backend match-results.json from sync-fifa-results.
  --out <path>            Output match draw ledger.
  --round-id <id>         Draw identity to write into the ledger. For redraws,
                          use a fresh identity such as round32-redraw-1.
  --source-round-id <id>  Tournament round used for match/result/vote source rows.
                          Defaults to --round-id.
  --match-id <id>         Build one match only.
  --prize-slots <n>       Override primary winner slots per built match. Default 1.
  --alternates <n>        Alternate ticket count per prize slot. Default 2.
  --ledger-uri-base <uri> Base URI used in draw rows. Defaults to output path.
  --locked-rounds-dir <path>
                          Directory for immutable per-round snapshots.
                          Default: <output dir>/match-draw-ledgers.
  --dry-run               Print summary without writing.
  --replace-existing-round
                          Rebuild and overwrite an existing round snapshot.
                          Default: preserve already locked rounds.
`)
}

function readJsonFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validateDrawRoundId(roundId, label = 'round id') {
  const value = String(roundId || '').trim()
  if (!value) return ''
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(value)) {
    throw new Error(`Unsupported ${label} ${roundId}. Use letters, numbers, dot, underscore, colon, or dash.`)
  }
  return value
}

function readConfiguredVoteState(args) {
  if (args.voteStore === 'sqlite') {
    return readVoteStateFromSqlite({ dbPath: args.voteDbPath })
  }
  return readVoteState(args.voteStatePath)
}

function toPositiveInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function normalizeAllocation(row) {
  const walletAddress = normalizeAddress(row?.walletAddress)
  const roundId = String(row?.roundId || '').trim()
  const matchId = canonicalMatchId(row?.matchId)
  const teamId = String(row?.teamId || '').trim()
  const tickets = toPositiveInteger(row?.tickets)
  if (!walletAddress || !roundId || !matchId || !teamId || tickets <= 0) return null

  return {
    id: String(row.id || `${walletAddress}-${matchId}-${teamId}`),
    walletAddress,
    roundId,
    matchId,
    teamId,
    tickets,
    source: String(row.source || 'server-vote-store'),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}

function normalizeAllocations(state) {
  return (Array.isArray(state.allocations) ? state.allocations : []).map(normalizeAllocation).filter(Boolean)
}

function compareAllocationOrder(left, right) {
  const leftTime = left.createdAt || left.updatedAt || ''
  const rightTime = right.createdAt || right.updatedAt || ''
  if (leftTime !== rightTime) return leftTime.localeCompare(rightTime)
  if (left.walletAddress !== right.walletAddress) return left.walletAddress.localeCompare(right.walletAddress)
  if (left.matchId !== right.matchId) return left.matchId.localeCompare(right.matchId)
  if (left.teamId !== right.teamId) return left.teamId.localeCompare(right.teamId)
  return left.id.localeCompare(right.id)
}

function validateWalletRoundCapacity({ baseLedger, allocations }) {
  const totals = new Map()
  const sharedPoolTotals = new Map()
  for (const allocation of allocations) {
    const key = `${allocation.walletAddress}:${allocation.roundId}`
    totals.set(key, (totals.get(key) || 0) + allocation.tickets)
    if (roundUsesSharedVotingTicketPool(allocation.roundId)) {
      sharedPoolTotals.set(allocation.walletAddress, (sharedPoolTotals.get(allocation.walletAddress) || 0) + allocation.tickets)
    }
  }

  for (const [key, usedTickets] of totals.entries()) {
    const [walletAddress, roundId] = key.split(':')
    const ledgerEntry = findLedgerEntryByAddress(baseLedger, walletAddress)
    if (!ledgerEntry) throw new Error(`wallet ${walletAddress} in ${roundId} vote state is missing from base ticket ledger.`)
    const roundTickets = getTicketBreakdownForRound(ledgerEntry, roundId)
    if (usedTickets > roundTickets.usableTickets) {
      throw new Error(
        `wallet ${walletAddress} uses ${usedTickets} tickets in ${roundId}, exceeding usable ledger balance ${roundTickets.usableTickets}.`,
      )
    }
  }

  for (const [walletAddress, usedTickets] of sharedPoolTotals.entries()) {
    const ledgerEntry = findLedgerEntryByAddress(baseLedger, walletAddress)
    if (!ledgerEntry) throw new Error(`wallet ${walletAddress} in shared vote state is missing from base ticket ledger.`)
    const roundTickets = getTicketBreakdownForRound(ledgerEntry, SHARED_INSIDER_GRANT_ROUND_IDS[0])
    if (usedTickets > roundTickets.usableTickets) {
      throw new Error(
        `wallet ${walletAddress} uses ${usedTickets} shared tickets from round16 through final, exceeding usable ledger balance ${roundTickets.usableTickets}.`,
      )
    }
  }
}

function eligibleAllocationsForMatch({ allocations, result }) {
  return allocations
    .filter((allocation) => allocation.matchId === result.matchId && allocation.teamId === result.winnerTeamId)
    .sort(compareAllocationOrder)
}

function entryForAllocation({ allocation, baseLedger, cursor, multiplier, result }) {
  const ledgerEntry = findLedgerEntryByAddress(baseLedger, allocation.walletAddress)
  if (!ledgerEntry) throw new Error(`wallet ${allocation.walletAddress} is missing from base ticket ledger.`)
  const eligibleTickets = allocation.tickets * multiplier
  const start = cursor + 1
  const end = cursor + eligibleTickets

  return {
    rank: 0,
    walletAddress: allocation.walletAddress,
    userAddress: ledgerEntry.userAddress || allocation.walletAddress,
    sourceAddresses: Array.isArray(ledgerEntry.sourceAddresses) ? ledgerEntry.sourceAddresses : [],
    roundId: allocation.roundId,
    matchId: allocation.matchId,
    teamId: allocation.teamId,
    allocationId: allocation.id,
    allocationTickets: allocation.tickets,
    multiplier,
    eligibleTickets,
    ticketStart: start,
    ticketEnd: end,
    ticketIntervals: [
      {
        start,
        end,
        displayStart: start,
        displayEnd: end,
        namespace: 'match-vote',
        source: 'official-result-eligible-vote',
        allocationId: allocation.id,
        resultSourceUrl: result.sourceUrl,
        resultFetchedAt: result.fetchedAt,
      },
    ],
    sourceTicketLedger: {
      ledgerUserAddress: ledgerEntry.userAddress || allocation.walletAddress,
      finalTickets: toPositiveInteger(ledgerEntry.finalTickets),
      totalVotingTickets: toPositiveInteger(ledgerEntry.totalVotingTickets),
      taskRewardTickets: toPositiveInteger(ledgerEntry.taskRewardTickets),
      rank: toPositiveInteger(ledgerEntry.rank),
    },
  }
}

function buildDrawRow({ result, allocations, baseLedger, baseLedgerPath, matchResults, voteState, args }) {
  const eligibleAllocations = eligibleAllocationsForMatch({ allocations, result })
  if (eligibleAllocations.length === 0) {
    throw new Error(`match ${result.matchId} is confirmed, but no vote allocation picked winner ${result.winnerTeamId}.`)
  }

  const round = roundsById.get(eligibleAllocations[0].roundId || '')
  if (!round) throw new Error(`Could not resolve round for match ${result.matchId}.`)
  const multiplier = Math.max(1, toPositiveInteger(round.multiplier || 1))
  const prizeSlotCount = args.prizeSlotCount || toPositiveInteger(round.matchPrizeSlotCount) || DEFAULT_MATCH_PRIZE_SLOT_COUNT
  const alternateCount = Math.max(DEFAULT_ALTERNATE_COUNT, toPositiveInteger(args.alternateCount || DEFAULT_ALTERNATE_COUNT))
  if (prizeSlotCount <= 0) throw new Error(`prizeSlotCount must be positive for match ${result.matchId}.`)

  let cursor = 0
  const entries = eligibleAllocations.map((allocation) => {
    const entry = entryForAllocation({ allocation, baseLedger, cursor, multiplier, result })
    cursor = entry.ticketEnd
    return entry
  })
  const rankedEntries = entries.map((entry, index) => ({ ...entry, rank: index + 1 }))
  const totalTickets = cursor
  const requiredTickets = prizeSlotCount * (alternateCount + 1)
  if (totalTickets < requiredTickets) {
    throw new Error(
      `match ${result.matchId} has ${totalTickets} eligible tickets, fewer than ${requiredTickets} required winner/alternate tickets. Confirm prize and alternate count before finalizing.`,
    )
  }

  const drawRoundId = args.roundId || round.id
  const sourceRoundId = round.id
  const hashPayload = {
    version: DRAW_LEDGER_HASH_VERSION,
    matchId: result.matchId,
    roundId: sourceRoundId,
    sourceRoundId,
    prizeSlotCount,
    alternateCount,
    totalTickets,
    matchResult: {
      matchId: result.matchId,
      sourceLabel: result.sourceLabel || null,
      sourceStatus: result.sourceStatus || null,
      sourceUrl: result.sourceUrl,
      winnerTeamId: result.winnerTeamId,
      winnerFifaTeamId: result.winnerFifaTeamId || null,
      fifa: {
        competitionId: result.fifa?.competitionId || null,
        seasonId: result.fifa?.seasonId || null,
        stageId: result.fifa?.stageId || null,
        matchId: result.fifa?.matchId || null,
        matchNumber: result.fifa?.matchNumber || null,
        resultType: result.fifa?.resultType || null,
        winnerTeamId: result.fifa?.winnerTeamId || null,
      },
      score: result.score,
    },
    entries: rankedEntries.map((entry) => ({
      walletAddress: entry.walletAddress,
      allocationId: entry.allocationId,
      teamId: entry.teamId,
      allocationTickets: entry.allocationTickets,
      multiplier: entry.multiplier,
      eligibleTickets: entry.eligibleTickets,
      ticketStart: entry.ticketStart,
      ticketEnd: entry.ticketEnd,
    })),
  }
  const ledgerHash = snapshotHash(hashPayload)
  const drawId = result.matchId
  const ledgerUriBase = args.ledgerUriBase || args.out

  return {
    matchId: result.matchId,
    roundId: drawRoundId,
    sourceRoundId,
    drawId,
    ledgerHash,
    totalTickets,
    prizeSlotCount,
    alternateCount,
    ledgerUri: `${ledgerUriBase}#${result.matchId}`,
    sourceMode: 'official-result-match-vote-ledger',
    result: {
      matchId: result.matchId,
      resultStatus: result.resultStatus,
      winnerTeamId: result.winnerTeamId,
      winnerFifaTeamId: result.winnerFifaTeamId,
      score: result.score,
      sourceUrl: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      fifa: result.fifa,
    },
    audit: {
      sourceTicketLedger: {
        path: baseLedgerPath,
        hash: baseLedger.ledgerHash || null,
        generatedAt: baseLedger.generatedAt || null,
      },
      matchResults: {
        hash: matchResults.hash || snapshotHash(matchResults),
        generatedAt: matchResults.generatedAt || null,
        fetchedAt: matchResults.fetchedAt || null,
      },
      voteState: {
        source: args.voteStore,
        generatedAt: voteState.generatedAt || null,
        updatedAt: voteState.updatedAt || null,
        eventCount: toPositiveInteger(voteState.eventCount),
      },
    },
    sourceTicketLedgerHash: baseLedger.ledgerHash || null,
    eligibleEntryCount: rankedEntries.length,
    eligibleWalletCount: new Set(rankedEntries.map((entry) => entry.walletAddress)).size,
    entries: rankedEntries,
    hashPayload,
  }
}

function buildRoundDraws({ draws, args }) {
  const groups = new Map()
  for (const draw of draws) {
    const rows = groups.get(draw.roundId) || []
    rows.push(draw)
    groups.set(draw.roundId, rows)
  }

  return Array.from(groups.entries()).map(([roundId, rows]) => {
    const sortedRows = [...rows].sort((left, right) => left.matchId.localeCompare(right.matchId))
    const sourceRoundId = String(sortedRows[0]?.sourceRoundId || roundId)
    const hashPayload = {
      version: ROUND_DRAW_LEDGER_HASH_VERSION,
      roundId: sourceRoundId,
      sourceRoundId,
      matchDraws: sortedRows.map((draw) => ({
        matchId: draw.matchId,
        ledgerHash: draw.ledgerHash,
        totalTickets: draw.totalTickets,
        prizeSlotCount: draw.prizeSlotCount,
        alternateCount: draw.alternateCount,
        result: {
          winnerTeamId: draw.result?.winnerTeamId || null,
          sourceUrl: draw.result?.sourceUrl || null,
        },
      })),
    }
    const ledgerHash = snapshotHash(hashPayload)
    const ledgerUriBase = args.ledgerUriBase || args.out

    return {
      roundId,
      sourceRoundId,
      redrawOf: sourceRoundId !== roundId ? sourceRoundId : null,
      roundKey: snapshotHash({ type: 'round-id', roundId }),
      drawId: roundId,
      ledgerHash,
      ledgerUri: `${ledgerUriBase}#${roundId}`,
      sourceMode: 'round-match-vote-ledger',
      matchCount: sortedRows.length,
      totalPrizeSlots: sortedRows.reduce((sum, draw) => sum + toPositiveInteger(draw.prizeSlotCount), 0),
      totalAlternateSlots: sortedRows.reduce(
        (sum, draw) => sum + toPositiveInteger(draw.prizeSlotCount) * toPositiveInteger(draw.alternateCount),
        0,
      ),
      matches: sortedRows.map((draw) => ({
        matchId: draw.matchId,
        matchKey: snapshotHash({ type: 'match-id', matchId: draw.matchId }),
        ledgerHash: draw.ledgerHash,
        totalTickets: draw.totalTickets,
        prizeSlotCount: draw.prizeSlotCount,
        alternateCount: draw.alternateCount,
        ledgerUri: draw.ledgerUri,
      })),
      hashPayload,
    }
  })
}

function roundSortValue(roundId) {
  const knownOrder = roundOrder.get(String(roundId || ''))
  return Number.isFinite(knownOrder) ? knownOrder : Number.MAX_SAFE_INTEGER
}

function sortRoundDrawRows(rows) {
  return [...rows].sort((left, right) => (
    roundSortValue(left.roundId) - roundSortValue(right.roundId)
    || String(left.roundId || '').localeCompare(String(right.roundId || ''))
  ))
}

function sortDrawRows(rows) {
  return [...rows].sort((left, right) => (
    roundSortValue(left.roundId) - roundSortValue(right.roundId)
    || String(left.roundId || '').localeCompare(String(right.roundId || ''))
    || String(left.matchId || '').localeCompare(String(right.matchId || ''))
  ))
}

function lockedRoundSnapshotPath(args, roundId = args.roundId) {
  return join(args.lockedRoundsDir, `${roundId}.json`)
}

function findRoundDraw(output, roundId) {
  const roundDraws = Array.isArray(output?.roundDraws) ? output.roundDraws : []
  return roundDraws.find((round) => String(round.roundId || '') === roundId) || null
}

function aggregateHasSameRound(output, roundId, ledgerHash) {
  const round = findRoundDraw(output, roundId)
  return Boolean(round?.ledgerHash && ledgerHash && String(round.ledgerHash).toLowerCase() === String(ledgerHash).toLowerCase())
}

function extractRoundOutput(output, roundId, { lockedAt = null, sourcePath = null } = {}) {
  const roundDraws = (Array.isArray(output?.roundDraws) ? output.roundDraws : [])
    .filter((round) => String(round.roundId || '') === roundId)
  const draws = (Array.isArray(output?.draws) ? output.draws : [])
    .filter((draw) => String(draw.roundId || '') === roundId)
  if (roundDraws.length === 0) throw new Error(`Existing match draw ledger does not include round ${roundId}.`)
  return {
    ...output,
    snapshotMode: 'locked-round-match-draw-ledger',
    lockedRoundId: roundId,
    lockedAt: lockedAt || output?.lockedAt || output?.generatedAt || new Date().toISOString(),
    sourceAggregatePath: sourcePath || null,
    roundDraws: sortRoundDrawRows(roundDraws),
    draws: sortDrawRows(draws),
  }
}

function mergeRoundOutputIntoAggregate(args, existing, roundOutput, { forcedReplace = false } = {}) {
  if (!existing) return roundOutput
  const existingRoundDraws = Array.isArray(existing.roundDraws) ? existing.roundDraws : []
  const existingDraws = Array.isArray(existing.draws) ? existing.draws : []
  const preservedRoundDraws = existingRoundDraws.filter((round) => String(round.roundId || '') !== args.roundId)
  const preservedDraws = existingDraws.filter((draw) => String(draw.roundId || '') !== args.roundId)

  return {
    ...roundOutput,
    snapshotMode: undefined,
    lockedRoundId: undefined,
    lockedAt: undefined,
    sourceAggregatePath: undefined,
    mergedFrom: {
      path: args.out,
      generatedAt: existing.generatedAt || null,
      replacedRoundId: args.roundId,
      preservedRoundCount: preservedRoundDraws.length,
      preservedDrawCount: preservedDraws.length,
      forcedReplace,
    },
    roundDraws: sortRoundDrawRows([...preservedRoundDraws, ...roundOutput.roundDraws]),
    draws: sortDrawRows([...preservedDraws, ...roundOutput.draws]),
    notes: [
      ...(Array.isArray(roundOutput.notes) ? roundOutput.notes : []),
      'When --round-id is used, existing locked draw rows for other rounds are preserved instead of overwritten.',
      'Each locked round is also written to match-draw-ledgers/<roundId>.json and reused as the immutable round snapshot.',
      'Volatile sync metadata such as fetchedAt, generatedAt, and vote event counts are retained for audit but excluded from v2 ledger hashes.',
    ],
  }
}

function readExistingRoundPreservation(args) {
  if (!args.roundId || args.replaceExistingRound) return null

  const roundSnapshotPath = lockedRoundSnapshotPath(args)
  if (existsSync(roundSnapshotPath)) {
    const lockedOutput = JSON.parse(readFileSync(roundSnapshotPath, 'utf8'))
    const lockedRound = findRoundDraw(lockedOutput, args.roundId)
    if (!lockedRound) throw new Error(`Locked round snapshot is invalid: ${roundSnapshotPath}`)
    const existing = existsSync(args.out) ? JSON.parse(readFileSync(args.out, 'utf8')) : null
    const output = aggregateHasSameRound(existing, args.roundId, lockedRound.ledgerHash)
      ? existing
      : mergeRoundOutputIntoAggregate(args, existing, lockedOutput)
    return {
      output,
      writeSkipped: aggregateHasSameRound(existing, args.roundId, lockedRound.ledgerHash),
      preservedExistingRound: true,
      preservedRoundId: args.roundId,
      preservedLedgerHash: lockedRound.ledgerHash || null,
      lockedRoundPath: roundSnapshotPath,
      lockedRoundWriteSkipped: true,
    }
  }

  if (!existsSync(args.out)) return null
  const existing = JSON.parse(readFileSync(args.out, 'utf8'))
  const existingTargetRound = findRoundDraw(existing, args.roundId)
  if (!existingTargetRound) return null
  const lockedRoundOutput = extractRoundOutput(existing, args.roundId, {
    lockedAt: existing.generatedAt || null,
    sourcePath: args.out,
  })
  return {
    output: existing,
    writeSkipped: true,
    preservedExistingRound: true,
    preservedRoundId: args.roundId,
    preservedLedgerHash: existingTargetRound.ledgerHash || null,
    lockedRoundPath: roundSnapshotPath,
    lockedRoundOutput,
    lockedRoundWriteSkipped: false,
    lockedRoundExtractedFromAggregate: true,
  }
}

function mergeExistingRoundOutput(args, output) {
  if (!args.roundId || !existsSync(args.out)) {
    return {
      output,
      writeSkipped: false,
      preservedExistingRound: false,
      lockedRoundPath: args.roundId ? lockedRoundSnapshotPath(args) : null,
      lockedRoundOutput: args.roundId ? extractRoundOutput(output, args.roundId) : null,
      lockedRoundWriteSkipped: false,
    }
  }

  const existing = JSON.parse(readFileSync(args.out, 'utf8'))
  const existingTargetRound = findRoundDraw(existing, args.roundId)
  if (existingTargetRound && !args.replaceExistingRound) {
    const lockedRoundOutput = extractRoundOutput(existing, args.roundId, {
      lockedAt: existing.generatedAt || null,
      sourcePath: args.out,
    })
    return {
      output: existing,
      writeSkipped: true,
      preservedExistingRound: true,
      preservedRoundId: args.roundId,
      preservedLedgerHash: existingTargetRound.ledgerHash || null,
      lockedRoundPath: lockedRoundSnapshotPath(args),
      lockedRoundOutput,
      lockedRoundWriteSkipped: false,
      lockedRoundExtractedFromAggregate: true,
    }
  }

  const lockedRoundOutput = extractRoundOutput(output, args.roundId)
  return {
    output: mergeRoundOutputIntoAggregate(args, existing, output, { forcedReplace: Boolean(args.replaceExistingRound) }),
    writeSkipped: false,
    preservedExistingRound: false,
    replacedRoundId: args.roundId,
    lockedRoundPath: lockedRoundSnapshotPath(args),
    lockedRoundOutput,
    lockedRoundWriteSkipped: false,
  }
}

export function buildMatchDrawLedger(args) {
  const baseLedger = readLedgerPayload(args.baseLedgerPath)
  const voteState = readConfiguredVoteState(args)
  const matchResults = readMatchResultsSnapshot(args.matchResultsPath)
  const resultIndex = buildMatchResultIndex(matchResults)
  const allocations = normalizeAllocations(voteState)
  validateWalletRoundCapacity({ baseLedger, allocations })
  const sourceRoundId = args.sourceRoundId || args.roundId
  if (sourceRoundId && !roundsById.has(sourceRoundId)) {
    throw new Error(`Unsupported source round id ${sourceRoundId}.`)
  }
  if (args.roundId) validateDrawRoundId(args.roundId, 'draw round id')

  const targetResults = Array.from(resultIndex.values())
    .filter((result) => (!args.matchId || result.matchId === args.matchId))
    .filter((result) => (!sourceRoundId || roundIdByMatchId.get(result.matchId) === sourceRoundId))
    .filter((result) => result.resultStatus === 'confirmed' && result.winnerTeamId)

  if (args.matchId && !confirmedMatchResultFor(resultIndex, args.matchId)) {
    throw new Error(`match ${args.matchId} does not have a backend-confirmed official result.`)
  }
  if (targetResults.length === 0) {
    throw new Error('No backend-confirmed official match results are available for draw ledger generation.')
  }

  const draws = targetResults.map((result) => buildDrawRow({
    result,
    allocations,
    baseLedger,
    baseLedgerPath: args.baseLedgerPath,
    matchResults,
    voteState,
    args,
  }))
  const roundDraws = buildRoundDraws({ draws, args })

  const generatedAt = new Date().toISOString()
  return {
    version: OUTPUT_VERSION,
    mode: 'match-draw-ledger',
    sourceLabel: 'backend-official-result-eligibility',
    sourceStatus: 'ready',
    generatedAt,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    candidateSourceLimited: false,
    sourceTicketLedger: {
      path: args.baseLedgerPath,
      mode: baseLedger.mode || null,
      generatedAt: baseLedger.generatedAt || null,
      ledgerHash: baseLedger.ledgerHash || null,
      totalEntries: toPositiveInteger(baseLedger.totalEntries),
      totalFinalTickets: toPositiveInteger(baseLedger.totalFinalTickets),
    },
    voteState: {
      source: args.voteStore,
      path: args.voteStatePath,
      dbPath: args.voteStore === 'sqlite' ? args.voteDbPath : null,
      generatedAt: voteState.generatedAt || null,
      updatedAt: voteState.updatedAt || null,
      eventCount: toPositiveInteger(voteState.eventCount),
      allocationCount: allocations.length,
    },
    matchResults: {
      path: args.matchResultsPath,
      hash: matchResults.hash || snapshotHash(matchResults),
      generatedAt: matchResults.generatedAt || null,
      sourceStatus: matchResults.sourceStatus || null,
      summary: summarizeMatchResults(matchResults),
    },
    roundDraws,
    draws,
    notes: [
      'Draw rows are generated only from backend-confirmed FIFA official match results.',
      'Frontend campaign fixture status and advancingTeamId are not used for production eligibility.',
      'Every match draw has an independent ticket namespace starting at 1.',
      'Every prize slot receives one primary winner ticket and the configured alternate ticket count.',
      'Round draw hashes lock all match draw rows before requesting one VRF random word for the round.',
      'No fallback result logic is used. Pending, missing, stale, source_error, and mismatch results do not enter the draw pool.',
    ],
  }
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isCliEntrypoint()) {
  const args = parseArgs(process.argv.slice(2))
  try {
    const mergeResult = readExistingRoundPreservation(args)
      || mergeExistingRoundOutput(args, buildMatchDrawLedger(args))
    const output = mergeResult.output
    const summary = {
      drawCount: output.draws.length,
      roundDrawCount: output.roundDraws.length,
      writeSkipped: mergeResult.writeSkipped,
      preservedExistingRound: mergeResult.preservedExistingRound,
      preservedRoundId: mergeResult.preservedRoundId || null,
      preservedLedgerHash: mergeResult.preservedLedgerHash || null,
      lockedRoundPath: mergeResult.lockedRoundPath || null,
      lockedRoundWriteSkipped: Boolean(mergeResult.lockedRoundWriteSkipped),
      lockedRoundExtractedFromAggregate: Boolean(mergeResult.lockedRoundExtractedFromAggregate),
      roundDraws: output.roundDraws.map((roundDraw) => ({
        roundId: roundDraw.roundId,
        sourceRoundId: roundDraw.sourceRoundId || roundDraw.roundId,
        redrawOf: roundDraw.redrawOf || null,
        roundKey: roundDraw.roundKey,
        ledgerHash: roundDraw.ledgerHash,
        matchCount: roundDraw.matchCount,
        totalPrizeSlots: roundDraw.totalPrizeSlots,
        totalAlternateSlots: roundDraw.totalAlternateSlots,
      })),
      draws: output.draws.map((draw) => ({
        matchId: draw.matchId,
        roundId: draw.roundId,
        sourceRoundId: draw.sourceRoundId || draw.roundId,
        ledgerHash: draw.ledgerHash,
        totalTickets: draw.totalTickets,
        prizeSlotCount: draw.prizeSlotCount,
        alternateCount: draw.alternateCount,
        eligibleEntryCount: draw.eligibleEntryCount,
      })),
    }

    if (args.dryRun || hasFlag('--dry-run')) {
      console.log(JSON.stringify({ ok: true, dryRun: true, summary, output }, null, 2))
    } else {
      if (mergeResult.lockedRoundOutput && mergeResult.lockedRoundPath && !mergeResult.lockedRoundWriteSkipped) {
        writeJsonAtomic(mergeResult.lockedRoundPath, mergeResult.lockedRoundOutput)
      }
      if (!mergeResult.writeSkipped) {
        writeJsonAtomic(args.out, output)
      }
      console.log(JSON.stringify({
        ok: true,
        out: args.out,
        writeSkipped: mergeResult.writeSkipped,
        lockedRoundPath: mergeResult.lockedRoundPath || null,
        lockedRoundWriteSkipped: Boolean(mergeResult.lockedRoundWriteSkipped),
        summary,
      }, null, 2))
    }
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
