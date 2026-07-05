import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'

import { writeJsonAtomic } from './soccer-match-results.mjs'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function loadEnvFile(envFilePath) {
  const envFile = new URL(`../${envFilePath}`, import.meta.url)
  if (!existsSync(envFile)) return {}
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

function required(env, key) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function jsonStringify(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  )
}

function normalizeBytes32(value) {
  const text = String(value || '').trim()
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text.toLowerCase() : ''
}

function resolveOutputPath(path) {
  const value = String(path || '').trim()
  if (!value) return ''
  return value.startsWith('/') ? value : resolve(repoRoot, value)
}

function readFirstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== '') return source[key]
  }
  return undefined
}

function roundRowsFromLedger(ledger) {
  const candidates = [
    ledger.roundDraws,
    ledger.round_draws,
    ledger.rounds,
    ledger.round ? [ledger.round] : null,
  ]
  return candidates.find((value) => Array.isArray(value)) || []
}

function drawRowsFromLedger(ledger) {
  const candidates = [
    ledger.draws,
    ledger.matchDraws,
    ledger.match_draws,
    ledger.draw ? [ledger.draw] : null,
  ]
  return candidates.find((value) => Array.isArray(value)) || []
}

function normalizePositiveBigInt(value, label) {
  try {
    const result = BigInt(value || 0)
    if (result <= 0n) throw new Error()
    return result
  } catch {
    throw new Error(`${label} must be a positive integer.`)
  }
}

