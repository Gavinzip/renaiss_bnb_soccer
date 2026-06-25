#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { campaignMatches } from '../src/app/data/worldCupCampaign.js'
import { DEFAULT_WINNER_REVEAL_VIDEO_URL } from '../src/app/data/winnerRevealRuntime.js'
import { buildMatchDrawLedger } from './build-match-draw-ledger.mjs'
import {
  FIFA_WORLD_CUP_SOURCE,
  MATCH_RESULTS_VERSION,
  finalizeMatchResultsSnapshot,
  snapshotHash,
  writeJsonAtomic,
} from './soccer-match-results.mjs'
import { replaceSqliteVoteState } from './soccer-vote-store-sqlite.mjs'
import { normalizeAddress, toPositiveInteger } from './soccer-vote-store.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_DATA_DIR = join(repoRoot, '.local-data/soccer-test-batch')
const DEFAULT_SOURCE_LEDGER = join(repoRoot, '.local-data/soccer-production/lucky-draw-ledger.json')
const LEGACY_SOURCE_LEDGER = join(repoRoot, '.local-data/soccer/lucky-draw-ledger.json')
const DEFAULT_VOTE_COUNT = 1000
const DEFAULT_TARGET_DRAW_POOL_TICKETS = 10000
const DEFAULT_PRIZE_SLOTS = 1
const DEFAULT_ALTERNATE_COUNT = 2
const DEFAULT_SEED = 'renaiss-round16-test-batch-2026'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage:
  node scripts/seed-local-test-batch.mjs [--data-dir <path>] [--source-ledger <path>] [--votes 1000] [--target-pool 10000] [--prize-slots 1] [--alternates 2]

Builds a local test-batch dataset from real production ledger wallets:
  - copies the source ticket ledger
  - generates fake Round of 16 vote allocations
  - targets the requested draw-eligible ticket pool
  - writes SQLite vote store snapshots
  - writes local confirmed match-results fixtures
  - builds a round-level/per-match draw ledger
