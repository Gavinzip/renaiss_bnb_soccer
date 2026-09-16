import { Interface } from 'ethers'

import {
  applyBasisPoints,
  formatUsdCents,
  formatUsdtWei,
  parseUsdCents,
  usdCentsToUsdtWei,
} from './buyback-value.mjs'

export const POKEMON30_EVENT_ID = 'pokemon-30th-celebration-2026'
export const POKEMON30_EVENT_START = Math.floor(Date.parse('2026-09-16T19:00:00+08:00') / 1000)
export const POKEMON30_EVENT_END = Math.floor(Date.parse('2026-09-23T19:00:00+08:00') / 1000)
export const VRF_V3_CONTRACT = '0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f'
export const BSC_USDT = '0x55d398326f99059ff775485246999027b3197955'

export const VRF_V3_INTERFACE = new Interface([
  'event CheckoutSuccess(address indexed user, bytes32 indexed packId, bytes32 indexed builder, address token, uint256[] checkoutIds, uint256 totalAmount)',
  'event BuybackSuccess(address indexed user, address token, uint256 amount, bytes32[] buybackIds)',
])

export const VRF_V3_CHECKOUT_SUCCESS_TOPIC = VRF_V3_INTERFACE.getEvent('CheckoutSuccess').topicHash
export const VRF_V3_BUYBACK_SUCCESS_TOPIC = VRF_V3_INTERFACE.getEvent('BuybackSuccess').topicHash

const REQUIRED_TICKET_WEIGHTS = new Map([
  ['28', 1],
  ['48', 2],
  ['88', 3],
  ['248', 8],
  ['100', 5],
])

// The four live PANDORA machines share V3, so price is not a safe identifier.
// These IDs were cross-checked against the Renaiss catalogue snapshot and the
// live machine pages on 2026-09-16. BBBV is the UI buyback value; the contract
// emits 85% of it as the raw USDT BuybackSuccess.amount.
export const CONFIRMED_PANDORA_VRF_V3_PACKS = new Map([
  ['28', {
    packId: '0xcf11308cc7c642554a781b039a63a542c2f20b36f904b5b6981d48a2f76a5f90',
    lowestTierBbbvMaxCents: 3_500,
    buybackPayoutBasisPoints: 8_500,
  }],
  ['48', {
    packId: '0x4de1e3c158c8630faa2db4e6c5250933188c4990ba30640a44a41eb6732d257d',
    lowestTierBbbvMaxCents: 6_000,
    buybackPayoutBasisPoints: 8_500,
  }],
  ['88', {
    packId: '0xfe35d4de033fa6ffd14fb4e6a74ffef5ea2fc3ae6666a78d33c4bfb860e056fe',
    lowestTierBbbvMaxCents: 9_000,
    buybackPayoutBasisPoints: 8_500,
  }],
  ['248', {
    packId: '0x347ba3e1d2875a0e9e09a378369f6105a6a5f3d2a5c0a51b6837da4beb52dd7d',
    lowestTierBbbvMaxCents: 25_000,
    buybackPayoutBasisPoints: 8_500,
  }],
])

// The $100 limited machine is a separate configuration because it is not one
// of the live PANDORA pages. Its lowest-tier BBBV ceiling and 90% buyback rate
// were confirmed for this campaign; its actual on-chain packId must still be
// supplied by the source that launches that limited machine.
export const CONFIRMED_LIMITED_100_RULE = {
  lowestTierBbbvMaxCents: 12_000,
  buybackPayoutBasisPoints: 9_000,
}

const PACK_ID_PATTERN = /^0x[a-f0-9]{64}$/i

function cleanText(value) {
  return String(value ?? '').trim()
}

function normalisePrice(value) {
  const text = cleanText(value).replace(/^\$/, '')
  if (!/^(28|48|88|100|248)$/.test(text)) return ''
  return text
}

function normalisePackId(value) {
  const packId = cleanText(value).toLowerCase()
  return PACK_ID_PATTERN.test(packId) ? packId : ''
}

function normaliseBasisPoints(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : null
}

function confirmedRuleForPrice(price) {
  if (price === '100') return CONFIRMED_LIMITED_100_RULE
  return CONFIRMED_PANDORA_VRF_V3_PACKS.get(price) || null
}