function normalizePositiveInteger(value, label) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive integer.`)
  return Math.floor(number)
}

function resolveRoundIdentity({ ledger, env }) {
  const rows = roundRowsFromLedger(ledger)
  const requestedRoundId =
    argValue('--round-id') ||
    env.DRAW_ROUND_ID ||
    ledger.roundId ||
    ledger.round_id ||
    (rows.length === 1 ? rows[0].roundId || rows[0].round_id || rows[0].id : '') ||
    ''
  const requestedRoundKey =
    normalizeBytes32(argValue('--round-key')) ||
    normalizeBytes32(env.DRAW_ROUND_KEY) ||
    normalizeBytes32(ledger.roundKey) ||
    normalizeBytes32(ledger.round_key) ||
    ''

  if (!requestedRoundId && !requestedRoundKey) {
    throw new Error('Round identity is required. Pass --round-id <id> or --round-key <bytes32>.')
  }

  return { roundId: String(requestedRoundId || '').trim(), roundKey: requestedRoundKey }
}

function findRoundRow(rows, roundId, roundKey) {
  return rows.find((row) => {
    const rowRoundId = String(row.roundId || row.round_id || row.id || '').trim()
    const rowRoundKey = normalizeBytes32(row.roundKey) || normalizeBytes32(row.round_key) || normalizeBytes32(row.drawId)
    return (roundKey && rowRoundKey === roundKey) || (roundId && rowRoundId === roundId)
  }) || null
}

function findMatchDraw(drawRows, matchId) {
  return drawRows.find((row) => String(row.matchId || row.match_id || row.id || '').trim() === matchId) || null
}

function normalizeRoundLedger({ ledger, env, ledgerPath }) {
  const identity = resolveRoundIdentity({ ledger, env })
  const rows = roundRowsFromLedger(ledger)
  const row = findRoundRow(rows, identity.roundId, identity.roundKey)
  if (!row) throw new Error('Ledger must contain a roundDraw row matching this round id/key.')

  const roundId = String(row.roundId || row.round_id || identity.roundId || '').trim()
  const roundKey = normalizeBytes32(identity.roundKey) || normalizeBytes32(row.roundKey) || normalizeBytes32(row.round_key)
  const ledgerHash = String(readFirstDefined(row, ['ledgerHash', 'ledger_hash', 'hash']) || '')
  const ledgerUri = String(readFirstDefined(row, ['ledgerUri', 'ledger_uri', 'uri']) || `${ledgerPath}#${roundId || roundKey}`)
  const matchRows = Array.isArray(row.matches) ? row.matches : []
  const drawRows = drawRowsFromLedger(ledger)

  if (!roundId) throw new Error('roundId is required in the round draw ledger.')
  if (!normalizeBytes32(roundKey)) throw new Error('roundKey must be bytes32.')
  if (!/^0x[a-fA-F0-9]{64}$/.test(ledgerHash)) throw new Error('round ledgerHash must be bytes32.')
  if (matchRows.length === 0) throw new Error('round draw ledger must include matches.')

  const matches = matchRows.map((matchRow) => {
    const matchId = String(matchRow.matchId || matchRow.match_id || '').trim()
    if (!matchId) throw new Error('round match row is missing matchId.')
    const drawRow = findMatchDraw(drawRows, matchId)
    if (!drawRow) throw new Error(`round match ${matchId} is missing its per-match draw row.`)
    const matchKey = normalizeBytes32(matchRow.matchKey) || normalizeBytes32(matchRow.match_key)
    const matchLedgerHash = String(readFirstDefined(matchRow, ['ledgerHash', 'ledger_hash', 'hash']) || drawRow.ledgerHash || '')
    const totalTickets = normalizePositiveBigInt(
      readFirstDefined(matchRow, ['totalTickets', 'total_tickets']) || drawRow.totalTickets,
      `totalTickets for ${matchId}`,
    )
    const prizeSlotCount = normalizePositiveBigInt(
      readFirstDefined(matchRow, ['prizeSlotCount', 'prize_slot_count', 'prizeCount', 'prize_count']) || drawRow.prizeSlotCount,
      `prizeSlotCount for ${matchId}`,
    )
    const alternateCount = normalizePositiveBigInt(
      readFirstDefined(matchRow, ['alternateCount', 'alternate_count', 'alternates']) || drawRow.alternateCount,
      `alternateCount for ${matchId}`,
    )
    const requiredTickets = prizeSlotCount * (alternateCount + 1n)
    if (!normalizeBytes32(matchKey)) throw new Error(`matchKey for ${matchId} must be bytes32.`)
    if (!/^0x[a-fA-F0-9]{64}$/.test(matchLedgerHash)) throw new Error(`ledgerHash for ${matchId} must be bytes32.`)
    if (alternateCount < 2n) throw new Error(`alternateCount for ${matchId} must be at least 2.`)
    if (totalTickets < requiredTickets) {
      throw new Error(`${matchId} has ${totalTickets} tickets, fewer than ${requiredTickets} winner/alternate picks.`)
    }

    return {
      matchId,
      matchKey,
      ledgerHash: matchLedgerHash,
      totalTickets,
      prizeSlotCount,
      alternateCount,
      ledgerUri: String(readFirstDefined(matchRow, ['ledgerUri', 'ledger_uri', 'uri']) || drawRow.ledgerUri || `${ledgerPath}#${matchId}`),
      entries: Array.isArray(drawRow.entries) ? drawRow.entries : [],
      result: drawRow.result || null,
    }
  })

  return {
    roundId,
    roundKey,
    ledgerHash,
    ledgerUri,
    matches,
    matchInputs: matches.map((match) => ({
      matchId: match.matchKey,
      ledgerHash: match.ledgerHash,
      totalTickets: match.totalTickets,
      prizeSlotCount: match.prizeSlotCount,
      alternateCount: match.alternateCount,
      ledgerUri: match.ledgerUri,
    })),
  }
}

function toPositiveBigInt(value) {
  try {
    const result = BigInt(value || 0)
    return result > 0n ? result : 0n
  } catch {
    return 0n
  }
}

