import { normalizeAddress, normalizeHash, toNumber } from './utils.mjs'

export const WALLET_RESOLVE_URL = 'https://open-monitor-rmrm.pages.dev/api/wallet-migration/resolve'
export const WALLET_MIGRATIONS_URL = 'https://tcgpro.zeabur.app/api/wallet-migrations.json'

export const DEFAULT_CAMPAIGN_START = 1783058400
export const DEFAULT_CAMPAIGN_END = 1784505600

export const BUYBACK_EVENT_TOPIC =
  '0xca4650c272ed248c5917e9ad8c3cca3b69d42f25071c9e6c85a2abc7427030cf'
export const BUYBACK_SUCCESS_V3_EVENT_TOPIC =
  '0x3a50fc956257733436af07a2199cd0ea917826d1f0cb6f639800ebb7912d9888'
export const LEGACY_PACK_OPEN_EVENT_TOPIC =
  '0xd505514c5f9bb134a66621a7fd46a679442a1a0e45f5ad5dff0724e4b4588fed'
export const COSTUME_PACK_ID =
  '0x6ab417f10cac2e525f9beb854e47a9672bbe06470014432b2cf271157c183332'
export const MAGMA_PACK_ID =
  '0x26a4c27796a0e13e0188178750ef4d8d1d3828eb1d7bfe02692bdbeeda1e677c'
export const STARRY_PACK_ID =
  '0x4e06640364ce4c2b6793e700b6b8066a11c90503eb92945da232a3106f36b9b9'
export const PLASMA_PACK_ID =
  '0xb67b65d4067ed41cbfc2c8c8456ade7bd0ccb1f527524f21f8726385f7a934ab'
export const WORLD_CUP_PACK_ID =
  '0xa8de4cf14c21a325d4eebb540b60a92ff93e43fd347c7fc8b56eead2d3707de8'
export const CHAMPION_PACK_ID =
  '0xd8129cd1c2ac8629cc96b5c3dcc96cc7ebe74f341807697323950797cf030eec'
export const COZY_PACK_ID =
  '0x8ed5ef6878bd82e9411a56964f5db3497479def7c0145c7ab90ea9ea4e8af906'
export const LEGACY_PACK_OPEN_CONTRACT = '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a'
export const EXTRA_LEGACY_PACKS_ENV = 'LUCKY_DRAW_EXTRA_LEGACY_PACKS'

export const PACK_WEIGHTS = {
  omega: 1,
  'renacrypt-pack': 2,
  eden: 3,
  'costume-pack': 2,
  magma: 2,
  'starry-pack': 2,
  'plasma-pack': 2,
  'world-cup-pack': 2,
  'champion-pack': 2,
  'cozy-pack': 2,
}

