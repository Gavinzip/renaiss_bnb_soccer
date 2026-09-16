import { createHash } from 'node:crypto'

import { POKEMON30_EVENT_ID } from './rules.mjs'

const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

function snapshotHash(value) {
  return `0x${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive safe integer.`)
  }
  return number
}

function normaliseAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return ADDRESS_PATTERN.test(address) ? address : ''
}

function normaliseLedgerUri(value) {
  const uri = String(value || '').trim()
  if (!/^https:\/\//i.test(uri) && !/^ipfs:\/\//i.test(uri)) {
    throw new Error('ledgerUri must be an immutable HTTPS or IPFS URL before the draw can be finalized.')
  }
  return uri
}

function requireRepeatWinnerPolicy(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true
  if (value === false || String(value).trim().toLowerCase() === 'false') {
    throw new Error(
      'The existing RenaissLuckyDraw single-draw contract selects unique ticket numbers, not unique wallets. It cannot enforce a no-repeat-winner rule.',
    )
  }
  throw new Error('allowRepeatWinners must be explicitly set to true before creating a VRF draw ledger.')
}

function normaliseSourceEntry(entry, index) {
  const walletAddress = normaliseAddress(entry?.walletAddress)
  if (!walletAddress) throw new Error(`Ticket ledger entry ${index + 1} has an invalid walletAddress.`)

  const tickets = positiveInteger(entry?.tickets, `tickets for ${walletAddress}`)
  const eligibleCheckoutCount = positiveInteger(
    entry?.eligibleCheckoutCount,
    `eligibleCheckoutCount for ${walletAddress}`,
  )
  const packs = entry?.packs
  if (!packs || typeof packs !== 'object' || Array.isArray(packs)) {
    throw new Error(`Ticket ledger entry ${index + 1} has no auditable pack breakdown.`)
  }

  return {
    walletAddress,
    tickets,
    eligibleCheckoutCount,
    packs,
  }
}

function sourceEntriesFromTicketLedger(ticketLedger) {
  if (ticketLedger?.eventId !== POKEMON30_EVENT_ID) {
    throw new Error('Ticket ledger does not belong to the Pokémon 30 campaign.')
  }
  if (ticketLedger?.sourceStatus !== 'ready') {
    throw new Error('Ticket ledger is not reconciled and ready; a VRF draw ledger cannot be created.')
  }
  if (Array.isArray(ticketLedger?.pendingPackConfigurations) && ticketLedger.pendingPackConfigurations.length > 0) {
    throw new Error('Ticket ledger still has pending machine configurations; add each on-chain packId and rebuild the reconciled ledger before creating a VRF draw ledger.')
  }
  if (!Array.isArray(ticketLedger.entries) || ticketLedger.entries.length === 0) {
    throw new Error('Ticket ledger has no eligible entries.')
  }

  const entries = ticketLedger.entries
    .map(normaliseSourceEntry)
    .sort((left, right) => left.walletAddress.localeCompare(right.walletAddress))
  const duplicate = entries.find((entry, index) => index > 0 && entry.walletAddress === entries[index - 1].walletAddress)
  if (duplicate) throw new Error(`Ticket ledger has duplicate wallet entry ${duplicate.walletAddress}.`)

  const totalTickets = entries.reduce((total, entry) => total + entry.tickets, 0)
  if (Number(ticketLedger?.totals?.tickets) !== totalTickets) {
    throw new Error('Ticket ledger totals.tickets does not match the eligible entries.')
  }
  if (Number(ticketLedger?.totals?.wallets) !== entries.length) {
    throw new Error('Ticket ledger totals.wallets does not match the eligible entries.')
  }
  if (!/^[a-f0-9]{64}$/i.test(String(ticketLedger?.ledgerHash || ''))) {
    throw new Error('Ticket ledger has an invalid reconciliation hash.')
  }

  return { entries, totalTickets }
}