function entryIntervals(entry) {
  const explicitIntervals = Array.isArray(entry?.ticketIntervals)
    ? entry.ticketIntervals.map((interval) => ({
        start: toPositiveBigInt(interval?.start),
        end: toPositiveBigInt(interval?.end),
        source: interval?.source || null,
        allocationId: interval?.allocationId || entry?.allocationId || null,
      }))
    : []
  const intervals = explicitIntervals.filter((interval) => interval.start > 0n && interval.end >= interval.start)
  if (intervals.length > 0) return intervals

  const start = toPositiveBigInt(entry?.ticketStart)
  const end = toPositiveBigInt(entry?.ticketEnd)
  return start > 0n && end >= start
    ? [{ start, end, source: 'entry-range', allocationId: entry?.allocationId || null }]
    : []
}

function findTicketEntry(matchLedger, ticketNumber) {
  const ticket = BigInt(ticketNumber)
  for (const entry of matchLedger.entries) {
    for (const interval of entryIntervals(entry)) {
      if (ticket >= interval.start && ticket <= interval.end) {
        return {
          walletAddress: entry.walletAddress || entry.userAddress || '',
          userAddress: entry.userAddress || entry.walletAddress || '',
          sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
          allocationId: entry.allocationId || interval.allocationId || null,
          roundId: entry.roundId || '',
          matchId: entry.matchId || matchLedger.matchId || '',
          teamId: entry.teamId || '',
          rank: entry.rank ?? null,
          interval: {
            start: interval.start.toString(),
            end: interval.end.toString(),
            source: interval.source,
            allocationId: interval.allocationId,
          },
        }
      }
    }
  }
  return null
}

function serializableTicketDetail({ matchLedger, ticket, prizeSlotIndex, revealIndex, role, alternateIndex = null }) {
  const ticketNumber = ticket.toString()
  const entry = findTicketEntry(matchLedger, ticket)
  if (matchLedger.entries.length > 0 && !entry) {
    throw new Error(`${role} ticket ${ticketNumber} in ${matchLedger.matchId} is not present in the match draw ledger.`)
  }
  return {
    revealIndex,
    prizeSlotIndex,
    role,
    alternateIndex,
    ticketNumber,
    walletAddress: entry?.walletAddress || '',
    userAddress: entry?.userAddress || entry?.walletAddress || '',
    sourceAddresses: Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : [],
    allocationId: entry?.allocationId || null,
    roundId: entry?.roundId || '',
    matchId: entry?.matchId || matchLedger.matchId || '',
    teamId: entry?.teamId || '',
    entryRank: entry?.rank ?? null,
    interval: entry?.interval || null,
  }
}

function parseRoundDrawStatus(status) {
  return {
    finalized: Boolean(status.finalized),
    requested: Boolean(status.requested),
    randomnessReady: Boolean(status.randomnessReady),
    fulfilled: Boolean(status.fulfilled),
    ledgerHash: status.currentLedgerHash,
    requestId: status.requestIdValue,
    matchCount: status.matchCount,
    revealedMatchCount: status.revealedMatchCount,
  }
}

function parseRoundMatchStatus(status) {
  return {
    ledgerHash: status.currentLedgerHash,
    ledgerUri: status.currentLedgerUri,
    totalTickets: status.currentTotalTickets,
    prizeSlotCount: status.currentPrizeSlotCount,
    alternateCount: status.currentAlternateCount,
    revealed: Boolean(status.revealed),
  }
}

