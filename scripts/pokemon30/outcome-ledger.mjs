import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { formatUsdCents, formatUsdtWei, parseUsdtWei } from './buyback-value.mjs'
import { POKEMON30_EVENT_END, POKEMON30_EVENT_ID, POKEMON30_EVENT_START } from './rules.mjs'

const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i
const CHECKOUT_ID_PATTERN = /^0x[a-f0-9]{64}$/i

function cleanText(value) {
  return String(value ?? '').trim()
}

function normaliseAddress(value) {
  const address = cleanText(value).toLowerCase()
  return ADDRESS_PATTERN.test(address) ? address : ''
}

function normaliseCheckoutId(value) {
  const checkoutId = cleanText(value).toLowerCase()
  return CHECKOUT_ID_PATTERN.test(checkoutId) ? checkoutId : ''
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function ledgerHash(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function normaliseCheckoutBuybackLink(row) {
  const checkoutId = normaliseCheckoutId(row?.checkoutId || row?.checkout_id)
  const walletAddress = normaliseAddress(row?.walletAddress || row?.wallet_address || row?.user)
  const packId = cleanText(row?.packId || row?.pack_id).toLowerCase()
  const tier = cleanText(row?.tier || row?.resultTier || row?.result_tier)
  const buybackId = normaliseCheckoutId(row?.buybackId || row?.buyback_id)
  const openedAt = Number(row?.openedAt || row?.opened_at || 0)
  const source = cleanText(row?.source)

  if (!checkoutId || !walletAddress || !packId || !buybackId || !Number.isInteger(openedAt) || openedAt <= 0 || !source) {
    return null
  }
  return { checkoutId, walletAddress, packId, tier: tier || null, buybackId, openedAt, source }
}

export function readPokemon30CheckoutBuybackLinks(path) {
  if (!path || !existsSync(path)) {
    throw Object.assign(new Error('Authoritative checkout-to-buyback link file is not configured or does not exist.'), {
      code: 'pokemon30_checkout_buyback_links_missing',
    })
  }
  const payload = JSON.parse(readFileSync(path, 'utf8'))
  const rows = Array.isArray(payload) ? payload : payload?.checkoutBuybackLinks
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('Checkout-to-buyback link file must be an array or contain a checkoutBuybackLinks array.'), {
      code: 'pokemon30_checkout_buyback_links_invalid_shape',
    })
  }
  return rows
}

function normaliseBuyback(row) {
  const buybackId = normaliseCheckoutId(row?.buybackId || row?.buyback_id)
  const walletAddress = normaliseAddress(row?.walletAddress || row?.wallet_address || row?.user)
  const amountWei = parseUsdtWei(row?.amountWei ?? row?.amount_wei)
  const timestamp = Number(row?.timestamp || 0)
  if (!buybackId || !walletAddress || amountWei === null || !Number.isInteger(timestamp) || timestamp <= 0) return null
  return { buybackId, walletAddress, amountWei, timestamp }
}

function summariseEntries(entries) {
  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      packs: Object.fromEntries([...entry.packs.entries()].sort(([left], [right]) => left.localeCompare(right))),
    }))
    .sort((left, right) => left.walletAddress.localeCompare(right.walletAddress))
}

function normalisePendingPackConfigurations(configurations) {
  if (!Array.isArray(configurations)) return []
  return configurations
    .map((configuration) => ({
      id: cleanText(configuration?.id),
      label: cleanText(configuration?.label),
      price: cleanText(configuration?.price),
      reason: cleanText(configuration?.reason),
      lowestTierBbbvMax: cleanText(configuration?.lowestTierBbbvMax),
      lowestTierBuybackPayoutMax: cleanText(configuration?.lowestTierBuybackPayoutMax),
      buybackPayoutBasisPoints: Number(configuration?.buybackPayoutBasisPoints),
      ticketWeight: Number(configuration?.ticketWeight),
    }))
    .filter((configuration) => configuration.id && configuration.price && configuration.reason)
    .sort((left, right) => left.price.localeCompare(right.price))
}