export function buildPokemon30DrawLedger({
  ticketLedger,
  ticketLedgerPath = '',
  prizeSlotCount,
  allowRepeatWinners,
  ledgerUri,
  drawLabel = POKEMON30_EVENT_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  const { entries: sourceEntries, totalTickets } = sourceEntriesFromTicketLedger(ticketLedger)
  const resolvedPrizeSlotCount = positiveInteger(prizeSlotCount, 'prizeSlotCount')
  requireRepeatWinnerPolicy(allowRepeatWinners)
  const resolvedLedgerUri = normaliseLedgerUri(ledgerUri)
  const resolvedDrawLabel = String(drawLabel || '').trim()
  if (!resolvedDrawLabel) throw new Error('drawLabel is required.')
  if (totalTickets < resolvedPrizeSlotCount) {
    throw new Error(`The reconciled pool has ${totalTickets} tickets, fewer than the requested ${resolvedPrizeSlotCount} prize slots.`)
  }

  let cursor = 0
  const entries = sourceEntries.map((entry, index) => {
    const ticketStart = cursor + 1
    const ticketEnd = cursor + entry.tickets
    cursor = ticketEnd
    return {
      rank: index + 1,
      walletAddress: entry.walletAddress,
      userAddress: entry.walletAddress,
      sourceAddresses: [entry.walletAddress],
      eligibleTickets: entry.tickets,
      eligibleCheckoutCount: entry.eligibleCheckoutCount,
      packBreakdown: entry.packs,
      ticketStart,
      ticketEnd,
      ticketIntervals: [
        {
          start: ticketStart,
          end: ticketEnd,
          namespace: 'pokemon30-raffle',
          source: 'vrf-v3-checkout-buyback-threshold-reconciliation',
        },
      ],
    }
  })

  const drawId = snapshotHash({ type: 'pokemon30-draw-id', eventId: POKEMON30_EVENT_ID, drawLabel: resolvedDrawLabel })
  const hashPayload = {
    version: 1,
    eventId: POKEMON30_EVENT_ID,
    drawId,
    drawLabel: resolvedDrawLabel,
    sourceTicketLedgerHash: ticketLedger.ledgerHash,
    prizeSlotCount: resolvedPrizeSlotCount,
    winnerPolicy: 'repeat-wallet-winners-permitted',
    totalTickets,
    entries: entries.map((entry) => ({
      walletAddress: entry.walletAddress,
      eligibleTickets: entry.eligibleTickets,
      eligibleCheckoutCount: entry.eligibleCheckoutCount,
      packBreakdown: entry.packBreakdown,
      ticketStart: entry.ticketStart,
      ticketEnd: entry.ticketEnd,
    })),
  }
  const ledgerHash = snapshotHash(hashPayload)
  const draw = {
    drawId,
    drawLabel: resolvedDrawLabel,
    ledgerHash,
    totalTickets,
    prizeSlotCount: resolvedPrizeSlotCount,
    ledgerUri: resolvedLedgerUri,
    sourceMode: 'pokemon30-vrf-v3-buyback-threshold-reconciled-ledger',
    winnerPolicy: 'repeat-wallet-winners-permitted',
    eligibleEntryCount: entries.length,
    eligibleWalletCount: entries.length,
    entries,
    hashPayload,
  }

  return {
    version: 1,
    mode: 'pokemon30-draw-ledger',
    eventId: POKEMON30_EVENT_ID,
    sourceStatus: 'ready',
    candidateSourceLimited: false,
    generatedAt,
    generatedAtUnix: Math.floor(Date.parse(generatedAt) / 1000),
    drawId,
    drawLabel: resolvedDrawLabel,
    sourceTicketLedger: {
      path: ticketLedgerPath || null,
      generatedAt: ticketLedger.generatedAt || null,
      ledgerHash: ticketLedger.ledgerHash,
      totalTickets,
      totalWallets: entries.length,
    },
    policy: {
      prizeSlotCount: resolvedPrizeSlotCount,
      repeatWalletWinners: true,
      note: 'The current RenaissLuckyDraw single-draw contract guarantees unique ticket numbers, not unique wallet addresses.',
    },
    draws: [draw],
    notes: [
      'This draw ledger is generated only from a fully reconciled Pokémon 30 ticket ledger.',
      'Each ticket number belongs to exactly one contiguous wallet interval.',
      'No purchase-only CheckoutSuccess record can enter this ledger without its authoritative per-checkout buyback value.',
      'This file does not send a transaction; finalization, VRF request, and winner revelation remain explicit contract-admin actions.',
    ],
  }
}
