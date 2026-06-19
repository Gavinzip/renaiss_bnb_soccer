#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ethers } from 'ethers'

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

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_LOCAL_DATA_DIR = join(repoRoot, '.local-data/soccer')
const DEFAULT_SEED = 'renaiss-round16-local-demo-2026'
const DEFAULT_PRIZE_SLOTS_PER_MATCH = 2

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage:
  node scripts/seed-local-round16-demo.mjs [--data-dir <path>] [--prize-slots 2] [--voters-per-match 2] [--seed <text>]

Creates local-only demo data for Round of 16 testing:
  - lucky-draw-ledger.json
  - votes/vote-store.sqlite plus JSON snapshots
  - match-results.json
  - match-draw-ledger.json
  - draw-winners.json

The demo uses fake vote allocations and local-only confirmed result fixtures.
It refuses /data/soccer unless --allow-production-path is passed.
`)
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.floor(parsed))
}

function normalizeDataDir(value) {
  return resolve(String(value || DEFAULT_LOCAL_DATA_DIR).trim())
}

function assertSafeLocalDataDir(dataDir) {
  const productionDataDir = resolve('/data/soccer')
  if ((dataDir === productionDataDir || dataDir.startsWith(`${productionDataDir}/`)) && !hasFlag('--allow-production-path')) {
    throw new Error('Refusing to seed /data/soccer. Use a local data dir or pass --allow-production-path intentionally.')
  }
}

function fakeWallet(index) {
  return `0x${index.toString(16).padStart(40, '0')}`
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString()
}

function createBaseLedger({ generatedAtIso, allocations }) {
  const generatedAt = Math.floor(Date.parse(generatedAtIso) / 1000)
  const entries = allocations.map((allocation, index) => ({
    rank: index + 1,
    userAddress: allocation.walletAddress,
    sourceAddresses: [allocation.walletAddress],
    packs: {
      localDemo: 1,
    },
    rawTickets: allocation.tickets,
    bonusTickets: 0,
    finalTickets: allocation.tickets,
    sbt: 'none',
    sbtMultiplier: 1,
    eventCount: 1,
    firstBuybackAt: generatedAt,
    lastBuybackAt: generatedAt,
    ticketStart: index + 1,
    ticketEnd: index + 1,
    ticketIntervals: [
      {
        start: index + 1,
        end: index + 1,
        displayStart: index + 1,
        displayEnd: index + 1,
        namespace: 'local-demo-base-ticket',
        source: 'local-round16-demo-seed',
      },
    ],
  }))

  const ledger = {
    version: 1,
    mode: 'local-round16-demo-ticket-ledger',
    sourceLabel: 'local-round16-demo-seed',
    sourceStatus: 'local-demo',
    generatedAt,
    generatedAtIso,
    campaignStart: generatedAt,
    campaignEnd: generatedAt,
    totalEntries: entries.length,
    totalRawTickets: entries.length,
    totalBonusTickets: 0,
    totalFinalTickets: entries.reduce((sum, entry) => sum + entry.finalTickets, 0),
    sourceEntries: entries.length,
    candidateSourceLimited: false,
    drawContractAddress: null,
    bonusShuffleVersion: 'local-demo',
    bonusShuffleSeed: 'local-round16-demo',
    bonusShuffleLocked: true,
    bonusShuffleLockedAt: generatedAt,
    packRules: [],
    entries,
    notes: [
      'Local-only demo ledger for Round of 16 flow testing.',
      'Fake ticket quantities are intentionally generated for local testing and must not be used in production.',
    ],
  }
  return {
    ...ledger,
    ledgerHash: snapshotHash({
      version: ledger.version,
      mode: ledger.mode,
      generatedAt: ledger.generatedAt,
      entries: ledger.entries.map((entry) => ({
        userAddress: entry.userAddress,
        finalTickets: entry.finalTickets,
        ticketStart: entry.ticketStart,
        ticketEnd: entry.ticketEnd,
      })),
    }),
  }
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
  const results = matches.map((match, index) => {
    const winnerTeamId = winnerTeamForMatch(match)
    const winnerIsHome = match.teams[0] === winnerTeamId
    const score = scoreForWinner(match, winnerTeamId)
    return {
      matchId: match.id,
      resultStatus: 'confirmed',
      resultReason: 'local-round16-demo-confirmed',
      sourceUrl: `local://round16-demo/${match.id}`,
      fetchedAt: addSeconds(generatedAtIso, index),
      stale: false,
      fifa: {
        competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
        seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
        stageId: 'local-round16-demo',
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
      score,
      winnerSide: winnerIsHome ? 'home' : 'away',
      winnerTeamId,
      winnerFifaTeamId: `local-${winnerTeamId}`,
    }
  })

  return finalizeMatchResultsSnapshot({
    version: MATCH_RESULTS_VERSION,
    mode: 'fifa-official-match-results',
    sourceLabel: 'local-round16-demo-result-fixture',
    sourceStatus: 'local-demo',
    generatedAt: generatedAtIso,
    fetchedAt: generatedAtIso,
    source: {
      competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
      seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
      note: 'Local-only confirmed fixtures for testing the production draw data shape.',
    },
    results,
    errors: [],
  })
}