export function reconcilePokemon30Tickets({
  purchases,
  checkoutBuybackLinks,
  buybacks,
  packs,
  pendingPackConfigurations = [],
  generatedAt = Math.floor(Date.now() / 1000),
}) {
  const packById = new Map(packs.map((pack) => [pack.packId, pack]))
  const linkByCheckoutId = new Map()
  const buybackById = new Map()
  const invalidLinks = []

  for (const row of checkoutBuybackLinks || []) {
    const link = normaliseCheckoutBuybackLink(row)
    if (!link) {
      invalidLinks.push({ reason: 'checkout_buyback_link_shape_invalid' })
      continue
    }
    if (linkByCheckoutId.has(link.checkoutId)) {
      invalidLinks.push({ checkoutId: link.checkoutId, reason: 'checkout_buyback_link_checkout_duplicate' })
      continue
    }
    linkByCheckoutId.set(link.checkoutId, link)
  }

  for (const row of buybacks || []) {
    const buyback = normaliseBuyback(row)
    if (!buyback) {
      invalidLinks.push({ reason: 'onchain_buyback_shape_invalid' })
      continue
    }
    if (buybackById.has(buyback.buybackId)) {
      invalidLinks.push({ buybackId: buyback.buybackId, reason: 'onchain_buyback_id_duplicate' })
      continue
    }
    buybackById.set(buyback.buybackId, buyback)
  }

  const entries = new Map()
  const unresolved = []
  const invalid = [...invalidLinks]
  const seenPurchaseCheckoutIds = new Set()
  const seenLinkedBuybackIds = new Set()
  let matchedCheckoutCount = 0
  let eligibleCheckoutCount = 0

  for (const purchase of purchases) {
    const pack = packById.get(cleanText(purchase?.packId).toLowerCase())
    const walletAddress = normaliseAddress(purchase?.walletAddress)
    const checkoutIds = Array.isArray(purchase?.checkoutIds) ? purchase.checkoutIds.map(normaliseCheckoutId).filter(Boolean) : []
    if (!pack || !walletAddress || checkoutIds.length === 0) {
      invalid.push({ txHash: cleanText(purchase?.txHash), reason: 'purchase_shape_invalid_or_pack_unconfigured' })
      continue
    }

    for (const checkoutId of checkoutIds) {
      if (seenPurchaseCheckoutIds.has(checkoutId)) {
        invalid.push({ checkoutId, reason: 'purchase_checkout_duplicate' })
        continue
      }
      seenPurchaseCheckoutIds.add(checkoutId)
      const link = linkByCheckoutId.get(checkoutId)
      if (!link) {
        unresolved.push({ checkoutId, walletAddress, packId: pack.packId, reason: 'checkout_buyback_link_missing' })
        continue
      }
      if (link.walletAddress !== walletAddress || link.packId !== pack.packId) {
        invalid.push({ checkoutId, reason: 'checkout_buyback_link_identity_mismatch' })
        continue
      }
      if (link.openedAt < POKEMON30_EVENT_START || link.openedAt >= POKEMON30_EVENT_END) {
        invalid.push({ checkoutId, reason: 'checkout_buyback_link_outside_campaign_window' })
        continue
      }
      if (seenLinkedBuybackIds.has(link.buybackId)) {
        invalid.push({ checkoutId, buybackId: link.buybackId, reason: 'checkout_buyback_link_buyback_reused' })
        continue
      }
      seenLinkedBuybackIds.add(link.buybackId)
      const buyback = buybackById.get(link.buybackId)
      if (!buyback) {
        unresolved.push({ checkoutId, buybackId: link.buybackId, walletAddress, packId: pack.packId, reason: 'onchain_buyback_missing' })
        continue
      }
      if (buyback.walletAddress !== walletAddress) {
        invalid.push({ checkoutId, buybackId: link.buybackId, reason: 'onchain_buyback_wallet_mismatch' })
        continue
      }

      matchedCheckoutCount += 1
      const isLowestTierBuyback = buyback.amountWei <= BigInt(pack.lowestTierBuybackPayoutMaxWei)
      if (!isLowestTierBuyback) continue

      eligibleCheckoutCount += 1
      const entry = entries.get(walletAddress) || {
        walletAddress,
        tickets: 0,
        eligibleCheckoutCount: 0,
        packs: new Map(),
      }
      const packEntry = entry.packs.get(pack.packId) || {
        label: pack.label,
        price: pack.price,
        ticketWeight: pack.ticketWeight,
        lowestTierBbbvMax: formatUsdCents(pack.lowestTierBbbvMaxCents),
        lowestTierBuybackPayoutMax: pack.lowestTierBuybackPayoutMax,
        eligibleDraws: 0,
        tickets: 0,
        eligibleBuybackAmountWei: '0',
        highestEligibleBuybackAmount: '0',
        reportedTierCounts: {},
      }
      packEntry.eligibleDraws += 1
      packEntry.tickets += pack.ticketWeight
      packEntry.eligibleBuybackAmountWei = (BigInt(packEntry.eligibleBuybackAmountWei) + buyback.amountWei).toString()
      const highestEligibleBuybackAmountWei = BigInt(packEntry.highestEligibleBuybackAmountWei || '0')
      packEntry.highestEligibleBuybackAmountWei = (buyback.amountWei > highestEligibleBuybackAmountWei
        ? buyback.amountWei
        : highestEligibleBuybackAmountWei).toString()
      packEntry.highestEligibleBuybackAmount = formatUsdtWei(packEntry.highestEligibleBuybackAmountWei)
      if (link.tier) {
        packEntry.reportedTierCounts[link.tier] = (packEntry.reportedTierCounts[link.tier] || 0) + 1
      }
      entry.tickets += pack.ticketWeight
      entry.eligibleCheckoutCount += 1
      entry.packs.set(pack.packId, packEntry)
      entries.set(walletAddress, entry)
    }
  }

  const sourceStatus = unresolved.length === 0 && invalid.length === 0 ? 'ready' : 'blocked_reconciliation'
  const pendingPacks = normalisePendingPackConfigurations(pendingPackConfigurations)
  const payload = {
    version: 1,
    eventId: POKEMON30_EVENT_ID,
    sourceStatus,
    generatedAt,
    campaign: { start: POKEMON30_EVENT_START, end: POKEMON30_EVENT_END, timezone: 'Asia/Hong_Kong' },
    totals: sourceStatus === 'ready'
      ? { wallets: entries.size, tickets: [...entries.values()].reduce((sum, entry) => sum + entry.tickets, 0), eligibleCheckoutCount, matchedCheckoutCount }
      : null,
    reconciliation: {
      purchaseCheckoutCount: purchases.reduce((sum, purchase) => sum + (Array.isArray(purchase?.checkoutIds) ? purchase.checkoutIds.length : 0), 0),
      uniquePurchaseCheckoutCount: seenPurchaseCheckoutIds.size,
      scannedBuybackCount: buybackById.size,
      matchedCheckoutCount,
      eligibleCheckoutCount,
      unresolvedCheckoutCount: unresolved.length,
      invalidRecordCount: invalid.length,
    },
    pendingPackConfigurations: pendingPacks,
    entries: sourceStatus === 'ready' ? summariseEntries(entries) : [],
    unresolved: sourceStatus === 'ready' ? [] : unresolved,
    invalid: sourceStatus === 'ready' ? [] : invalid,
  }
  return { ...payload, ledgerHash: ledgerHash(payload) }
}

export function notReadyPokemon30Summary({ code = 'pokemon30_ledger_missing', message = 'Ticket ledger is not ready.' } = {}) {
  return {
    version: 1,
    eventId: POKEMON30_EVENT_ID,
    sourceStatus: 'not_ready',
    sourceCode: code,
    message,
    generatedAt: null,
    totals: null,
    reconciliation: null,
  }
}

export function readPokemon30Ledger(path) {
  if (!path || !existsSync(path)) return notReadyPokemon30Summary()
  const payload = JSON.parse(readFileSync(path, 'utf8'))
  if (payload?.eventId !== POKEMON30_EVENT_ID || !payload?.sourceStatus) {
    return notReadyPokemon30Summary({ code: 'pokemon30_ledger_invalid', message: 'Ticket ledger has an invalid event identity or source status.' })
  }
  return payload
}

export function pokemon30LedgerEntry(ledger, walletAddress) {
  const wallet = normaliseAddress(walletAddress)
  if (!wallet || ledger?.sourceStatus !== 'ready') return null
  return (Array.isArray(ledger.entries) ? ledger.entries : []).find((entry) => entry.walletAddress === wallet) || null
}
