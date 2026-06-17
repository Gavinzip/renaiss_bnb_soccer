import { existsSync, readFileSync } from 'node:fs'
import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)

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
  const allowGlobalLedger = hasFlag('--allow-global-ledger')
  if (!row && !allowGlobalLedger) {
    throw new Error(
      'Ledger must contain a per-match draw row matching this drawId/matchId. Use --allow-global-ledger only for legacy diagnostics.',
    )
  }

  const source = row || ledger
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
    sourceMode: row ? 'per-match-ledger' : 'legacy-global-ledger-diagnostic',
  }
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
const contractAddress = argValue('--contract') || env.DRAW_CONTRACT_ADDRESS || ''
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
const wallet = new Wallet(required(env, 'BSC_DEPLOYER_PRIVATE_KEY'), provider)
const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const raffle = new Contract(contractAddress, artifact.abi, wallet)
const txs = []

let status = parseRoundStatus(await raffle.roundStatus(drawLedger.drawId))
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
}

let state = Number(await raffle.state(drawLedger.drawId))
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

console.log(
  JSON.stringify(
    {
      ok: true,
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
      revealedPrizeSlots: revealedPrizeSlots.map((slot) => slot.toString()),
      revealedTickets,
      txs,
      balanceBNB: ethers.formatEther(await provider.getBalance(wallet.address)),
    },
    null,
    2,
  ),
)