function createAllocations({ generatedAtIso, matches, votersPerMatch }) {
  let walletIndex = 1
  return matches.flatMap((match, matchIndex) => {
    const winnerTeamId = winnerTeamForMatch(match)
    return Array.from({ length: votersPerMatch }, (_, voterIndex) => {
      const walletAddress = fakeWallet(walletIndex++)
      const createdAt = addSeconds(generatedAtIso, matchIndex * votersPerMatch + voterIndex)
      return {
        id: `local-demo-${match.id}-${voterIndex + 1}`,
        walletAddress,
        roundId: match.roundId,
        matchId: match.id,
        teamId: winnerTeamId,
        tickets: 1,
        source: 'local-round16-demo-seed',
        official: false,
        createdAt,
        updatedAt: createdAt,
      }
    })
  })
}

function toPositiveBigInt(value) {
  try {
    const result = BigInt(value || 0)
    return result > 0n ? result : 0n
  } catch {
    return 0n
  }
}

function drawIdFromMatchId(matchId) {
  return ethers.id(String(matchId || '').trim()).toLowerCase()
}

function localRandomWord({ seed, drawId, ledgerHash, salt = 0 }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'bytes32', 'bytes32', 'uint256'],
    [seed, drawId, ledgerHash, BigInt(salt)],
  )
  return BigInt(ethers.keccak256(encoded))
}

function drawUniqueTickets({ drawId, randomWord, totalTickets, prizeSlotCount }) {
  const tickets = []
  for (let pickIndex = 0; pickIndex < prizeSlotCount; pickIndex += 1) {
    let selected = 0n
    for (let nonce = 0n; nonce < totalTickets; nonce += 1n) {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'bytes32', 'uint256', 'uint256'],
        [randomWord, drawId, BigInt(pickIndex), nonce],
      )
      const candidate = (BigInt(ethers.keccak256(encoded)) % totalTickets) + 1n
      if (!tickets.includes(candidate)) {
        selected = candidate
        break
      }
    }
    if (selected === 0n) throw new Error(`Could not draw a unique ticket for ${drawId} slot ${pickIndex}.`)
    tickets.push(selected)
  }
  return tickets
}

function findLocalDrawOutcome({ seed, drawId, ledgerHash, totalTickets, prizeSlotCount }) {
  for (let salt = 0; salt < 10000; salt += 1) {
    const randomWord = localRandomWord({ seed, drawId, ledgerHash, salt })
    try {
      return {
        randomWord,
        randomWordSalt: salt,
        winnerTicketsBySlot: drawUniqueTickets({ drawId, randomWord, totalTickets, prizeSlotCount }),
      }
    } catch (error) {
      if (!String(error?.message || '').includes('Could not draw a unique ticket')) throw error
    }
  }
  throw new Error(`Could not find a local randomWord that produces ${prizeSlotCount} unique tickets for ${drawId}.`)
}

function findTicketEntry(draw, ticket) {
  for (const entry of draw.entries || []) {
    const intervals = Array.isArray(entry.ticketIntervals) ? entry.ticketIntervals : []
    for (const interval of intervals) {
      const start = toPositiveBigInt(interval.start)
      const end = toPositiveBigInt(interval.end)
      if (start > 0n && end >= start && ticket >= start && ticket <= end) {
        return {
          walletAddress: entry.walletAddress || '',
          userAddress: entry.userAddress || entry.walletAddress || '',
          sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
          allocationId: entry.allocationId || interval.allocationId || null,
          roundId: entry.roundId || '',
          matchId: entry.matchId || draw.matchId || '',
          teamId: entry.teamId || '',
          rank: entry.rank ?? null,
          interval: {
            start: String(interval.start),
            end: String(interval.end),
            source: interval.source || null,
            allocationId: interval.allocationId || entry.allocationId || null,
          },
        }
      }
    }
  }
  return null
}

