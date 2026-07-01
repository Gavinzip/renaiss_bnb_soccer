import { existsSync, readFileSync } from 'node:fs'

import { normalizeAddress } from './utils.mjs'

export const DEFAULT_CARRYOVER_LEDGER_URL = 'https://renaiss-vangogh.zeabur.app/lucky-draw-ledger.json'
export const DEFAULT_CARRYOVER_DIVISOR = 3

export function toTicketInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

export async function readCarryoverLedgerPayload(args) {
  if (args.skipCarryoverLedger) {
    return {
      payload: null,
      source: {
        enabled: false,
        mode: 'disabled',
        divisor: args.carryoverDivisor,
        reason: 'disabled_by_option',
      },
    }
  }

  if (args.carryoverLedgerPath) {
    if (!existsSync(args.carryoverLedgerPath)) {
      throw new Error(`Carryover ledger file does not exist: ${args.carryoverLedgerPath}`)
    }
    return {
      payload: JSON.parse(readFileSync(args.carryoverLedgerPath, 'utf8')),
      source: {
        enabled: true,
        mode: 'file',
        path: args.carryoverLedgerPath,
        divisor: args.carryoverDivisor,
      },
    }
  }

  if (!args.carryoverLedgerUrl) {
    throw new Error('Previous campaign carryover ledger URL is not configured.')
  }

  const response = await fetch(args.carryoverLedgerUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'renaiss-worldcup-carryover-ledger/0.1.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Previous campaign carryover ledger returned HTTP ${response.status}.`)
  }

  return {
    payload: await response.json(),
    source: {
      enabled: true,
      mode: 'url',
      url: args.carryoverLedgerUrl,
      divisor: args.carryoverDivisor,
    },
  }
}

export function carryoverEntryAddresses(entry) {
  return [
    entry?.userAddress,
    ...(Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : []),
  ].map(normalizeAddress).filter(Boolean)
}

export function entryFinalTickets(entry) {
  return toTicketInteger(entry?.finalTickets ?? entry?.final_tickets)
}

export function buildCarryoverTicketPlan(carryoverLedger, walletMigrationMap, divisor = DEFAULT_CARRYOVER_DIVISOR) {
  const source = {
    ...(carryoverLedger.source || {}),
    campaignStart: carryoverLedger.payload?.campaignStart ?? null,
    campaignEnd: carryoverLedger.payload?.campaignEnd ?? null,
    generatedAt: carryoverLedger.payload?.generatedAt ?? null,
    ledgerHash: carryoverLedger.payload?.ledgerHash || null,
    previousTotalEntries: Number(carryoverLedger.payload?.totalEntries || 0) || 0,
    previousTotalFinalTickets: Number(carryoverLedger.payload?.totalFinalTickets || 0) || 0,
    matchedPreviousEntries: 0,
    previousWallets: 0,
    totalPreviousFinalTickets: 0,
    totalCarryoverTicketsAvailable: 0,
  }
  const previousFinalTicketsByWallet = new Map()
  const sourceAddressesByWallet = new Map()
  if (!carryoverLedger.payload) {
    return {
      source,
      ticketsByWallet: new Map(),
      previousFinalTicketsByWallet,
      sourceAddressesByWallet,
    }
  }

  const rows = Array.isArray(carryoverLedger.payload.entries) ? carryoverLedger.payload.entries : []
  for (const entry of rows) {
    const finalTickets = entryFinalTickets(entry)
    if (finalTickets <= 0) continue

    const addresses = carryoverEntryAddresses(entry)
    const canonicalAddress = normalizeAddress(
      addresses.map((address) => walletMigrationMap.get(address) || address).find(Boolean),
    )
    if (!canonicalAddress) continue

    previousFinalTicketsByWallet.set(canonicalAddress, (previousFinalTicketsByWallet.get(canonicalAddress) || 0) + finalTickets)
    const sourceAddresses = sourceAddressesByWallet.get(canonicalAddress) || new Set()
    for (const address of addresses) sourceAddresses.add(address)
    sourceAddresses.add(canonicalAddress)
    sourceAddressesByWallet.set(canonicalAddress, sourceAddresses)
    source.matchedPreviousEntries += 1
    source.totalPreviousFinalTickets += finalTickets
  }

  const safeDivisor = Math.max(1, Math.floor(Number(divisor || DEFAULT_CARRYOVER_DIVISOR) || DEFAULT_CARRYOVER_DIVISOR))
  const ticketsByWallet = new Map()
  for (const [walletAddress, previousFinalTickets] of previousFinalTicketsByWallet.entries()) {
    const carryoverTickets = Math.floor(previousFinalTickets / safeDivisor)
    if (carryoverTickets <= 0) continue
    ticketsByWallet.set(walletAddress, carryoverTickets)
    source.totalCarryoverTicketsAvailable += carryoverTickets
  }

  source.previousWallets = previousFinalTicketsByWallet.size

  return {
    source,
    ticketsByWallet,
    previousFinalTicketsByWallet,
    sourceAddressesByWallet,
  }
}

