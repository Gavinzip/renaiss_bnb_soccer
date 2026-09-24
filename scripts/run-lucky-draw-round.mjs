import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'

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

function parseRoundStatus(status) {
  return {
    finalized: status.finalized,
    requested: status.requested,
    fulfilled: status.fulfilled,
    totalTickets: status.currentTotalTickets,
    firstWinningTicket: status.firstWinningTicket,
    ledgerHash: status.currentLedgerHash,
    prizeSlotCount: status.currentPrizeSlotCount,
    winnerCount: status.winnerCount,
  }
}

function jsonStringify(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  )
}

function resolveOutputPath(path) {
  const value = String(path || '').trim()
  if (!value) return ''
  return value.startsWith('/') ? value : resolve(repoRoot, value)
}

function parseRevealOrder(rawValue, prizeSlotCount) {
  const slotCount = Number(prizeSlotCount)
  if (!rawValue) return Array.from({ length: slotCount }, (_, index) => index)

  const slots = rawValue
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value))
  const uniqueSlots = new Set(slots)
  if (slots.length !== uniqueSlots.size) throw new Error('reveal order contains duplicate prize slots.')
  for (const slot of slots) {
    if (slot < 0 || slot >= slotCount) throw new Error(`reveal order slot out of range: ${slot}`)
  }

  return [
    ...slots,
    ...Array.from({ length: slotCount }, (_, index) => index).filter((slot) => !uniqueSlots.has(slot)),
  ]
}

function normalizeBytes32(value) {
  const text = String(value || '').trim()
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text.toLowerCase() : ''
}

function drawIdFromMatchId(matchId) {
  const normalized = String(matchId || '').trim()
  return normalized ? ethers.id(normalized).toLowerCase() : ''
}

function resolveDrawIdentity({ ledger, env }) {
  const requestedMatchId =
    argValue('--match-id') ||
    env.DRAW_MATCH_ID ||
    ledger.matchId ||
    ledger.match_id ||
    ledger.draw?.matchId ||
    ledger.draw?.match_id ||
    ''
  const requestedDrawId =
    normalizeBytes32(argValue('--draw-id')) ||
    normalizeBytes32(env.DRAW_ID) ||
    normalizeBytes32(ledger.drawId) ||
    normalizeBytes32(ledger.draw_id) ||
    normalizeBytes32(ledger.draw?.drawId) ||
    normalizeBytes32(ledger.draw?.draw_id) ||
    ''
  const drawId = requestedDrawId || drawIdFromMatchId(requestedMatchId)
  if (!drawId) {
    throw new Error('Draw identity is required. Pass --match-id <id>, --draw-id <bytes32>, or set DRAW_MATCH_ID/DRAW_ID.')
  }
  return { matchId: requestedMatchId || '', drawId }
}

function drawRowsFromLedger(ledger) {
  const candidates = [
    ledger.draws,
    ledger.matchDraws,
    ledger.match_draws,
    ledger.roundDraws,
    ledger.round_draws,
    ledger.draw ? [ledger.draw] : null,
  ]
  return candidates.find((value) => Array.isArray(value)) || []
}

function matchesDraw(row, matchId, drawId) {
  if (!row || typeof row !== 'object') return false
  const rowDrawId =
    normalizeBytes32(row.drawId) ||
    normalizeBytes32(row.draw_id) ||
    drawIdFromMatchId(row.matchId || row.match_id || row.id)
  const rowMatchId = String(row.matchId || row.match_id || row.id || '').trim()
  return rowDrawId === drawId || (matchId && rowMatchId === matchId)
}

function findLedgerDraw(ledger, matchId, drawId) {
  const rows = drawRowsFromLedger(ledger)
  return rows.find((row) => matchesDraw(row, matchId, drawId)) || null
}

function readFirstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== '') return source[key]
  }
  return undefined
}