function winnerDetail({ draw, ticket, prizeSlotIndex, revealIndex }) {
  const entry = findTicketEntry(draw, ticket)
  if (!entry) throw new Error(`Winner ticket ${ticket} is missing from ${draw.matchId} ledger entries.`)
  return {
    revealIndex,
    prizeSlotIndex,
    ticketNumber: ticket.toString(),
    walletAddress: entry.walletAddress,
    userAddress: entry.userAddress,
    sourceAddresses: entry.sourceAddresses,
    allocationId: entry.allocationId,
    roundId: entry.roundId,
    matchId: entry.matchId,
    teamId: entry.teamId,
    entryRank: entry.rank,
    interval: entry.interval,
  }
}

function createDrawWinners({ generatedAtIso, matchDrawLedger, seed, videoUrl }) {
  const winners = []
  const winnersBySlot = []
  const draws = []

  for (const draw of matchDrawLedger.draws) {
    const drawId = drawIdFromMatchId(draw.matchId)
    const totalTickets = toPositiveBigInt(draw.totalTickets)
    const prizeSlotCount = Number(draw.prizeSlotCount || 0)
    const { randomWord, randomWordSalt, winnerTicketsBySlot } = findLocalDrawOutcome({
      seed,
      drawId,
      ledgerHash: draw.ledgerHash,
      totalTickets,
      prizeSlotCount,
    })
    const revealedPrizeSlots = Array.from({ length: prizeSlotCount }, (_, index) => index)
    const revealedTickets = revealedPrizeSlots.map((slotIndex) => winnerTicketsBySlot[slotIndex])

    const drawWinnersBySlot = winnerTicketsBySlot.map((ticket, prizeSlotIndex) => (
      winnerDetail({
        draw,
        ticket,
        prizeSlotIndex,
        revealIndex: winners.length + prizeSlotIndex,
      })
    ))
    const drawWinnersByReveal = revealedTickets.map((ticket, index) => (
      winnerDetail({
        draw,
        ticket,
        prizeSlotIndex: revealedPrizeSlots[index],
        revealIndex: winners.length + index,
      })
    ))

    winners.push(...drawWinnersByReveal)
    winnersBySlot.push(...drawWinnersBySlot)
    draws.push({
      matchId: draw.matchId,
      roundId: draw.roundId,
      drawId,
      ledgerHash: draw.ledgerHash,
      ledgerUri: draw.ledgerUri,
      totalTickets: String(draw.totalTickets),
      prizeSlotCount: String(draw.prizeSlotCount),
      randomWord: randomWord.toString(),
      randomWordSalt,
      winnerTicketsBySlot: winnerTicketsBySlot.map((ticket) => ticket.toString()),
      revealedPrizeSlots: revealedPrizeSlots.map(String),
    })
  }

  return {
    version: 1,
    mode: 'draw-winners',
    sourceLabel: 'contract-compatible-local-demo',
    sourceStatus: 'revealed',
    localOnly: true,
    generatedAt: generatedAtIso,
    generatedAtUnix: Math.floor(Date.parse(generatedAtIso) / 1000),
    videoUrl,
    network: 'local-demo',
    chainId: 'local-demo',
    contract: 'contract-compatible-local-simulator',
    matchId: 'round16',
    drawId: 'round16-local-demo',
    ledgerHash: snapshotHash({
      version: 'round16-local-demo-winners-v1',
      seed,
      draws: draws.map((draw) => ({
        matchId: draw.matchId,
        ledgerHash: draw.ledgerHash,
        winnerTicketsBySlot: draw.winnerTicketsBySlot,
      })),
    }),
    totalTickets: String(matchDrawLedger.draws.reduce((sum, draw) => sum + Number(draw.totalTickets || 0), 0)),
    prizeSlotCount: String(matchDrawLedger.draws.reduce((sum, draw) => sum + Number(draw.prizeSlotCount || 0), 0)),
    winnerCount: winners.length,
    fulfilled: true,
    contractFormula: {
      implementation: '_drawUniqueTicket(seed, drawId, pickIndex, nonce)',
      solidityEncoding: 'abi.encode(uint256 seed, bytes32 drawId, uint256 pickIndex, uint256 nonce)',
      duplicateHandling: 'increment nonce until the ticket has not already been selected for that draw',
      seedSource: 'keccak256(local demo seed, drawId, ledgerHash, salt)',
      localSaltSearch: 'demo script searches for a randomWord that satisfies the contract uniqueness loop for tiny 2-ticket pools',
    },
    draws,
    revealedPrizeSlots: winners.map((winner) => `${winner.matchId}:${winner.prizeSlotIndex}`),
    winners,
    winnersBySlot,
  }
}