`)
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.floor(number)
}

function resolvePath(value, fallback) {
  const path = String(value || fallback).trim()
  return path.startsWith('/') ? path : resolve(repoRoot, path)
}

function assertSafeLocalDataDir(dataDir) {
  const productionDataDir = resolve('/data/soccer')
  if ((dataDir === productionDataDir || dataDir.startsWith(`${productionDataDir}/`)) && !hasFlag('--allow-production-path')) {
    throw new Error('Refusing to write /data/soccer. Choose a local test data dir.')
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sourceLedgerPath() {
  const explicit = argValue('--source-ledger') || process.env.SOCCER_TEST_BATCH_SOURCE_LEDGER_PATH || ''
  if (explicit) return resolvePath(explicit, explicit)
  if (existsSync(DEFAULT_SOURCE_LEDGER)) return DEFAULT_SOURCE_LEDGER
  return LEGACY_SOURCE_LEDGER
}

function mulberry32(seedText) {
  let seed = 0
  for (const char of String(seedText)) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 2654435761) >>> 0
  }
  return () => {
    seed += 0x6d2b79f5
    let value = seed
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pickIndex(random, length) {
  return Math.min(length - 1, Math.floor(random() * length))
}

function shuffleInPlace(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = pickIndex(random, index + 1)
    const current = values[index]
    values[index] = values[swapIndex]
    values[swapIndex] = current
  }
  return values
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString()
}

function entryAddress(entry) {
  return normalizeAddress(entry?.userAddress) || normalizeAddress(entry?.walletAddress) || normalizeAddress(entry?.sourceAddresses?.[0])
}

function usableLedgerEntries(ledger) {
  return (Array.isArray(ledger.entries) ? ledger.entries : [])
    .map((entry) => ({
      entry,
      walletAddress: entryAddress(entry),
      finalTickets: toPositiveInteger(entry.finalTickets),
    }))
    .filter((row) => row.walletAddress && row.finalTickets > 0)
}

function winnerTeamForMatch(match) {
  return match.advancingTeamId || match.teams[0]
}

function scoreForWinner(match, winnerTeamId) {
  const winnerIsHome = match.teams[0] === winnerTeamId
  return {
    home: winnerIsHome ? 2 : 1,
    away: winnerIsHome ? 1 : 2,
    homePenalty: null,
    awayPenalty: null,
  }
}

function createMatchResults({ generatedAtIso, matches }) {
  return finalizeMatchResultsSnapshot({
    version: MATCH_RESULTS_VERSION,
    mode: 'fifa-official-match-results',
    sourceLabel: 'local-test-batch-result-fixture',
    sourceStatus: 'local-test-batch',
    generatedAt: generatedAtIso,
    fetchedAt: generatedAtIso,
    source: {
      competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
      seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
      note: 'Local test-batch result fixtures. Not a production result source.',
    },
    results: matches.map((match, index) => {
      const winnerTeamId = winnerTeamForMatch(match)
      const winnerIsHome = match.teams[0] === winnerTeamId
      return {
        matchId: match.id,
        resultStatus: 'confirmed',
        resultReason: 'local-test-batch-confirmed',
        sourceUrl: `local://test-batch/${match.id}`,
        fetchedAt: addSeconds(generatedAtIso, index),
        stale: false,
        fifa: {
          competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
          seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
          stageId: 'local-test-batch',
          matchId: `local-${match.id}`,
          matchNumber: 73 + index,
          matchStatus: 12,
          officialityStatus: 1,
          resultType: 1,
          winnerTeamId: `local-${winnerTeamId}`,
        },
        teams: {
          home: {
            fifaTeamId: `local-${match.teams[0]}`,
            abbreviation: match.teams[0].slice(0, 3).toUpperCase(),
            name: match.teams[0],
            localTeamId: match.teams[0],
          },
          away: {
            fifaTeamId: `local-${match.teams[1]}`,
            abbreviation: match.teams[1].slice(0, 3).toUpperCase(),
            name: match.teams[1],
            localTeamId: match.teams[1],
          },
          expectedLocalTeamIds: match.teams,
          teamMatch: true,
        },
        score: scoreForWinner(match, winnerTeamId),
        winnerSide: winnerIsHome ? 'home' : 'away',
        winnerTeamId,
        winnerFifaTeamId: `local-${winnerTeamId}`,
      }
    }),
    errors: [],
  })
}

function makeCapacityRows(ledger, random) {
  return shuffleInPlace(usableLedgerEntries(ledger), random).map((row) => ({
    ...row,
    remainingTickets: row.finalTickets,
  }))
}

function comboKey(matchId, teamId) {
  return `${matchId}:${teamId}`
}

function pickWalletForCombo(rows, matchId, teamId, requestedTickets, random) {
  const maxTickets = Math.max(1, Math.floor(Number(requestedTickets) || 1))
  for (let ticketCount = maxTickets; ticketCount >= 1; ticketCount -= 1) {
    const start = pickIndex(random, rows.length)
    for (let offset = 0; offset < rows.length; offset += 1) {
      const row = rows[(start + offset) % rows.length]
      if (row.remainingTickets < ticketCount) continue
      row.remainingTickets -= ticketCount
      return {
        walletAddress: row.walletAddress,
        tickets: ticketCount,
      }
    }
  }
  throw new Error(`Could not allocate another unique vote for ${matchId}/${teamId}.`)
}

