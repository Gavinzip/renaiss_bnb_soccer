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
const DEFAULT_PRIZE_SLOTS_PER_MATCH = 1
const DEFAULT_ALTERNATE_COUNT = 2

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage:
  node scripts/seed-local-round16-demo.mjs [--data-dir <path>] [--prize-slots 1] [--alternates 2] [--voters-per-match 3] [--seed <text>]

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

function bytes32Id(value) {
  return ethers.id(String(value || '').trim()).toLowerCase()
}

function localRoundRandomWord({ seed, roundKey, roundLedgerHash, salt = 0 }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'bytes32', 'bytes32', 'uint256'],
    [seed, roundKey, roundLedgerHash, BigInt(salt)],
  )
  return BigInt(ethers.keccak256(encoded))
}

function localRoundMatchSeed({ randomWord, roundKey, matchKey, ledgerHash }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes32', 'bytes32'],
    [randomWord, roundKey, matchKey, ledgerHash],
  )
  return BigInt(ethers.keccak256(encoded))
}

function drawUniqueRoundTickets({ matchSeed, totalTickets, pickCount }) {
  const tickets = []
  for (let pickIndex = 0; pickIndex < pickCount; pickIndex += 1) {
    let selected = 0n
    for (let nonce = 0n; nonce < totalTickets; nonce += 1n) {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'uint256'],
        [matchSeed, BigInt(pickIndex), nonce],
      )
      const candidate = (BigInt(ethers.keccak256(encoded)) % totalTickets) + 1n
      if (!tickets.includes(candidate)) {
        selected = candidate
        break
      }
    }
    if (selected === 0n) throw new Error(`Could not draw a unique ticket for pick ${pickIndex}.`)
    tickets.push(selected)
  }
  return tickets
}