async function readRoundWinners({ contract, roundLedger }) {
  const draws = []
  const winners = []
  const alternates = []

  for (const matchLedger of roundLedger.matches) {
    const matchStatus = parseRoundMatchStatus(await contract.roundMatchStatus(roundLedger.roundKey, matchLedger.matchKey))
    const winnerTickets = matchStatus.revealed
      ? await contract.roundMatchWinnerTicketsBySlot(roundLedger.roundKey, matchLedger.matchKey)
      : []
    const prizeSlots = []
    for (let slotIndex = 0; slotIndex < winnerTickets.length; slotIndex++) {
      const winner = serializableTicketDetail({
        matchLedger,
        ticket: winnerTickets[slotIndex],
        prizeSlotIndex: slotIndex,
        revealIndex: draws.length,
        role: 'winner',
      })
      const alternateTickets = await contract.roundMatchAlternateTicketsBySlot(roundLedger.roundKey, matchLedger.matchKey, slotIndex)
      const slotAlternates = alternateTickets.map((ticket, alternateIndex) => serializableTicketDetail({
        matchLedger,
        ticket,
        prizeSlotIndex: slotIndex,
        revealIndex: draws.length,
        role: 'alternate',
        alternateIndex,
      }))
      winners.push(winner)
      alternates.push(...slotAlternates)
      prizeSlots.push({
        prizeSlotIndex: slotIndex,
        winner,
        alternates: slotAlternates,
      })
    }

    draws.push({
      matchId: matchLedger.matchId,
      matchKey: matchLedger.matchKey,
      roundId: roundLedger.roundId,
      ledgerHash: matchLedger.ledgerHash,
      ledgerUri: matchLedger.ledgerUri,
      totalTickets: matchLedger.totalTickets.toString(),
      prizeSlotCount: matchLedger.prizeSlotCount.toString(),
      alternateCount: matchLedger.alternateCount.toString(),
      revealed: matchStatus.revealed,
      result: matchLedger.result,
      prizeSlots,
      winners: prizeSlots.map((slot) => slot.winner),
      alternates: prizeSlots.flatMap((slot) => slot.alternates),
    })
  }

  return { draws, winners, alternates }
}

function buildRoundWinnersSnapshot({ env, network, contractAddress, roundLedger, status, roundWinners }) {
  const generatedAt = new Date().toISOString()
  return {
    version: 2,
    mode: 'round-draw-winners',
    sourceLabel: 'on-chain-round-reveal',
    sourceStatus: status.fulfilled ? 'revealed' : 'partial',
    generatedAt,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    videoUrl: env.WINNER_REVEAL_VIDEO_URL || env.VITE_WINNER_REVEAL_VIDEO_URL || '',
    network: network.name || `chain-${network.chainId}`,
    chainId: network.chainId.toString(),
    contract: contractAddress,
    roundId: roundLedger.roundId,
    roundKey: roundLedger.roundKey,
    ledgerHash: roundLedger.ledgerHash,
    ledgerUri: roundLedger.ledgerUri,
    matchCount: roundLedger.matches.length,
    winnerCount: roundWinners.winners.length,
    alternateCount: roundWinners.alternates.length,
    fulfilled: Boolean(status.fulfilled),
    draws: roundWinners.draws,
    winners: roundWinners.winners,
    alternates: roundWinners.alternates,
    notes: [
      'This snapshot is produced from one VRF random word at round level.',
      'Each match keeps an independent 1..N ticket namespace.',
      'Each prize slot has one winner and the configured alternate tickets.',
    ],
  }
}

function writeWinnersSnapshotIfConfigured(path, snapshot) {
  const out = resolveOutputPath(path)
  if (!out) return null
  writeJsonAtomic(out, snapshot)
  return out
}

function plannedStepsForRoundStatus(status, roundLedger, batchSize) {
  const steps = []
  if (!status.finalized) {
    steps.push({
      step: 'finalizeRoundLedger',
      roundId: roundLedger.roundId,
      roundKey: roundLedger.roundKey,
      ledgerHash: roundLedger.ledgerHash,
      matchCount: roundLedger.matches.length,
      ledgerUri: roundLedger.ledgerUri,
    })
  }
  if (!status.requested) steps.push({ step: 'requestRoundDraw', roundKey: roundLedger.roundKey })
  if (status.requested && !status.randomnessReady) {
    steps.push({ step: 'waitForRoundRandomnessReady', roundKey: roundLedger.roundKey })
  }
  if (status.randomnessReady && !status.fulfilled) {
    steps.push({
      step: 'revealRoundMatches',
      roundKey: roundLedger.roundKey,
      matchBatchSize: batchSize,
      matchIds: roundLedger.matches.map((match) => match.matchId),
    })
  }
  return steps
}