export const BUILTIN_PACK_EVENT_SOURCES = [
  {
    contract: '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910',
    pack: 'omega',
    label: 'OMEGA',
    ticketWeight: PACK_WEIGHTS.omega,
    eventTopic: BUYBACK_EVENT_TOPIC,
    eventKind: 'buyback-event',
    configSource: 'built-in',
  },
  {
    contract: '0xb2891022648c5fad3721c42c05d8d283d4d53080',
    pack: 'renacrypt-pack',
    label: 'RenaCrypt Pack',
    ticketWeight: PACK_WEIGHTS['renacrypt-pack'],
    eventTopic: BUYBACK_EVENT_TOPIC,
    eventKind: 'buyback-event',
    configSource: 'built-in',
  },
  {
    contract: '0xfda4a907d23d9f24271bc47483c5b983831e325e',
    pack: 'eden',
    label: 'EDEN',
    ticketWeight: PACK_WEIGHTS.eden,
    eventTopic: BUYBACK_EVENT_TOPIC,
    eventKind: 'buyback-event',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'costume-pack',
    label: 'Costume Pack',
    ticketWeight: PACK_WEIGHTS['costume-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: COSTUME_PACK_ID,
    packId: COSTUME_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'magma',
    label: 'MAGMA',
    ticketWeight: PACK_WEIGHTS.magma,
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: MAGMA_PACK_ID,
    packId: MAGMA_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'starry-pack',
    label: 'Starry Pack',
    ticketWeight: PACK_WEIGHTS['starry-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: STARRY_PACK_ID,
    packId: STARRY_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'plasma-pack',
    label: 'Plasma Pack',
    ticketWeight: PACK_WEIGHTS['plasma-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: PLASMA_PACK_ID,
    packId: PLASMA_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'world-cup-pack',
    label: 'World Cup Pack',
    ticketWeight: PACK_WEIGHTS['world-cup-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: WORLD_CUP_PACK_ID,
    packId: WORLD_CUP_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'champion-pack',
    label: 'Champion Pack',
    ticketWeight: PACK_WEIGHTS['champion-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: CHAMPION_PACK_ID,
    packId: CHAMPION_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
  {
    contract: LEGACY_PACK_OPEN_CONTRACT,
    buybackContract: LEGACY_PACK_OPEN_CONTRACT,
    pack: 'cozy-pack',
    label: 'Cozy Pack',
    ticketWeight: PACK_WEIGHTS['cozy-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: COZY_PACK_ID,
    packId: COZY_PACK_ID,
    eventKind: 'legacy-pack-open',
    configSource: 'built-in',
  },
]

function normalizePackKey(value, index) {
  const pack = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack)) {
    throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].pack must use lowercase letters, numbers, and hyphens.`)
  }
  return pack
}

function normalizeLabel(value, index) {
  const label = String(value || '').trim()
  if (!label) throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].label is required.`)
  return label
}

export function parseExtraLegacyPackSources(rawValue = process.env[EXTRA_LEGACY_PACKS_ENV] || '') {
  const text = String(rawValue || '').trim()
  if (!text) return []

  let payload
  try {
    payload = JSON.parse(text)
  } catch (error) {
    throw new Error(`${EXTRA_LEGACY_PACKS_ENV} must be valid JSON: ${error.message}`)
  }

  const rows = Array.isArray(payload) ? payload : [payload]
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}] must be an object.`)
    }

    const pack = normalizePackKey(row.pack, index)
    const label = normalizeLabel(row.label, index)
    const ticketWeight = toNumber(row.ticketWeight)
    if (ticketWeight <= 0) {
      throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].ticketWeight must be a positive integer.`)
    }

    const contract = normalizeAddress(row.openContract || row.contract)
    if (!contract) {
      throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].openContract must be a valid address.`)
    }

    const packId = normalizeHash(row.packId || row.topic2)
    if (!packId) {
      throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].packId must be a 0x-prefixed 32-byte hash.`)
    }

    const buybackContract = normalizeAddress(row.buybackContract || contract)
    if (!buybackContract) {
      throw new Error(`${EXTRA_LEGACY_PACKS_ENV}[${index}].buybackContract must be a valid address.`)
    }

    return {
      contract,
      buybackContract,
      pack,
      label,
      ticketWeight,
      eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
      topic2: packId,
      packId,
      eventKind: 'legacy-pack-open',
      configSource: EXTRA_LEGACY_PACKS_ENV,
    }
  })
}

function assertUniquePackSources(sources) {
  const seenPacks = new Set()
  const seenLegacyIds = new Set()

  for (const source of sources) {
    if (seenPacks.has(source.pack)) throw new Error(`Duplicate lucky-draw pack rule: ${source.pack}`)
    seenPacks.add(source.pack)

    if (source.eventKind === 'legacy-pack-open') {
      const legacyKey = `${source.contract}:${source.topic2}`
      if (seenLegacyIds.has(legacyKey)) {
        throw new Error(`Duplicate lucky-draw legacy pack rule: ${legacyKey}`)
      }
      seenLegacyIds.add(legacyKey)
    }
  }
}

export function getCampaignWindow(args = {}) {
  const campaignStart = toNumber(args.campaignStart || process.env.LUCKY_DRAW_CAMPAIGN_START || DEFAULT_CAMPAIGN_START)
  const campaignEnd = toNumber(args.campaignEnd || process.env.LUCKY_DRAW_CAMPAIGN_END || DEFAULT_CAMPAIGN_END)
  if (!campaignStart || !campaignEnd || campaignEnd < campaignStart) {
    throw new Error('Invalid lucky draw campaign window.')
  }
  return { campaignStart, campaignEnd }
}

export function getPackEventSources(extraLegacyPacksRaw = process.env[EXTRA_LEGACY_PACKS_ENV] || '') {
  const sources = [...BUILTIN_PACK_EVENT_SOURCES, ...parseExtraLegacyPackSources(extraLegacyPacksRaw)]
  assertUniquePackSources(sources)
  return sources
}

export function getPackWeights(sources = getPackEventSources()) {
  return Object.fromEntries(sources.map((source) => [source.pack, source.ticketWeight]))
}

export function describePackEventSources(sources = getPackEventSources()) {
  return sources.map((source) => ({
    pack: source.pack,
    label: source.label,
    ticketWeight: source.ticketWeight,
    contract: source.contract,
    openContract: source.eventKind === 'legacy-pack-open' ? source.contract : null,
    buybackContract: source.buybackContract || null,
    eventKind: source.eventKind,
    eventTopic: source.eventTopic,
    topic1: source.topic1 || null,
    topic2: source.topic2 || null,
    topic3: source.topic3 || null,
    packId: source.packId || source.topic2 || null,
    configSource: source.configSource || 'built-in',
  }))
}