function createAllocations({ ledger, matches, voteCount, targetPoolTickets, prizeSlots, alternateCount, generatedAtIso, random }) {
  const rows = makeCapacityRows(ledger, random)
  const allocations = []
  const countsByMatchTeam = new Map()
  const eligibleTicketsByMatch = new Map()
  const minimumEligibleTickets = matches.length * prizeSlots * (alternateCount + 1)
  const targetEligibleTickets = Math.max(minimumEligibleTickets, Math.floor(Number(targetPoolTickets) || 0))
  const ticketChunk = Math.max(1, Math.ceil(targetEligibleTickets / Math.max(1, voteCount)))
  let submittedTickets = 0
  let eligibleTickets = 0
  let eventCount = 0

  function remainingCapacity() {
    return rows.reduce((total, row) => total + row.remainingTickets, 0)
  }

  function addVote(match, teamId, requestedTickets = ticketChunk) {
    const allocation = pickWalletForCombo(rows, match.id, teamId, requestedTickets, random)
    const countKey = comboKey(match.id, teamId)
    countsByMatchTeam.set(countKey, (countsByMatchTeam.get(countKey) || 0) + allocation.tickets)
    submittedTickets += allocation.tickets
    if (teamId === winnerTeamForMatch(match)) {
      eligibleTicketsByMatch.set(match.id, (eligibleTicketsByMatch.get(match.id) || 0) + allocation.tickets)
      eligibleTickets += allocation.tickets
    }
    eventCount += 1
    const existingIndex = allocations.findIndex((entry) => (
      entry.walletAddress === allocation.walletAddress
      && entry.roundId === match.roundId
      && entry.matchId === match.id
      && entry.teamId === teamId
    ))
    const ordinal = allocations.length + 1
    const createdAt = addSeconds(generatedAtIso, ordinal)
    const updatedAt = addSeconds(generatedAtIso, eventCount)
    if (existingIndex >= 0) {
      allocations[existingIndex] = {
        ...allocations[existingIndex],
        tickets: allocations[existingIndex].tickets + allocation.tickets,
        updatedAt,
      }
    } else {
      allocations.push({
        id: `local-test-batch-${match.id}-${teamId}-${ordinal}`,
        walletAddress: allocation.walletAddress,
        roundId: match.roundId,
        matchId: match.id,
        teamId,
        tickets: allocation.tickets,
        source: 'local-test-batch-seed',
        official: false,
        createdAt,
        updatedAt,
        requestId: `local-test-batch-${ordinal}`,
      })
    }
  }

  const baseMatchTarget = Math.floor(targetEligibleTickets / matches.length)
  const targetRemainder = targetEligibleTickets % matches.length
  for (const [matchIndex, match] of matches.entries()) {
    const matchEligibleTarget = baseMatchTarget + (matchIndex < targetRemainder ? 1 : 0)
    const winnerTeamId = winnerTeamForMatch(match)
    while ((eligibleTicketsByMatch.get(match.id) || 0) < matchEligibleTarget) {
      const remainingForMatch = matchEligibleTarget - (eligibleTicketsByMatch.get(match.id) || 0)
      addVote(match, winnerTeamId, Math.min(ticketChunk, remainingForMatch))
    }
  }

  let fillerAttempts = 0
  const maxFillerAttempts = Math.max(voteCount * 10, 100)
  while (allocations.length < voteCount && remainingCapacity() > 0 && fillerAttempts < maxFillerAttempts) {
    fillerAttempts += 1
    const match = matches[pickIndex(random, matches.length)]
    const losingTeams = match.teams.filter((teamId) => teamId !== winnerTeamForMatch(match))
    const candidates = losingTeams.length > 0 ? losingTeams : match.teams
    const teamId = candidates[pickIndex(random, candidates.length)]
    addVote(match, teamId, 1)
  }

  return {
    allocations,
    eventCount,
    submittedTickets,
    eligibleTickets,
    targetEligibleTickets,
    countsByMatchTeam: Object.fromEntries([...countsByMatchTeam.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
}

function createPendingWinnersSnapshot({ generatedAtIso, videoUrl, matchDrawLedger }) {
  return {
    version: 1,
    mode: 'draw-winners',
    sourceLabel: 'local-test-batch-pending-chain-reveal',
    sourceStatus: 'pending',
    localOnly: true,
    generatedAt: generatedAtIso,
    generatedAtUnix: Math.floor(Date.parse(generatedAtIso) / 1000),
    videoUrl,
    winners: [],
    winnersBySlot: [],
    roundDraws: matchDrawLedger.roundDraws.map((roundDraw) => ({
      roundId: roundDraw.roundId,
      roundKey: roundDraw.roundKey,
      ledgerHash: roundDraw.ledgerHash,
      matchCount: roundDraw.matchCount,
      totalPrizeSlots: roundDraw.totalPrizeSlots,
      totalAlternateSlots: roundDraw.totalAlternateSlots,
    })),
    draws: matchDrawLedger.draws.map((draw) => ({
      matchId: draw.matchId,
      roundId: draw.roundId,
      ledgerHash: draw.ledgerHash,
      totalTickets: String(draw.totalTickets),
      prizeSlotCount: String(draw.prizeSlotCount),
      alternateCount: String(draw.alternateCount),
    })),
    notes: [
      'Run scripts/run-lucky-draw-round.mjs against the BSC testnet contract to replace this pending snapshot with one-VRF round reveal winners.',
    ],
  }
}

async function main() {
  if (hasFlag('--help')) {
    printHelp()
    return
  }

  const dataDir = resolvePath(argValue('--data-dir') || process.env.SOCCER_TEST_BATCH_DATA_DIR || process.env.SOCCER_LOCAL_DATA_DIR, DEFAULT_DATA_DIR)
  assertSafeLocalDataDir(dataDir)
  const ledgerPath = sourceLedgerPath()
  const voteCount = readPositiveInteger(argValue('--votes') || process.env.SOCCER_TEST_BATCH_VOTE_COUNT, DEFAULT_VOTE_COUNT)
  const targetPoolTickets = readPositiveInteger(argValue('--target-pool') || process.env.SOCCER_TEST_BATCH_TARGET_POOL_TICKETS, DEFAULT_TARGET_DRAW_POOL_TICKETS)
  const prizeSlots = readPositiveInteger(argValue('--prize-slots') || process.env.SOCCER_TEST_BATCH_PRIZE_SLOTS, DEFAULT_PRIZE_SLOTS)
  const alternateCount = readPositiveInteger(argValue('--alternates') || process.env.SOCCER_TEST_BATCH_ALTERNATES || process.env.SOCCER_DRAW_ALTERNATE_COUNT, DEFAULT_ALTERNATE_COUNT)
  const seed = argValue('--seed') || process.env.SOCCER_TEST_BATCH_SEED || DEFAULT_SEED
  const random = mulberry32(seed)
  const generatedAtIso = new Date().toISOString()
  const videoUrl = argValue('--video-url') || process.env.WINNER_REVEAL_VIDEO_URL || DEFAULT_WINNER_REVEAL_VIDEO_URL
  const ledger = readJson(ledgerPath, 'source ticket ledger')
  const availableTicketCapacity = usableLedgerEntries(ledger).reduce((sum, row) => sum + row.finalTickets, 0)
  if (targetPoolTickets > availableTicketCapacity) {
    throw new Error(`target-pool (${targetPoolTickets}) must be <= source ledger usable final tickets (${availableTicketCapacity}).`)
  }
  const matches = campaignMatches.filter((match) => match.roundId === 'round16')
  if (matches.length !== 8) throw new Error(`Expected 8 Round of 16 matches, found ${matches.length}.`)
  const requiredWinnerTickets = matches.length * prizeSlots * (alternateCount + 1)
  if (voteCount < requiredWinnerTickets) {
    throw new Error(`votes (${voteCount}) must be >= matches * prizeSlots * (alternates + 1) (${requiredWinnerTickets}).`)
  }

  const paths = {
    dataDir,
    ledger: join(dataDir, 'lucky-draw-ledger.json'),
    votesDir: join(dataDir, 'votes'),
    voteDb: join(dataDir, 'votes/vote-store.sqlite'),
    voteState: join(dataDir, 'votes/vote-state.json'),
    votePreview: join(dataDir, 'votes/vote-preview.json'),
    matchResults: join(dataDir, 'match-results.json'),
    matchDrawLedger: join(dataDir, 'match-draw-ledger.json'),
    drawWinners: join(dataDir, 'draw-winners.json'),
    summary: join(dataDir, 'test-batch-summary.json'),
  }
  mkdirSync(paths.votesDir, { recursive: true })

  const matchResults = createMatchResults({ generatedAtIso, matches })
  const {
    allocations,
    countsByMatchTeam,
    eventCount,
    submittedTickets,
    eligibleTickets,
    targetEligibleTickets,
  } = createAllocations({
    ledger,
    matches,
    voteCount,
    targetPoolTickets,
    prizeSlots,
    alternateCount,
    generatedAtIso,
    random,
  })

  writeJsonAtomic(paths.ledger, {
    ...ledger,
    sourceLabel: ledger.sourceLabel || 'production-ticket-ledger',
    localTestBatchSource: {
      sourceLedgerPath: ledgerPath,
      copiedAt: generatedAtIso,
      fakeVoteCount: voteCount,
      fakeDrawEligibleTicketTarget: targetPoolTickets,
    },
  })
  writeJsonAtomic(paths.matchResults, matchResults)
  const voteSeed = replaceSqliteVoteState({
    dbPath: paths.voteDb,
    allocations,
    statePath: paths.voteState,
    previewPath: paths.votePreview,
    matchResults,
    meta: {
      sourceLabel: 'local-test-batch-votes',
      sourceStatus: 'local-test-batch',
      syncedFromProductionAt: null,
      productionOrigin: null,
    },
  })

  const matchDrawLedger = buildMatchDrawLedger({
    baseLedgerPath: paths.ledger,
    voteStore: 'sqlite',
    voteDbPath: paths.voteDb,
    voteStatePath: paths.voteState,
    matchResultsPath: paths.matchResults,
    out: paths.matchDrawLedger,
    matchId: '',
    prizeSlotCount: prizeSlots,
    alternateCount,
    ledgerUriBase: '/match-draw-ledger.json',
    dryRun: false,
  })
  writeJsonAtomic(paths.matchDrawLedger, matchDrawLedger)
  writeJsonAtomic(paths.drawWinners, createPendingWinnersSnapshot({ generatedAtIso, videoUrl, matchDrawLedger }))

  const summary = {
    version: 1,
    mode: 'local-test-batch-summary',
    sourceLabel: 'local-test-batch-seed',
    sourceStatus: 'ready',
    generatedAt: generatedAtIso,
    sourceLedgerPath: ledgerPath,
    seed,
    voteCount,
    targetDrawEligibleTickets: targetEligibleTickets,
    prizeSlotsPerMatch: prizeSlots,
    alternatesPerPrizeSlot: alternateCount,
    sourceLedger: {
      totalEntries: toPositiveInteger(ledger.totalEntries),
      totalFinalTickets: toPositiveInteger(ledger.totalFinalTickets),
      ledgerHash: ledger.ledgerHash || null,
    },
    fakeVotes: {
      allocationCount: allocations.length,
      eventCount,
      submittedTickets,
      eligibleTickets,
      targetEligibleTickets,
      voterCount: new Set(allocations.map((allocation) => allocation.walletAddress)).size,
      countsByMatchTeam,
    },
    drawLedger: {
      drawCount: matchDrawLedger.draws.length,
      roundDraws: matchDrawLedger.roundDraws.map((roundDraw) => ({
        roundId: roundDraw.roundId,
        roundKey: roundDraw.roundKey,
        ledgerHash: roundDraw.ledgerHash,
        matchCount: roundDraw.matchCount,
        totalPrizeSlots: roundDraw.totalPrizeSlots,
        totalAlternateSlots: roundDraw.totalAlternateSlots,
      })),
      draws: matchDrawLedger.draws.map((draw) => ({
        matchId: draw.matchId,
        totalTickets: draw.totalTickets,
        prizeSlotCount: draw.prizeSlotCount,
        alternateCount: draw.alternateCount,
        ledgerHash: draw.ledgerHash,
      })),
    },
    pendingWinnersHash: snapshotHash({ generatedAtIso, voteCount, targetPoolTickets, prizeSlots, alternateCount, seed, countsByMatchTeam }),
    files: paths,
    notes: [
      'Only vote allocations are fake. Wallets and ticket capacities come from the source ledger.',
      'This dataset is local-test-batch only and must not be promoted to production.',
    ],
  }
  writeJsonAtomic(paths.summary, summary)

  console.log(JSON.stringify({
    ok: true,
    dataDir,
    sourceLedgerPath: ledgerPath,
    voteCount,
    targetDrawEligibleTickets: targetEligibleTickets,
    prizeSlotsPerMatch: prizeSlots,
    alternatesPerPrizeSlot: alternateCount,
    fakeVotes: summary.fakeVotes,
    firstDraw: summary.drawLedger.draws[0],
    files: paths,
    voteSnapshot: voteSeed.snapshot,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