export function applyCarryoverTickets(entriesByAddress, carryoverLedger, walletMigrationMap, options = {}) {
  const plan = buildCarryoverTicketPlan(carryoverLedger, walletMigrationMap, options.divisor)
  const source = {
    ...plan.source,
    appliedWallets: 0,
    totalCarryoverTickets: 0,
  }

  if (options.replace) {
    for (const entry of entriesByAddress.values()) {
      const previousCarryoverTickets = toTicketInteger(entry.carryoverTickets ?? entry.carryover_tickets)
      const rawTickets = toTicketInteger(
        entry.rawTickets ?? entry.raw_tickets ?? Math.max(0, toTicketInteger(entry.finalTickets) - previousCarryoverTickets),
      )
      const insiderPracticeTickets = toTicketInteger(entry.insiderPracticeTickets ?? entry.insider_practice_tickets)
      const insiderGrantTickets = toTicketInteger(entry.insiderGrantTickets ?? entry.insider_grant_tickets)
      entry.rawTickets = rawTickets
      entry.bonusTickets = 0
      entry.carryoverTickets = 0
      entry.insiderPracticeTickets = insiderPracticeTickets
      entry.insiderGrantTickets = insiderGrantTickets
      entry.finalTickets = rawTickets
      entry.totalVotingTickets = rawTickets + insiderPracticeTickets + insiderGrantTickets
    }
  }

  for (const [walletAddress, carryoverTickets] of plan.ticketsByWallet.entries()) {
    const sourceAddresses = plan.sourceAddressesByWallet.get(walletAddress) || new Set([walletAddress])
    const existing = entriesByAddress.get(walletAddress)
    const entry = existing || options.createEntry?.(walletAddress, sourceAddresses)
    if (!entry) continue

    const previousCarryoverTickets = toTicketInteger(entry.carryoverTickets ?? entry.carryover_tickets)
    const rawTickets = toTicketInteger(
      entry.rawTickets ?? entry.raw_tickets ?? Math.max(0, toTicketInteger(entry.finalTickets) - previousCarryoverTickets),
    )
    const nextCarryoverTickets = (options.replace ? 0 : previousCarryoverTickets) + carryoverTickets
    const insiderPracticeTickets = toTicketInteger(entry.insiderPracticeTickets ?? entry.insider_practice_tickets)
    const insiderGrantTickets = toTicketInteger(entry.insiderGrantTickets ?? entry.insider_grant_tickets)

    entry.sourceAddresses = [...new Set([
      ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : []),
      ...sourceAddresses,
      walletAddress,
    ].map(normalizeAddress).filter(Boolean))].sort()
    entry.rawTickets = rawTickets
    entry.bonusTickets = 0
    entry.carryoverTickets = nextCarryoverTickets
    entry.insiderPracticeTickets = insiderPracticeTickets
    entry.insiderGrantTickets = insiderGrantTickets
    entry.finalTickets = rawTickets + nextCarryoverTickets
    entry.totalVotingTickets = entry.finalTickets + insiderPracticeTickets + insiderGrantTickets
    entriesByAddress.set(walletAddress, entry)
    source.appliedWallets += 1
    source.totalCarryoverTickets += carryoverTickets
  }

  return source
}