export function parsePokemon30PackRules(raw, { allowPendingLimited100 = false } = {}) {
  if (!cleanText(raw)) {
    return {
      ok: false,
      code: 'pokemon30_pack_rules_missing',
      message: 'POKEMON30_PACK_RULES_JSON is required before ticket scanning can begin.',
      packs: [],
    }
  }

  let rows
  try {
    rows = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      code: 'pokemon30_pack_rules_invalid_json',
      message: 'POKEMON30_PACK_RULES_JSON must be a JSON array.',
      packs: [],
    }
  }

  if (!Array.isArray(rows)) {
    return {
      ok: false,
      code: 'pokemon30_pack_rules_invalid_shape',
      message: 'POKEMON30_PACK_RULES_JSON must be a JSON array of five configured machines.',
      packs: [],
    }
  }

  const seenPrices = new Set()
  const seenPackIds = new Set()
  const packs = []
  const pendingPacks = []
  const issues = []

  for (const row of rows) {
    const price = normalisePrice(row?.price)
    const packId = normalisePackId(row?.packId)
    const lowestTierBbbvMaxCents = parseUsdCents(row?.lowestTierBbbvMax)
    const buybackPayoutBasisPoints = normaliseBasisPoints(row?.buybackPayoutBasisPoints)
    const ticketWeight = Number(row?.ticketWeight)
    const expectedWeight = REQUIRED_TICKET_WEIGHTS.get(price)
    const confirmedRule = confirmedRuleForPrice(price)
    const isPendingLimited100 = price === '100' && !packId && allowPendingLimited100

    if (!price) issues.push('Each configured machine needs one of the announced prices: 28, 48, 88, 248, 100.')
    if (!packId && !isPendingLimited100) issues.push(`Machine ${price || '(unknown)'} needs an on-chain bytes32 packId.`)
    if (lowestTierBbbvMaxCents === null) {
      issues.push(`Machine ${price || '(unknown)'} needs a lowestTierBbbvMax in USD.`)
    }
    if (buybackPayoutBasisPoints === null) {
      issues.push(`Machine ${price || '(unknown)'} needs an exact buybackPayoutBasisPoints value.`)
    }
    if (price !== '100' && confirmedRule && packId !== confirmedRule.packId) {
      issues.push(`PANDORA $${price} must use its confirmed V3 packId ${confirmedRule.packId}.`)
    }
    if (confirmedRule && lowestTierBbbvMaxCents !== confirmedRule.lowestTierBbbvMaxCents) {
      issues.push(`Machine $${price} must use the confirmed lowestTierBbbvMax ${formatUsdCents(confirmedRule.lowestTierBbbvMaxCents)}.`)
    }
    if (confirmedRule && buybackPayoutBasisPoints !== confirmedRule.buybackPayoutBasisPoints) {
      issues.push(`Machine $${price} must use buybackPayoutBasisPoints ${confirmedRule.buybackPayoutBasisPoints}.`)
    }
    if (!Number.isInteger(ticketWeight) || ticketWeight !== expectedWeight) {
      issues.push(`Machine ${price || '(unknown)'} must use ticketWeight ${expectedWeight ?? '(unsupported price)'}.`)
    }
    if (price && seenPrices.has(price)) issues.push(`Price ${price} is configured more than once.`)
    if (packId && seenPackIds.has(packId)) issues.push(`packId ${packId} is configured more than once.`)
    if (price) seenPrices.add(price)
    if (packId) seenPackIds.add(packId)

    const lowestTierBbbvMaxWei = usdCentsToUsdtWei(lowestTierBbbvMaxCents)
    const lowestTierBuybackPayoutMaxWei = buybackPayoutBasisPoints === null
      ? null
      : applyBasisPoints(lowestTierBbbvMaxWei, buybackPayoutBasisPoints)
    if (price && packId && lowestTierBbbvMaxCents !== null && buybackPayoutBasisPoints !== null && lowestTierBbbvMaxWei !== null && lowestTierBuybackPayoutMaxWei !== null && Number.isInteger(ticketWeight) && ticketWeight === expectedWeight) {
      packs.push({
        id: cleanText(row?.id) || `pokemon30-${price}`,
        label: cleanText(row?.label) || `$${price} 卡機`,
        price,
        packId,
        lowestTierBbbvMaxCents,
        buybackPayoutBasisPoints,
        lowestTierBuybackPayoutMaxWei: lowestTierBuybackPayoutMaxWei.toString(),
        lowestTierBuybackPayoutMax: formatUsdtWei(lowestTierBuybackPayoutMaxWei),
        ticketWeight,
      })
    }
    if (isPendingLimited100 && lowestTierBbbvMaxCents !== null && buybackPayoutBasisPoints !== null && lowestTierBuybackPayoutMaxWei !== null && Number.isInteger(ticketWeight) && ticketWeight === expectedWeight) {
      pendingPacks.push({
        id: cleanText(row?.id) || 'pokemon30-100',
        label: cleanText(row?.label) || '$100 限定卡機',
        price,
        reason: 'onchain_pack_id_pending',
        lowestTierBbbvMax: formatUsdCents(lowestTierBbbvMaxCents),
        lowestTierBuybackPayoutMax: formatUsdtWei(lowestTierBuybackPayoutMaxWei),
        buybackPayoutBasisPoints,
        ticketWeight,
      })
    }
  }

  for (const price of REQUIRED_TICKET_WEIGHTS.keys()) {
    if (!seenPrices.has(price)) issues.push(`The announced $${price} machine is not configured.`)
  }

  if (issues.length > 0 || packs.length + pendingPacks.length !== REQUIRED_TICKET_WEIGHTS.size) {
    return {
      ok: false,
      code: 'pokemon30_pack_rules_incomplete',
      message: [...new Set(issues)].join(' '),
      packs,
      pendingPacks,
    }
  }

  return { ok: true, code: 'ready', message: '', packs, pendingPacks }
}

export function getPokemon30CampaignWindow() {
  return { start: POKEMON30_EVENT_START, end: POKEMON30_EVENT_END }
}