function findLocalDrawOutcome({ seed, roundKey, roundLedgerHash, matchKey, ledgerHash, totalTickets, pickCount }) {
  for (let salt = 0; salt < 10000; salt += 1) {
    const randomWord = localRoundRandomWord({ seed, roundKey, roundLedgerHash, salt })
    const matchSeed = localRoundMatchSeed({ randomWord, roundKey, matchKey, ledgerHash })
    try {
      return {
        randomWord,
        randomWordSalt: salt,
        pickedTickets: drawUniqueRoundTickets({ matchSeed, totalTickets, pickCount }),
      }
    } catch (error) {
      if (!String(error?.message || '').includes('Could not draw a unique ticket')) throw error
    }
  }
  throw new Error(`Could not find a local randomWord that produces ${pickCount} unique tickets for ${matchKey}.`)
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

function winnerDetail({ draw, ticket, prizeSlotIndex, revealIndex, role = 'winner', alternateIndex = null }) {
  const entry = findTicketEntry(draw, ticket)
  if (!entry) throw new Error(`${role} ticket ${ticket} is missing from ${draw.matchId} ledger entries.`)
  return {
    revealIndex,
    prizeSlotIndex,
    role,
    alternateIndex,
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

  const roundDraw = matchDrawLedger.roundDraws[0]
  const roundKey = roundDraw?.roundKey || bytes32Id('round16')
  const roundLedgerHash = roundDraw?.ledgerHash || bytes32Id('round16-local-demo-ledger')

  for (const draw of matchDrawLedger.draws) {
    const matchRow = roundDraw?.matches?.find((row) => row.matchId === draw.matchId)
    const matchKey = matchRow?.matchKey || bytes32Id(draw.matchId)
    const totalTickets = toPositiveBigInt(draw.totalTickets)
    const prizeSlotCount = Number(draw.prizeSlotCount || 0)
    const alternateCount = Number(draw.alternateCount || 0)
    const pickCount = prizeSlotCount * (alternateCount + 1)
    const { randomWord, randomWordSalt, pickedTickets } = findLocalDrawOutcome({
      seed,
      roundKey,
      roundLedgerHash,
      matchKey,
      ledgerHash: draw.ledgerHash,
      totalTickets,
      pickCount,
    })
    const winnerTicketsBySlot = []
    const alternateTicketsBySlot = []
    for (let slotIndex = 0; slotIndex < prizeSlotCount; slotIndex += 1) {
      const offset = slotIndex * (alternateCount + 1)
      winnerTicketsBySlot.push(pickedTickets[offset])
      alternateTicketsBySlot.push(pickedTickets.slice(offset + 1, offset + 1 + alternateCount))
    }
    const revealedPrizeSlots = Array.from({ length: prizeSlotCount }, (_, index) => index)
    const revealedTickets = revealedPrizeSlots.map((slotIndex) => winnerTicketsBySlot[slotIndex])

    const prizeSlots = winnerTicketsBySlot.map((ticket, prizeSlotIndex) => {
      const winner = winnerDetail({
        draw,
        ticket,
        prizeSlotIndex,
        revealIndex: winners.length + prizeSlotIndex,
      })
      const alternates = alternateTicketsBySlot[prizeSlotIndex].map((alternateTicket, alternateIndex) => (
        winnerDetail({
          draw,
          ticket: alternateTicket,
          prizeSlotIndex,
          revealIndex: winners.length + prizeSlotIndex,
          role: 'alternate',
          alternateIndex,
        })
      ))
      return { prizeSlotIndex, winner, alternates }
    })
    const drawWinnersBySlot = prizeSlots.map((slot) => slot.winner)
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
    const drawAlternates = prizeSlots.flatMap((slot) => slot.alternates)
    draws.push({
      matchId: draw.matchId,
      matchKey,
      roundId: draw.roundId,
      drawId: matchKey,
      ledgerHash: draw.ledgerHash,
      ledgerUri: draw.ledgerUri,
      totalTickets: String(draw.totalTickets),
      prizeSlotCount: String(draw.prizeSlotCount),
      alternateCount: String(draw.alternateCount),
      randomWord: randomWord.toString(),
      randomWordSalt,
      winnerTicketsBySlot: winnerTicketsBySlot.map((ticket) => ticket.toString()),
      alternateTicketsBySlot: alternateTicketsBySlot.map((slot) => slot.map((ticket) => ticket.toString())),
      revealedPrizeSlots: revealedPrizeSlots.map(String),
      revealed: true,
      prizeSlots,
      winners: drawWinnersBySlot,
      alternates: drawAlternates,
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
    alternateCount: draws.reduce((sum, draw) => sum + draw.alternates.length, 0),
    fulfilled: true,
    contractFormula: {
      implementation: '_drawUniqueRoundTicket(matchDraw, seed, pickIndex)',
      solidityEncoding: 'round seed = abi.encode(randomWord, roundId, matchId, ledgerHash); ticket = abi.encode(seed, pickIndex, nonce)',
      duplicateHandling: 'increment nonce until the ticket has not already been selected for that match draw',
      seedSource: 'local randomWord is keccak256(local demo seed, roundKey, roundLedgerHash, salt)',
      localSaltSearch: 'demo script searches for a randomWord that satisfies the contract uniqueness loop for small local pools',
    },
    draws,
    revealedPrizeSlots: winners.map((winner) => `${winner.matchId}:${winner.prizeSlotIndex}`),
    winners,
    winnersBySlot,
    alternates: draws.flatMap((draw) => draw.alternates),
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
  const alternateCount = readPositiveInteger(argValue('--alternates'), DEFAULT_ALTERNATE_COUNT)
  const minimumVotersPerMatch = prizeSlots * (alternateCount + 1)
  const votersPerMatch = readPositiveInteger(argValue('--voters-per-match'), minimumVotersPerMatch)
  if (votersPerMatch < minimumVotersPerMatch) {
    throw new Error(`voters-per-match (${votersPerMatch}) must be >= prize-slots * (alternates + 1) (${minimumVotersPerMatch}).`)
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
    alternateCount,
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
    alternatesPerPrizeSlot: alternateCount,
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