function normalizeDrawLedger({ ledger, matchId, drawId, env, ledgerPath }) {
  const row = findLedgerDraw(ledger, matchId, drawId)
  if (!row) throw new Error('Ledger must contain a per-match draw row matching this drawId/matchId.')

  const source = row
  const ledgerHash = String(readFirstDefined(source, ['ledgerHash', 'ledger_hash', 'hash']) || '')
  const totalTickets = BigInt(readFirstDefined(source, [
    'totalTickets',
    'total_tickets',
    'eligibleTickets',
    'eligible_tickets',
    'totalFinalTickets',
    'total_final_tickets',
  ]) || 0)
  const prizeSlotCount = BigInt(
    argValue('--prize-slots') ||
      readFirstDefined(source, ['prizeSlotCount', 'prize_slot_count', 'prizeCount', 'prize_count']) ||
      (Array.isArray(source.prizes) ? source.prizes.length : 0) ||
      env.INITIAL_PRIZE_SLOT_COUNT ||
      0,
  )
  const ledgerUri = String(
    readFirstDefined(source, ['ledgerUri', 'ledger_uri', 'uri']) ||
      `${ledgerPath}${matchId ? `#${matchId}` : `#${drawId}`}`,
  )
  const candidateSourceLimited = Boolean(source.candidateSourceLimited || source.candidate_source_limited)

  if (!/^0x[a-fA-F0-9]{64}$/.test(ledgerHash)) throw new Error('ledgerHash must be bytes32')
  if (candidateSourceLimited) throw new Error('cannot run draw round with a limited candidate ledger')
  if (prizeSlotCount <= 0n) throw new Error('prizeSlotCount must be positive')
  if (totalTickets < prizeSlotCount) throw new Error('ledger total tickets must cover all prize slots')

  return {
    matchId,
    drawId,
    ledgerHash,
    totalTickets,
    prizeSlotCount,
    ledgerUri,
    sourceMode: 'per-match-ledger',
    entries: Array.isArray(source.entries) ? source.entries : [],
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

function findTicketEntry(drawLedger, ticketNumber) {
  const ticket = BigInt(ticketNumber)
  for (const entry of drawLedger.entries) {
    for (const interval of entryIntervals(entry)) {
      if (ticket >= interval.start && ticket <= interval.end) {
        return {
          walletAddress: entry.walletAddress || entry.userAddress || '',
          userAddress: entry.userAddress || entry.walletAddress || '',
          sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
          allocationId: entry.allocationId || interval.allocationId || null,
          roundId: entry.roundId || '',
          matchId: entry.matchId || drawLedger.matchId || '',
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

function buildWinnerDetails(drawLedger, winnerTicketsBySlot, revealedPrizeSlots, revealedTickets) {
  const detailsBySlot = winnerTicketsBySlot.map((ticket, slotIndex) => {
    const ticketNumber = ticket.toString()
    const entry = ticket === 0n ? null : findTicketEntry(drawLedger, ticket)
    if (drawLedger.entries.length > 0 && ticket !== 0n && !entry) {
      throw new Error(`winner ticket ${ticketNumber} in prize slot ${slotIndex} is not present in the match draw ledger.`)
    }
    return {
      prizeSlotIndex: slotIndex,
      ticketNumber,
      entry,
    }
  })
  const detailsByReveal = revealedTickets.map((ticket, revealIndex) => {
    const ticketNumber = ticket.toString()
    const entry = findTicketEntry(drawLedger, ticket)
    if (drawLedger.entries.length > 0 && !entry) {
      throw new Error(`revealed winner ticket ${ticketNumber} at reveal ${revealIndex} is not present in the match draw ledger.`)
    }
    return {
      revealIndex,
      prizeSlotIndex: Number(revealedPrizeSlots[revealIndex]),
      ticketNumber,
      entry,
    }
  })
  return { detailsBySlot, detailsByReveal }
}

function serializableWinnerDetail(detail) {
  const entry = detail.entry || null
  return {
    revealIndex: detail.revealIndex ?? null,
    prizeSlotIndex: detail.prizeSlotIndex,
    ticketNumber: String(detail.ticketNumber),
    walletAddress: entry?.walletAddress || '',
    userAddress: entry?.userAddress || entry?.walletAddress || '',
    sourceAddresses: Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : [],
    allocationId: entry?.allocationId || null,
    roundId: entry?.roundId || '',
    matchId: entry?.matchId || '',
    teamId: entry?.teamId || '',
    entryRank: entry?.rank ?? null,
    interval: entry?.interval || null,
  }
}

function buildWinnersSnapshot({ env, network, contractAddress, drawLedger, status, winnerDetails, revealedPrizeSlots }) {
  const generatedAt = new Date().toISOString()
  return {
    version: 1,
    mode: 'draw-winners',
    sourceLabel: 'on-chain-reveal',
    sourceStatus: 'revealed',
    generatedAt,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    videoUrl: env.WINNER_REVEAL_VIDEO_URL || env.VITE_WINNER_REVEAL_VIDEO_URL || '',
    network: network.name || `chain-${network.chainId}`,
    chainId: network.chainId.toString(),
    contract: contractAddress,
    matchId: drawLedger.matchId,
    drawId: drawLedger.drawId,
    ledgerHash: drawLedger.ledgerHash,
    ledgerUri: drawLedger.ledgerUri,
    totalTickets: drawLedger.totalTickets.toString(),
    prizeSlotCount: drawLedger.prizeSlotCount.toString(),
    winnerCount: winnerDetails.detailsByReveal.length,
    fulfilled: Boolean(status.fulfilled),
    revealedPrizeSlots: revealedPrizeSlots.map((slot) => slot.toString()),
    winners: winnerDetails.detailsByReveal.map(serializableWinnerDetail),
    winnersBySlot: winnerDetails.detailsBySlot.map(serializableWinnerDetail),
  }
}

function writeWinnersSnapshotIfConfigured(path, snapshot) {
  const out = resolveOutputPath(path)
  if (!out) return null
  writeJsonAtomic(out, snapshot)
  return out
}

function plannedStepsForStatus(status, state, drawLedger, revealOrder, batchSize) {
  const steps = []
  if (!status.finalized) {
    steps.push({
      step: 'finalizeLedger',
      drawId: drawLedger.drawId,
      ledgerHash: drawLedger.ledgerHash,
      totalTickets: drawLedger.totalTickets.toString(),
      prizeSlotCount: drawLedger.prizeSlotCount.toString(),
      ledgerUri: drawLedger.ledgerUri,
    })
  }
  if (!status.requested) steps.push({ step: 'requestDraw', drawId: drawLedger.drawId })
  if (state === 2) steps.push({ step: 'waitForRandomnessReady', drawId: drawLedger.drawId })
  if (state >= 3 && !status.fulfilled && status.winnerCount < drawLedger.prizeSlotCount) {
    steps.push({
      step: 'revealPrizeSlots',
      drawId: drawLedger.drawId,
      batchSize,
      revealOrder,
      remainingSlots: (drawLedger.prizeSlotCount - status.winnerCount).toString(),
    })
  }
  return steps
}

async function waitForRandomnessReady(contract, drawId, timeoutMs, intervalMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = Number(await contract.state(drawId))
    if (state >= 3) return state
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for VRF fulfillment after ${Math.round(timeoutMs / 1000)} seconds.`)
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || 'config/draw-contract.env.local'
const env = { ...loadEnvFile(envFilePath), ...process.env }
const ledgerPath = argValue('--ledger') || env.LUCKY_DRAW_LEDGER_PATH || 'public/lucky-draw-ledger.json'
const winnersOutPath = argValue('--winners-out') || env.SOCCER_DRAW_WINNERS_PATH || ''
const contractAddress = argValue('--contract') || env.DRAW_CONTRACT_ADDRESS || ''
const broadcast = hasFlag('--broadcast')
const verifyOnly = hasFlag('--verify-only')
if (!contractAddress) {
  throw new Error('Draw contract address is required. Pass --contract <address> or set DRAW_CONTRACT_ADDRESS.')
}

const ledger = JSON.parse(readFileSync(new URL(`../${ledgerPath}`, import.meta.url), 'utf8'))
const identity = resolveDrawIdentity({ ledger, env })
const drawLedger = normalizeDrawLedger({ ledger, env, ledgerPath, ...identity })
const batchSize = Math.max(1, Number(argValue('--batch-size') || env.DRAW_BATCH_SIZE || 1))
const revealOrder = parseRevealOrder(argValue('--reveal-order') || env.DRAW_REVEAL_ORDER || '', drawLedger.prizeSlotCount)

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

let status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
let state = Number(await raffle.state(drawLedger.drawId))

if (status.finalized) {
  if (status.ledgerHash.toLowerCase() !== drawLedger.ledgerHash.toLowerCase()) {
    throw new Error(`Contract ledger hash ${status.ledgerHash} does not match ${drawLedger.ledgerHash}.`)
  }
  if (status.totalTickets !== drawLedger.totalTickets) {
    throw new Error(`Contract total tickets ${status.totalTickets} does not match ${drawLedger.totalTickets}.`)
  }
  if (status.prizeSlotCount !== drawLedger.prizeSlotCount) {
    throw new Error(`Contract prize slots ${status.prizeSlotCount} does not match ${drawLedger.prizeSlotCount}.`)
  }
}

if (!broadcast || verifyOnly) {
  const plan = plannedStepsForStatus(status, state, drawLedger, revealOrder, batchSize)
  const payload = {
    ok: true,
    broadcast: false,
    verifyOnly,
    envFile: envFilePath,
    network: network.name || `chain-${network.chainId}`,
    chainId: network.chainId.toString(),
    contract: contractAddress,
    matchId: drawLedger.matchId,
    drawId: drawLedger.drawId,
    ledgerHash: drawLedger.ledgerHash,
    ledgerUri: drawLedger.ledgerUri,
    ledgerSourceMode: drawLedger.sourceMode,
    totalTickets: drawLedger.totalTickets.toString(),
    prizeSlotCount: drawLedger.prizeSlotCount.toString(),
    batchSize,
    revealOrder,
    state,
    status,
    plannedSteps: plan,
    note: plan.length
      ? 'No transaction was sent. Re-run with --broadcast only after confirming the official result, ledger hash, total tickets, prize slots, contract, and admin wallet.'
      : 'No transaction is needed for the current chain state.',
  }

  if (state === 4 || status.fulfilled) {
    const winnerTicketsBySlot = await raffle.winnerTicketsBySlot(drawLedger.drawId)
    const revealedPrizeSlots = await raffle.revealedPrizeSlots(drawLedger.drawId)
    const storedRevealedTickets = await raffle.revealedTickets(drawLedger.drawId)
    const winnerDetails = buildWinnerDetails(drawLedger, winnerTicketsBySlot, revealedPrizeSlots, storedRevealedTickets)
    const winnersSnapshot = buildWinnersSnapshot({
      env,
      network,
      contractAddress,
      drawLedger,
      status,
      winnerDetails,
      revealedPrizeSlots,
    })
    const winnersOut = writeWinnersSnapshotIfConfigured(winnersOutPath, winnersSnapshot)
    payload.winnerCount = winnerTicketsBySlot.length
    payload.firstFiveWinnerTicketsBySlot = winnerTicketsBySlot.slice(0, 5).map((ticket) => ticket.toString())
    payload.firstFiveWinnerDetailsBySlot = winnerDetails.detailsBySlot.slice(0, 5)
    payload.revealedPrizeSlots = revealedPrizeSlots.map((slot) => slot.toString())
    payload.firstFiveRevealedWinnerDetails = winnerDetails.detailsByReveal.slice(0, 5)
    payload.winnersOut = winnersOut
  }

  console.log(jsonStringify(payload))
  process.exit(0)
}

if (!status.finalized) {
  const finalizeTx = await raffle.finalizeLedger(
    drawLedger.drawId,
    drawLedger.ledgerHash,
    drawLedger.totalTickets,
    drawLedger.prizeSlotCount,
    drawLedger.ledgerUri,
  )
  txs.push({ step: 'finalizeLedger', hash: finalizeTx.hash })
  await finalizeTx.wait()
  status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
  state = Number(await raffle.state(drawLedger.drawId))
}

if (status.ledgerHash.toLowerCase() !== drawLedger.ledgerHash.toLowerCase()) {
  throw new Error(`Contract ledger hash ${status.ledgerHash} does not match ${drawLedger.ledgerHash}.`)
}
if (status.totalTickets !== drawLedger.totalTickets) {
  throw new Error(`Contract total tickets ${status.totalTickets} does not match ${drawLedger.totalTickets}.`)
}
if (status.prizeSlotCount !== drawLedger.prizeSlotCount) {
  throw new Error(`Contract prize slots ${status.prizeSlotCount} does not match ${drawLedger.prizeSlotCount}.`)
}

if (!status.requested) {
  const requestTx = await raffle.requestDraw(drawLedger.drawId)
  txs.push({ step: 'requestDraw', hash: requestTx.hash })
  await requestTx.wait()
  status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
  state = Number(await raffle.state(drawLedger.drawId))
}

if (state === 2) {
  state = await waitForRandomnessReady(
    raffle,
    drawLedger.drawId,
    Number(argValue('--timeout-ms') || 10 * 60 * 1000),
    10_000,
  )
}
if (state < 3) throw new Error(`Round is not ready for drawPrizeSlot. Current state: ${state}`)

status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
const revealedTickets = []
let revealedPrizeSlots = await raffle.revealedPrizeSlots(drawLedger.drawId)
while (!status.fulfilled && status.winnerCount < drawLedger.prizeSlotCount) {
  const alreadyRevealed = new Set(revealedPrizeSlots.map((slot) => Number(slot)))
  const nextPrizeSlots = revealOrder
    .filter((slot) => !alreadyRevealed.has(slot))
    .slice(0, Math.min(batchSize, Number(drawLedger.prizeSlotCount - status.winnerCount)))
  if (nextPrizeSlots.length === 0) throw new Error('no remaining prize slots to reveal.')

  const drawTx =
    nextPrizeSlots.length === 1
      ? await raffle.drawPrizeSlot(drawLedger.drawId, nextPrizeSlots[0])
      : await raffle.drawPrizeSlots(drawLedger.drawId, nextPrizeSlots)
  const receipt = await drawTx.wait()
  const parsedLogs = receipt.logs
    .map((log) => {
      try {
        return raffle.interface.parseLog(log)
      } catch {
        return null
      }
    })
  const winnerEvents = parsedLogs.filter((event) => event?.name === 'PrizeWinnerDrawn')
  if (winnerEvents.length !== nextPrizeSlots.length) {
    throw new Error(`expected ${nextPrizeSlots.length} PrizeWinnerDrawn events, got ${winnerEvents.length}.`)
  }
  for (let index = 0; index < winnerEvents.length; index++) {
    const winnerEvent = winnerEvents[index]
    if (winnerEvent.args.drawId.toLowerCase() !== drawLedger.drawId.toLowerCase()) {
      throw new Error(`expected drawId ${drawLedger.drawId}, got ${winnerEvent.args.drawId}.`)
    }
    if (Number(winnerEvent.args.prizeSlotIndex) !== nextPrizeSlots[index]) {
      throw new Error(`expected prize slot ${nextPrizeSlots[index]}, got ${winnerEvent.args.prizeSlotIndex}.`)
    }
    revealedTickets.push(winnerEvent.args.ticketNumber.toString())
  }
  txs.push({
    step: nextPrizeSlots.length === 1 ? 'drawPrizeSlot' : 'drawPrizeSlots',
    count: nextPrizeSlots.length,
    prizeSlotIndexes: winnerEvents.map((event) => event.args.prizeSlotIndex.toString()),
    revealIndexes: winnerEvents.map((event) => event.args.revealIndex.toString()),
    ticketNumbers: winnerEvents.map((event) => event.args.ticketNumber.toString()),
    hash: drawTx.hash,
  })
  status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
  revealedPrizeSlots = await raffle.revealedPrizeSlots(drawLedger.drawId)
}

const winnerTicketsBySlot = await raffle.winnerTicketsBySlot(drawLedger.drawId)
revealedPrizeSlots = await raffle.revealedPrizeSlots(drawLedger.drawId)
const storedRevealedTickets = await raffle.revealedTickets(drawLedger.drawId)
const winnerTickets = await raffle.winnerTickets(drawLedger.drawId)
const unique = new Set(winnerTicketsBySlot.map((ticket) => ticket.toString()))
if (winnerTicketsBySlot.length !== Number(drawLedger.prizeSlotCount)) {
  throw new Error(`expected ${drawLedger.prizeSlotCount} slot winners, got ${winnerTicketsBySlot.length}`)
}
if (storedRevealedTickets.length !== Number(drawLedger.prizeSlotCount)) {
  throw new Error(`expected ${drawLedger.prizeSlotCount} revealed winners, got ${storedRevealedTickets.length}`)
}
if (revealedPrizeSlots.length !== Number(drawLedger.prizeSlotCount)) {
  throw new Error(`expected ${drawLedger.prizeSlotCount} revealed prize slots, got ${revealedPrizeSlots.length}`)
}
if (unique.size !== Number(drawLedger.prizeSlotCount)) throw new Error('winner tickets are not globally unique inside this draw')
for (const ticket of winnerTicketsBySlot) {
  if (ticket < 1n || ticket > drawLedger.totalTickets) throw new Error(`winner ticket out of range: ${ticket}`)
}
for (let revealIndex = 0; revealIndex < Number(drawLedger.prizeSlotCount); revealIndex++) {
  const prizeSlotIndex = Number(revealedPrizeSlots[revealIndex])
  if (winnerTickets[revealIndex] !== storedRevealedTickets[revealIndex]) {
    throw new Error(`legacy winnerTickets mismatch at reveal ${revealIndex}`)
  }
  if (storedRevealedTickets[revealIndex] !== winnerTicketsBySlot[prizeSlotIndex]) {
    throw new Error(`reveal/slot winner mismatch at reveal ${revealIndex}`)
  }
}
const winnerDetails = buildWinnerDetails(drawLedger, winnerTicketsBySlot, revealedPrizeSlots, storedRevealedTickets)
const winnersSnapshot = buildWinnersSnapshot({
  env,
  network,
  contractAddress,
  drawLedger,
  status,
  winnerDetails,
  revealedPrizeSlots,
})
const winnersOut = writeWinnersSnapshotIfConfigured(winnersOutPath, winnersSnapshot)

console.log(
  jsonStringify(
    {
      ok: true,
      broadcast: true,
      envFile: envFilePath,
      network: network.name || `chain-${network.chainId}`,
      chainId: network.chainId.toString(),
      contract: contractAddress,
      matchId: drawLedger.matchId,
      drawId: drawLedger.drawId,
      ledgerHash: drawLedger.ledgerHash,
      ledgerUri: drawLedger.ledgerUri,
      ledgerSourceMode: drawLedger.sourceMode,
      totalTickets: drawLedger.totalTickets.toString(),
      prizeSlotCount: drawLedger.prizeSlotCount.toString(),
      batchSize,
      revealOrder,
      winnerCount: winnerTicketsBySlot.length,
      firstFiveWinnerTicketsBySlot: winnerTicketsBySlot.slice(0, 5).map((ticket) => ticket.toString()),
      firstFiveRevealedTickets: storedRevealedTickets.slice(0, 5).map((ticket) => ticket.toString()),
      firstFiveWinnerDetailsBySlot: winnerDetails.detailsBySlot.slice(0, 5),
      firstFiveRevealedWinnerDetails: winnerDetails.detailsByReveal.slice(0, 5),
      revealedPrizeSlots: revealedPrizeSlots.map((slot) => slot.toString()),
      revealedTickets,
      winnersOut,
      txs,
      balanceBNB: wallet ? ethers.formatEther(await provider.getBalance(wallet.address)) : null,
    },
  ),
)
