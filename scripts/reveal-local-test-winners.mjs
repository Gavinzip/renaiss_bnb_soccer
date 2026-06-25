#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ethers } from 'ethers'

import { DEFAULT_WINNER_REVEAL_VIDEO_URL } from '../src/app/data/winnerRevealRuntime.js'
import { snapshotHash, writeJsonAtomic } from './soccer-match-results.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_DATA_DIR = join(repoRoot, '.local-data/soccer-test-batch')
const DEFAULT_SEED = 'renaiss-local-test-winners-2026'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage:
  node scripts/reveal-local-test-winners.mjs [--data-dir <path>] [--match-draw-ledger <path>] [--out <path>] [--seed <text>]

Creates a local-only revealed draw-winners.json from an existing match-draw-ledger.json.
This is for UI and flow testing only. It does not submit transactions or replace on-chain reveal.
`)
}

function resolvePath(value, fallback) {
  const path = String(value || fallback).trim()
  return path.startsWith('/') ? path : resolve(repoRoot, path)
}

function assertSafeLocalOutPath(outPath) {
  const productionDataDir = resolve('/data/soccer')
  if ((outPath === productionDataDir || outPath.startsWith(`${productionDataDir}/`)) && !hasFlag('--allow-production-path')) {
    throw new Error('Refusing to write /data/soccer. Choose a local test data dir.')
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
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

function findRoundDrawForMatch(matchDrawLedger, draw) {
  return (Array.isArray(matchDrawLedger.roundDraws) ? matchDrawLedger.roundDraws : [])
    .find((roundDraw) => (
      roundDraw.roundId === draw.roundId
      || (Array.isArray(roundDraw.matches) && roundDraw.matches.some((match) => match.matchId === draw.matchId))
    ))
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
          roundId: entry.roundId || draw.roundId || '',
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
    id: `${draw.matchId}-${role}-${prizeSlotIndex}-${ticket}`,
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

  for (const draw of matchDrawLedger.draws || []) {
    const roundDraw = findRoundDrawForMatch(matchDrawLedger, draw)
    const matchRow = roundDraw?.matches?.find((row) => row.matchId === draw.matchId)
    const roundKey = roundDraw?.roundKey || bytes32Id(draw.roundId || 'round')
    const roundLedgerHash = roundDraw?.ledgerHash || bytes32Id(`${draw.roundId || 'round'}-local-ledger`)
    const matchKey = matchRow?.matchKey || bytes32Id(draw.matchId)
    const totalTickets = toPositiveBigInt(draw.totalTickets)
    const prizeSlotCount = Number(draw.prizeSlotCount || 0)
    const alternateCount = Number(draw.alternateCount || 0)
    const pickCount = prizeSlotCount * (alternateCount + 1)
    if (totalTickets <= 0n || pickCount <= 0) continue

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
    const drawWinnersByReveal = revealedPrizeSlots.map((slotIndex, index) => (
      winnerDetail({
        draw,
        ticket: winnerTicketsBySlot[slotIndex],
        prizeSlotIndex: slotIndex,
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
      drawId: draw.drawId || draw.matchId,
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
    sourceLabel: 'contract-compatible-local-simulation',
    sourceStatus: 'revealed',
    localOnly: true,
    generatedAt: generatedAtIso,
    generatedAtUnix: Math.floor(Date.parse(generatedAtIso) / 1000),
    videoUrl,
    network: 'local-simulation',
    chainId: 'local-simulation',
    contract: 'contract-compatible-local-simulator',
    matchId: draws.length === 1 ? draws[0].matchId : '',
    drawId: 'local-simulation',
    ledgerHash: snapshotHash({
      version: 'local-simulation-winners-v1',
      seed,
      draws: draws.map((draw) => ({
        matchId: draw.matchId,
        ledgerHash: draw.ledgerHash,
        winnerTicketsBySlot: draw.winnerTicketsBySlot,
      })),
    }),
    totalTickets: String((matchDrawLedger.draws || []).reduce((sum, draw) => sum + Number(draw.totalTickets || 0), 0)),
    prizeSlotCount: String((matchDrawLedger.draws || []).reduce((sum, draw) => sum + Number(draw.prizeSlotCount || 0), 0)),
    winnerCount: winners.length,
    alternateCount: draws.reduce((sum, draw) => sum + draw.alternates.length, 0),
    fulfilled: true,
    contractFormula: {
      implementation: '_drawUniqueRoundTicket(matchDraw, seed, pickIndex)',
      solidityEncoding: 'round seed = abi.encode(randomWord, roundId, matchId, ledgerHash); ticket = abi.encode(seed, pickIndex, nonce)',
      duplicateHandling: 'increment nonce until the ticket has not already been selected for that match draw',
      seedSource: 'local randomWord is keccak256(local simulation seed, roundKey, roundLedgerHash, salt)',
      localSaltSearch: 'script searches for a randomWord that satisfies the contract uniqueness loop for small local pools',
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

  const dataDir = resolvePath(argValue('--data-dir') || process.env.SOCCER_LOCAL_DATA_DIR || process.env.SOCCER_TEST_BATCH_DATA_DIR, DEFAULT_DATA_DIR)
  const matchDrawLedgerPath = resolvePath(argValue('--match-draw-ledger') || process.env.SOCCER_MATCH_DRAW_LEDGER_PATH, join(dataDir, 'match-draw-ledger.json'))
  const outPath = resolvePath(argValue('--out') || process.env.SOCCER_DRAW_WINNERS_PATH, join(dataDir, 'draw-winners.json'))
  assertSafeLocalOutPath(outPath)
  mkdirSync(dirname(outPath), { recursive: true })

  const seed = argValue('--seed') || process.env.SOCCER_LOCAL_REVEAL_SEED || DEFAULT_SEED
  const generatedAtIso = new Date().toISOString()
  const videoUrl = argValue('--video-url') || process.env.WINNER_REVEAL_VIDEO_URL || DEFAULT_WINNER_REVEAL_VIDEO_URL
  const matchDrawLedger = readJson(matchDrawLedgerPath, 'match draw ledger')
  const drawWinners = createDrawWinners({ generatedAtIso, matchDrawLedger, seed, videoUrl })
  writeJsonAtomic(outPath, drawWinners)

  console.log(JSON.stringify({
    ok: true,
    localOnly: true,
    sourceLabel: drawWinners.sourceLabel,
    sourceStatus: drawWinners.sourceStatus,
    seed,
    matchDrawLedgerPath,
    outPath,
    drawCount: drawWinners.draws.length,
    winnerCount: drawWinners.winnerCount,
    firstWinner: drawWinners.winners[0] || null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