async function readRoundDrawStatus(contract, roundKey) {
  try {
    return parseRoundDrawStatus(await contract.roundDrawStatus(roundKey))
  } catch (error) {
    throw new Error(`The target contract does not expose round-level draw APIs. Redeploy the updated RenaissLuckyDraw before running round-level VRF: ${error.message}`)
  }
}

async function waitForRoundRandomnessReady(contract, roundKey, timeoutMs, intervalMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const status = await readRoundDrawStatus(contract, roundKey)
    if (status.randomnessReady || status.fulfilled) return status
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for round VRF fulfillment after ${Math.round(timeoutMs / 1000)} seconds.`)
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || 'config/draw-contract.env.local'
const env = { ...loadEnvFile(envFilePath), ...process.env }
const ledgerPath = argValue('--ledger') || env.LUCKY_DRAW_LEDGER_PATH || env.SOCCER_MATCH_DRAW_LEDGER_PATH || 'public/lucky-draw-ledger.json'
const winnersOutPath = argValue('--winners-out') || env.SOCCER_DRAW_WINNERS_PATH || ''
const contractAddress = argValue('--contract') || env.DRAW_CONTRACT_ADDRESS || ''
const broadcast = hasFlag('--broadcast')
const verifyOnly = hasFlag('--verify-only')
const matchBatchSize = normalizePositiveInteger(argValue('--match-batch-size') || env.DRAW_MATCH_BATCH_SIZE || 1, 'matchBatchSize')

if (!contractAddress) {
  throw new Error('Draw contract address is required. Pass --contract <address> or set DRAW_CONTRACT_ADDRESS.')
}

const ledgerFilePath = resolveOutputPath(ledgerPath)
const ledger = JSON.parse(readFileSync(ledgerFilePath, 'utf8'))
const roundLedger = normalizeRoundLedger({ ledger, env, ledgerPath })
const expectedChainId = BigInt(env.BSC_CHAIN_ID || 56)
const provider = new JsonRpcProvider(required(env, 'BSC_RPC_URL'), Number(expectedChainId))
const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const wallet = broadcast ? new Wallet(required(env, 'BSC_DEPLOYER_PRIVATE_KEY'), provider) : null
const raffle = new Contract(contractAddress, artifact.abi, wallet || provider)
const txs = []
let status = await readRoundDrawStatus(raffle, roundLedger.roundKey)

if (status.finalized) {
  if (status.ledgerHash.toLowerCase() !== roundLedger.ledgerHash.toLowerCase()) {
    throw new Error(`Contract round ledger hash ${status.ledgerHash} does not match ${roundLedger.ledgerHash}.`)
  }
  if (status.matchCount !== BigInt(roundLedger.matches.length)) {
    throw new Error(`Contract match count ${status.matchCount} does not match ${roundLedger.matches.length}.`)
  }
}

if (!broadcast || verifyOnly) {
  const payload = {
    ok: true,
    broadcast: false,
    verifyOnly,
    envFile: envFilePath,
    network: network.name || `chain-${network.chainId}`,
    chainId: network.chainId.toString(),
    contract: contractAddress,
    roundId: roundLedger.roundId,
    roundKey: roundLedger.roundKey,
    ledgerHash: roundLedger.ledgerHash,
    ledgerUri: roundLedger.ledgerUri,
    matchCount: roundLedger.matches.length,
    matchBatchSize,
    status,
    plannedSteps: plannedStepsForRoundStatus(status, roundLedger, matchBatchSize),
    note: 'No transaction was sent. Re-run with --broadcast only after confirming the official round ledger hash, contract, and admin wallet.',
  }

  if (status.randomnessReady || status.fulfilled || status.revealedMatchCount > 0n) {
    const roundWinners = await readRoundWinners({ contract: raffle, roundLedger })
    const winnersSnapshot = buildRoundWinnersSnapshot({
      env,
      network,
      contractAddress,
      roundLedger,
      status,
      roundWinners,
    })
    payload.winnerCount = winnersSnapshot.winnerCount
    payload.alternateCount = winnersSnapshot.alternateCount
    payload.firstDraw = winnersSnapshot.draws[0] || null
    payload.winnersOut = writeWinnersSnapshotIfConfigured(winnersOutPath, winnersSnapshot)
  }

  console.log(jsonStringify(payload))
  process.exit(0)
}

if (!status.finalized) {
  const finalizeTx = await raffle.finalizeRoundLedger(
    roundLedger.roundKey,
    roundLedger.ledgerHash,
    roundLedger.matchInputs,
    roundLedger.ledgerUri,
  )
  txs.push({ step: 'finalizeRoundLedger', hash: finalizeTx.hash })
  await finalizeTx.wait()
  status = await readRoundDrawStatus(raffle, roundLedger.roundKey)
}

if (status.ledgerHash.toLowerCase() !== roundLedger.ledgerHash.toLowerCase()) {
  throw new Error(`Contract round ledger hash ${status.ledgerHash} does not match ${roundLedger.ledgerHash}.`)
}

if (!status.requested) {
  const requestTx = await raffle.requestRoundDraw(roundLedger.roundKey)
  txs.push({ step: 'requestRoundDraw', hash: requestTx.hash })
  await requestTx.wait()
  status = await readRoundDrawStatus(raffle, roundLedger.roundKey)
}

if (!status.randomnessReady && !status.fulfilled) {
  status = await waitForRoundRandomnessReady(
    raffle,
    roundLedger.roundKey,
    Number(argValue('--timeout-ms') || 10 * 60 * 1000),
    10_000,
  )
}

while (!status.fulfilled) {
  const unrevealed = []
  for (const matchLedger of roundLedger.matches) {
    const matchStatus = parseRoundMatchStatus(await raffle.roundMatchStatus(roundLedger.roundKey, matchLedger.matchKey))
    if (!matchStatus.revealed) unrevealed.push(matchLedger)
  }
  if (unrevealed.length === 0) break

  const batch = unrevealed.slice(0, matchBatchSize)
  const matchKeys = batch.map((match) => match.matchKey)
  const tx =
    matchKeys.length === 1
      ? await raffle.revealRoundMatch(roundLedger.roundKey, matchKeys[0])
      : await raffle.revealRoundMatches(roundLedger.roundKey, matchKeys)
  txs.push({
    step: matchKeys.length === 1 ? 'revealRoundMatch' : 'revealRoundMatches',
    matchIds: batch.map((match) => match.matchId),
    hash: tx.hash,
  })
  await tx.wait()
  status = await readRoundDrawStatus(raffle, roundLedger.roundKey)
}

const roundWinners = await readRoundWinners({ contract: raffle, roundLedger })
const winnersSnapshot = buildRoundWinnersSnapshot({
  env,
  network,
  contractAddress,
  roundLedger,
  status,
  roundWinners,
})
const winnersOut = writeWinnersSnapshotIfConfigured(winnersOutPath, winnersSnapshot)

console.log(jsonStringify({
  ok: true,
  broadcast: true,
  envFile: envFilePath,
  network: network.name || `chain-${network.chainId}`,
  chainId: network.chainId.toString(),
  contract: contractAddress,
  roundId: roundLedger.roundId,
  roundKey: roundLedger.roundKey,
  ledgerHash: roundLedger.ledgerHash,
  matchCount: roundLedger.matches.length,
  winnerCount: winnersSnapshot.winnerCount,
  alternateCount: winnersSnapshot.alternateCount,
  fulfilled: winnersSnapshot.fulfilled,
  winnersOut,
  txs,
}))