async function main() {
  if (hasFlag('--help')) {
    printHelp()
    return
  }

  const dataDir = normalizeDataDir(argValue('--data-dir') || process.env.SOCCER_LOCAL_DATA_DIR)
  assertSafeLocalDataDir(dataDir)
  const generatedAtIso = new Date().toISOString()
  const prizeSlots = readPositiveInteger(argValue('--prize-slots'), DEFAULT_PRIZE_SLOTS_PER_MATCH)
  const votersPerMatch = readPositiveInteger(argValue('--voters-per-match'), prizeSlots)
  if (votersPerMatch < prizeSlots) {
    throw new Error(`voters-per-match (${votersPerMatch}) must be >= prize-slots (${prizeSlots}).`)
  }
  const seed = argValue('--seed') || process.env.SOCCER_LOCAL_DRAW_DEMO_SEED || DEFAULT_SEED
  const videoUrl = argValue('--video-url') || process.env.WINNER_REVEAL_VIDEO_URL || DEFAULT_WINNER_REVEAL_VIDEO_URL

  const paths = {
    dataDir,
    ledgerPath: join(dataDir, 'lucky-draw-ledger.json'),
    votesDir: join(dataDir, 'votes'),
    voteDbPath: join(dataDir, 'votes/vote-store.sqlite'),
    voteStatePath: join(dataDir, 'votes/vote-state.json'),
    votePreviewPath: join(dataDir, 'votes/vote-preview.json'),
    matchResultsPath: join(dataDir, 'match-results.json'),
    matchDrawLedgerPath: join(dataDir, 'match-draw-ledger.json'),
    drawWinnersPath: join(dataDir, 'draw-winners.json'),
  }
  mkdirSync(paths.votesDir, { recursive: true })

  const matches = campaignMatches.filter((match) => match.roundId === 'round16')
  if (matches.length !== 8) throw new Error(`Expected 8 Round of 16 matches, found ${matches.length}.`)

  const allocations = createAllocations({ generatedAtIso, matches, votersPerMatch })
  const baseLedger = createBaseLedger({ generatedAtIso, allocations })
  const matchResults = createMatchResults({ generatedAtIso, matches })

  writeJsonAtomic(paths.ledgerPath, baseLedger)
  writeJsonAtomic(paths.matchResultsPath, matchResults)
  const voteSeed = replaceSqliteVoteState({
    dbPath: paths.voteDbPath,
    allocations,
    statePath: paths.voteStatePath,
    previewPath: paths.votePreviewPath,
    matchResults,
  })

  const matchDrawLedger = buildMatchDrawLedger({
    baseLedgerPath: paths.ledgerPath,
    voteStore: 'sqlite',
    voteDbPath: paths.voteDbPath,
    voteStatePath: paths.voteStatePath,
    matchResultsPath: paths.matchResultsPath,
    out: paths.matchDrawLedgerPath,
    matchId: '',
    prizeSlotCount: prizeSlots,
    ledgerUriBase: '/match-draw-ledger.json',
    dryRun: false,
  })
  writeJsonAtomic(paths.matchDrawLedgerPath, matchDrawLedger)

  const drawWinners = createDrawWinners({
    generatedAtIso,
    matchDrawLedger,
    seed,
    videoUrl,
  })
  writeJsonAtomic(paths.drawWinnersPath, drawWinners)

  console.log(JSON.stringify({
    ok: true,
    mode: 'local-round16-demo',
    localOnly: true,
    dataDir: paths.dataDir,
    prizeSlotsPerMatch: prizeSlots,
    votersPerMatch,
    matchCount: matches.length,
    fakeAllocationCount: allocations.length,
    drawCount: matchDrawLedger.draws.length,
    winnerCount: drawWinners.winnerCount,
    files: {
      ledger: paths.ledgerPath,
      voteDb: paths.voteDbPath,
      voteState: paths.voteStatePath,
      votePreview: paths.votePreviewPath,
      matchResults: paths.matchResultsPath,
      matchDrawLedger: paths.matchDrawLedgerPath,
      drawWinners: paths.drawWinnersPath,
    },
    voteSnapshot: voteSeed.snapshot,
    notes: [
      'Local demo uses fake vote allocations and local-only confirmed result fixtures.',
      'Production still requires backend FIFA-confirmed match-results and on-chain reveal snapshots.',
    ],
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
