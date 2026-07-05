#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanOnchainTicketEvents } from './lucky-draw/onchain-source.mjs'
import {
  DEFAULT_CAMPAIGN_END,
  DEFAULT_CAMPAIGN_START,
  EXTRA_LEGACY_PACKS_ENV,
  WALLET_MIGRATIONS_URL,
  getCampaignWindow,
} from './lucky-draw/rules.mjs'
import { fetchWalletMigrationMap } from './lucky-draw/wallet-migrations.mjs'
import { resolveEventWallets } from './lucky-draw/wallet-resolve.mjs'
import {
  DEFAULT_CARRYOVER_DIVISOR,
  DEFAULT_CARRYOVER_LEDGER_URL,
  applyCarryoverTickets,
  readCarryoverLedgerPayload,
} from './lucky-draw/carryover-tickets.mjs'
import {
  normalizeAddress,
  readEnvFile,
  readWalletMigrationMap,
  stableStringify,
  toNumber,
} from './lucky-draw/utils.mjs'

const DEFAULT_INSIDER_TICKET_GRANT_PATH = 'config/soccer-insider-ticket-grants.json'

function parseAddressCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeAddress(item))
    .filter(Boolean)
}

function parseArgs(argv) {
  const cliCarryoverLedgerUrl = argv.includes('--carryover-ledger-url')
  const cliCarryoverLedgerPath = argv.includes('--carryover-ledger-path')
  const cliCarryoverDivisor = argv.includes('--carryover-divisor')
  const args = {
    envFile: '',
    walletMigrationMapPath: '',
    walletMigrationUrl: process.env.WALLET_MIGRATIONS_URL || WALLET_MIGRATIONS_URL,
    insiderGrantPath: process.env.SOCCER_INSIDER_TICKET_GRANT_PATH || DEFAULT_INSIDER_TICKET_GRANT_PATH,
    insiderGrantAddressesRaw: process.env.SOCCER_INSIDER_TICKET_ADDRESSES || '',
    insiderPracticeTickets: toNumber(process.env.SOCCER_INSIDER_PRACTICE_TICKETS || 100),
    insiderGrantTickets: toNumber(process.env.SOCCER_INSIDER_GRANT_TICKETS || 100),
    carryoverLedgerUrl: process.env.SOCCER_CARRYOVER_LEDGER_URL || DEFAULT_CARRYOVER_LEDGER_URL,
    carryoverLedgerPath: process.env.SOCCER_CARRYOVER_LEDGER_PATH || '',
    carryoverDivisor: toNumber(process.env.SOCCER_CARRYOVER_DIVISOR || DEFAULT_CARRYOVER_DIVISOR),
    skipCarryoverLedger: process.env.SOCCER_CARRYOVER_LEDGER_DISABLED === '1',
    cacheDir: process.env.LUCKY_DRAW_CACHE_DIR || 'cache/lucky-draw',
    walletMigrationCacheTtlMinutes: 15,
    walletResolveCacheTtlMinutes: 24 * 60,
    eventCacheOverlapBlocks: 200,
    eventCacheLookbackMinutes: toNumber(process.env.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_MINUTES || 0),
    eventCacheLookbackCheckpoints: toNumber(process.env.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS || 0),
    campaignStart: toNumber(process.env.LUCKY_DRAW_CAMPAIGN_START || DEFAULT_CAMPAIGN_START),
    campaignEnd: toNumber(process.env.LUCKY_DRAW_CAMPAIGN_END || DEFAULT_CAMPAIGN_END),
    extraLegacyPacksRaw: process.env[EXTRA_LEGACY_PACKS_ENV] || '',
    out: 'public/lucky-draw-ledger.json',
    contracts: [],
    fromBlock: 0,
    toBlock: 0,
    blockChunk: 5000,
    pageSize: 1000,
    delayMs: 60,
    resolveConcurrency: 4,
    retries: 5,
    backoffMs: 800,
    dryRun: false,
    progress: false,
    skipWalletResolve: false,
    skipWalletMigrationUrl: false,
    noCache: false,
    refreshCache: false,
    bscscanApiUrl: process.env.BSCSCAN_API_URL || process.env.ONCHAIN_API_URL || 'https://api.etherscan.io/v2/api',
    bscscanChainId: toNumber(process.env.BSCSCAN_CHAIN_ID || process.env.ONCHAIN_CHAIN_ID || 56),
    bscscanApiKey: process.env.BSCSCAN_API_KEY || '',
    bscscanRequestTimeoutMs: toNumber(
      process.env.BSCSCAN_REQUEST_TIMEOUT_MS || process.env.ONCHAIN_REQUEST_TIMEOUT_MS || 30_000,
    ),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--wallet-migration-map') args.walletMigrationMapPath = argv[++index] || ''
    else if (arg === '--wallet-migration-url') args.walletMigrationUrl = argv[++index] || ''
    else if (arg === '--insider-grant-path') args.insiderGrantPath = argv[++index] || ''
    else if (arg === '--insider-addresses') args.insiderGrantAddressesRaw = argv[++index] || ''
    else if (arg === '--insider-practice-tickets') args.insiderPracticeTickets = toNumber(argv[++index])
    else if (arg === '--insider-grant-tickets') args.insiderGrantTickets = toNumber(argv[++index])
    else if (arg === '--carryover-ledger-url') args.carryoverLedgerUrl = argv[++index] || ''
    else if (arg === '--carryover-ledger-path') args.carryoverLedgerPath = argv[++index] || ''
    else if (arg === '--carryover-divisor') args.carryoverDivisor = toNumber(argv[++index])
    else if (arg === '--cache-dir') args.cacheDir = argv[++index] || args.cacheDir
    else if (arg === '--wallet-migration-cache-ttl-minutes') args.walletMigrationCacheTtlMinutes = toNumber(argv[++index])
    else if (arg === '--wallet-resolve-cache-ttl-minutes') args.walletResolveCacheTtlMinutes = toNumber(argv[++index])
    else if (arg === '--event-cache-overlap-blocks') args.eventCacheOverlapBlocks = toNumber(argv[++index])
    else if (arg === '--event-cache-lookback-minutes') args.eventCacheLookbackMinutes = toNumber(argv[++index])
    else if (arg === '--event-cache-lookback-checkpoints') args.eventCacheLookbackCheckpoints = toNumber(argv[++index])
    else if (arg === '--campaign-start') args.campaignStart = toNumber(argv[++index])
    else if (arg === '--campaign-end') args.campaignEnd = toNumber(argv[++index])
    else if (arg === '--extra-legacy-packs') args.extraLegacyPacksRaw = argv[++index] || ''
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--contracts') args.contracts = parseAddressCsv(argv[++index])
    else if (arg === '--from-block') args.fromBlock = toNumber(argv[++index])
    else if (arg === '--to-block') args.toBlock = toNumber(argv[++index])
    else if (arg === '--block-chunk') args.blockChunk = toNumber(argv[++index] || args.blockChunk)
    else if (arg === '--page-size') args.pageSize = toNumber(argv[++index] || args.pageSize)
    else if (arg === '--delay-ms') args.delayMs = toNumber(argv[++index] || args.delayMs)
    else if (arg === '--resolve-concurrency') args.resolveConcurrency = toNumber(argv[++index] || args.resolveConcurrency)
    else if (arg === '--retries') args.retries = toNumber(argv[++index] || args.retries)
    else if (arg === '--backoff-ms') args.backoffMs = toNumber(argv[++index] || args.backoffMs)
    else if (arg === '--bscscan-api-url') args.bscscanApiUrl = argv[++index] || args.bscscanApiUrl
    else if (arg === '--bscscan-chain-id') args.bscscanChainId = toNumber(argv[++index] || args.bscscanChainId)
    else if (arg === '--bscscan-api-key') args.bscscanApiKey = argv[++index] || args.bscscanApiKey
    else if (arg === '--bscscan-request-timeout-ms') {
      args.bscscanRequestTimeoutMs = toNumber(argv[++index] || args.bscscanRequestTimeoutMs)
    }
    else if (arg === '--skip-wallet-resolve') args.skipWalletResolve = true
    else if (arg === '--skip-wallet-migration-url') args.skipWalletMigrationUrl = true
    else if (arg === '--skip-carryover-ledger') args.skipCarryoverLedger = true
    else if (arg === '--no-cache') args.noCache = true
    else if (arg === '--refresh-cache') args.refreshCache = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--progress') args.progress = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  if (args.envFile) {
    const envValues = readEnvFile(args.envFile)
    if (envValues.BSCSCAN_API_URL || envValues.ONCHAIN_API_URL) {
      args.bscscanApiUrl = envValues.BSCSCAN_API_URL || envValues.ONCHAIN_API_URL
    }
    if (envValues.BSCSCAN_CHAIN_ID || envValues.ONCHAIN_CHAIN_ID) {
      args.bscscanChainId = toNumber(envValues.BSCSCAN_CHAIN_ID || envValues.ONCHAIN_CHAIN_ID || 56)
    }
    args.bscscanApiKey = args.bscscanApiKey || envValues.BSCSCAN_API_KEY || ''
    if (envValues.BSCSCAN_REQUEST_TIMEOUT_MS || envValues.ONCHAIN_REQUEST_TIMEOUT_MS) {
      args.bscscanRequestTimeoutMs = toNumber(
        envValues.BSCSCAN_REQUEST_TIMEOUT_MS || envValues.ONCHAIN_REQUEST_TIMEOUT_MS || 30_000,
      )
    }
    if (envValues.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_MINUTES) {
      args.eventCacheLookbackMinutes = toNumber(envValues.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_MINUTES)
    }
    if (envValues.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS) {
      args.eventCacheLookbackCheckpoints = toNumber(envValues.LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS)
    }
    if (envValues.LUCKY_DRAW_CAMPAIGN_START) args.campaignStart = toNumber(envValues.LUCKY_DRAW_CAMPAIGN_START)
    if (envValues.LUCKY_DRAW_CAMPAIGN_END) args.campaignEnd = toNumber(envValues.LUCKY_DRAW_CAMPAIGN_END)
    args.insiderGrantPath = args.insiderGrantPath || envValues.SOCCER_INSIDER_TICKET_GRANT_PATH || ''
    args.insiderGrantAddressesRaw = args.insiderGrantAddressesRaw || envValues.SOCCER_INSIDER_TICKET_ADDRESSES || ''
    if (envValues.SOCCER_INSIDER_PRACTICE_TICKETS) {
      args.insiderPracticeTickets = toNumber(envValues.SOCCER_INSIDER_PRACTICE_TICKETS)
    }
    if (envValues.SOCCER_INSIDER_GRANT_TICKETS) {
      args.insiderGrantTickets = toNumber(envValues.SOCCER_INSIDER_GRANT_TICKETS)
    }
    if (!cliCarryoverLedgerUrl && envValues.SOCCER_CARRYOVER_LEDGER_URL) {
      args.carryoverLedgerUrl = envValues.SOCCER_CARRYOVER_LEDGER_URL
    }
    if (!cliCarryoverLedgerPath && envValues.SOCCER_CARRYOVER_LEDGER_PATH) {
      args.carryoverLedgerPath = envValues.SOCCER_CARRYOVER_LEDGER_PATH
    }
    if (!cliCarryoverDivisor && envValues.SOCCER_CARRYOVER_DIVISOR) {
      args.carryoverDivisor = toNumber(envValues.SOCCER_CARRYOVER_DIVISOR)
    }
    if (envValues.SOCCER_CARRYOVER_LEDGER_DISABLED === '1') args.skipCarryoverLedger = true
    args.extraLegacyPacksRaw = args.extraLegacyPacksRaw || envValues[EXTRA_LEGACY_PACKS_ENV] || ''
  }

  getCampaignWindow(args)
  args.retries = Math.max(1, args.retries)
  args.resolveConcurrency = Math.max(1, args.resolveConcurrency)
  args.insiderPracticeTickets = Math.max(0, Math.floor(args.insiderPracticeTickets || 0))
  args.insiderGrantTickets = Math.max(0, Math.floor(args.insiderGrantTickets || 0))
  args.carryoverDivisor = Math.max(1, Math.floor(args.carryoverDivisor || DEFAULT_CARRYOVER_DIVISOR))
  args.bscscanRequestTimeoutMs = Math.max(1, args.bscscanRequestTimeoutMs || 30_000)
  args.blockChunk = Math.max(100, args.blockChunk)
  args.pageSize = Math.max(1, Math.min(1000, args.pageSize))
  args.eventCacheLookbackMinutes = Math.max(0, toNumber(args.eventCacheLookbackMinutes) || 0)
  args.eventCacheLookbackCheckpoints = Math.max(0, toNumber(args.eventCacheLookbackCheckpoints) || 0)
  args.walletMigrationCacheTtlMs = Math.max(0, args.walletMigrationCacheTtlMinutes) * 60 * 1000
  args.walletResolveCacheTtlMs = Math.max(0, args.walletResolveCacheTtlMinutes) * 60 * 1000
  args.walletMigrationCachePath = join(args.cacheDir, 'wallet-migrations.json')
  args.walletResolveCachePath = join(args.cacheDir, 'wallet-resolve.json')
  args.eventCachePath = join(args.cacheDir, 'onchain-events.json')
  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/fetch-lucky-draw-ledger.mjs [options]

Scans BSC contract logs directly. Legacy pack opens are matched on-chain through
BuybackSuccessV3(checkoutMessageHash), so this script does not call the Renaiss
activity API.

Options:
  --env-file <path>             Optional local env file containing BSCSCAN_API_KEY.
  --wallet-migration-map <path> Optional old-wallet -> new-wallet JSON map.
  --wallet-migration-url <url>  Remote old-wallet -> new-wallet JSON map.
  --cache-dir <path>            Persistent API cache dir. Default cache/lucky-draw.
  --campaign-start <unix>       Campaign start timestamp. Default ${DEFAULT_CAMPAIGN_START}.
  --campaign-end <unix>         Campaign end timestamp. Default ${DEFAULT_CAMPAIGN_END}.
  --extra-legacy-packs <json>   Same JSON value as ${EXTRA_LEGACY_PACKS_ENV}.
  --insider-grant-path <path>   Optional JSON/CSV file of insider wallet grants.
                                Default ${DEFAULT_INSIDER_TICKET_GRANT_PATH}.
  --insider-addresses <csv>     Optional comma-separated insider wallet addresses.
  --insider-practice-tickets <n> Practice tickets usable only in round32. Default 100.
  --insider-grant-tickets <n>   Shared reward tickets usable across round16-final. Default 100.
  --carryover-ledger-url <url>  Previous campaign ledger URL. Default ${DEFAULT_CARRYOVER_LEDGER_URL}.
  --carryover-ledger-path <path> Read previous campaign ledger from a local JSON file instead of URL.
  --carryover-divisor <n>       Previous campaign finalTickets divisor. Default ${DEFAULT_CARRYOVER_DIVISOR}.
  --event-cache-lookback-minutes <n> Re-scan at least this many minutes before the current scan end.
  --event-cache-lookback-checkpoints <n> Re-scan from the oldest of the last n successful toBlock checkpoints.
  --contracts <csv>             Limit on-chain scan to specific contract addresses.
  --from-block <n>              Debug scan start block.
  --to-block <n>                Debug scan end block.
  --block-chunk <n>             BscScan logs block window size. Default 5000.
  --page-size <n>               BscScan logs page size. Default 1000.
  --bscscan-request-timeout-ms <ms>  Per-request BscScan timeout. Default 30000.
  --out <path>                  Output JSON path. Default public/lucky-draw-ledger.json.
  --skip-wallet-resolve         Do not call wallet migration resolver.
  --skip-wallet-migration-url   Do not load the remote wallet migration list.
  --skip-carryover-ledger       Explicitly disable previous-campaign carryover tickets.
  --no-cache                    Disable API cache reads/writes.
  --refresh-cache               Ignore fresh cache and refetch APIs.
  --dry-run                     Build and summarize without writing a file.
  --progress                    Print scan progress.
`)
}

function emptyEntry(userAddress, sourceAddresses, packKeys) {
  return {
    rank: 0,
    userAddress,
    sourceAddresses: [...sourceAddresses].filter(Boolean),
    packs: Object.fromEntries(packKeys.map((pack) => [pack, 0])),
    baseTickets: 0,
    bonusTickets: 0,
    carryoverTickets: 0,
    insiderPracticeTickets: 0,
    insiderGrantTickets: 0,
    rawTickets: 0,
    sbt: 'none',
    sbtMultiplier: 1,
    finalTickets: 0,
    totalVotingTickets: 0,
    ticketStart: null,
    ticketEnd: null,
    ticketIntervals: [],
    firstBuybackAt: null,
    lastBuybackAt: null,
    eventCount: 0,
    dataWarnings: [],
  }
}

function normalizeGrantRow(row, defaults, source, index) {
  if (typeof row === 'string') {
    const address = normalizeAddress(row)
    return address
      ? {
        address,
        practiceTickets: defaults.practiceTickets,
        grantTickets: defaults.grantTickets,
        source,
      }
      : null
  }

  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const address = normalizeAddress(row.address || row.walletAddress || row.userAddress || row.wallet)
  if (!address) throw new Error(`Invalid insider ticket grant address at ${source}[${index}].`)

  return {
    address,
    practiceTickets: Math.max(
      0,
      Math.floor(Number(row.practiceTickets ?? row.insiderPracticeTickets ?? defaults.practiceTickets) || 0),
    ),
    grantTickets: Math.max(0, Math.floor(Number(row.grantTickets ?? row.insiderGrantTickets ?? defaults.grantTickets) || 0)),
    source,
  }
}

function parseGrantPayload(text, defaults, source) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []

  let payload = null
  try {
    payload = JSON.parse(trimmed)
  } catch {
    return trimmed
      .split(/[\n,]/)
      .map((row, index) => normalizeGrantRow(row, defaults, source, index))
      .filter(Boolean)
  }

  if (Array.isArray(payload)) {
    return payload.map((row, index) => normalizeGrantRow(row, defaults, source, index)).filter(Boolean)
  }

  if (payload && typeof payload === 'object') {
    const nextDefaults = {
      practiceTickets: Math.max(
        0,
        Math.floor(Number(payload.practiceTickets ?? payload.insiderPracticeTickets ?? defaults.practiceTickets) || 0),
      ),
      grantTickets: Math.max(
        0,
        Math.floor(Number(payload.grantTickets ?? payload.insiderGrantTickets ?? defaults.grantTickets) || 0),
      ),
    }
    const rows = Array.isArray(payload.grants)
      ? payload.grants
      : Array.isArray(payload.addresses)
        ? payload.addresses
        : []
    return rows.map((row, index) => normalizeGrantRow(row, nextDefaults, source, index)).filter(Boolean)
  }

  return []
}

function readInsiderTicketGrants(args) {
  const defaults = {
    practiceTickets: args.insiderPracticeTickets,
    grantTickets: args.insiderGrantTickets,
  }
  const grants = []
  const sources = []

  if (args.insiderGrantAddressesRaw) {
    grants.push(...parseGrantPayload(args.insiderGrantAddressesRaw, defaults, 'SOCCER_INSIDER_TICKET_ADDRESSES'))
    sources.push('SOCCER_INSIDER_TICKET_ADDRESSES')
  }

  if (args.insiderGrantPath) {
    if (!existsSync(args.insiderGrantPath)) {
      throw new Error(`Insider ticket grant file does not exist: ${args.insiderGrantPath}`)
    }
    grants.push(...parseGrantPayload(readFileSync(args.insiderGrantPath, 'utf8'), defaults, args.insiderGrantPath))
    sources.push(args.insiderGrantPath)
  }

  const merged = new Map()
  for (const grant of grants) {
    const existing = merged.get(grant.address) || {
      address: grant.address,
      practiceTickets: 0,
      grantTickets: 0,
      sources: [],
    }
    existing.practiceTickets += grant.practiceTickets
    existing.grantTickets += grant.grantTickets
    if (!existing.sources.includes(grant.source)) existing.sources.push(grant.source)
    merged.set(grant.address, existing)
  }

  return {
    grants: [...merged.values()].filter((grant) => grant.practiceTickets > 0 || grant.grantTickets > 0),
    sources,
    defaultPracticeTickets: defaults.practiceTickets,
    defaultGrantTickets: defaults.grantTickets,
  }
}

function ensureEntry(entriesByAddress, event, canonicalSources, packKeys) {
  const userAddress = normalizeAddress(event.canonicalAddress)
  const sourceAddresses = canonicalSources.get(userAddress) || new Set([userAddress])
  const existing = entriesByAddress.get(userAddress)
  if (existing) return existing
  const entry = emptyEntry(userAddress, sourceAddresses, packKeys)
  entriesByAddress.set(userAddress, entry)
  return entry
}

function aggregateBaseTickets(events, canonicalSources, packRules) {
  const entriesByAddress = new Map()
  const packKeys = packRules.map((rule) => rule.pack)
  for (const event of events) {
    const entry = ensureEntry(entriesByAddress, event, canonicalSources, packKeys)
    entry.packs[event.pack] = (entry.packs[event.pack] || 0) + 1
    entry.rawTickets += event.ticketWeight
    entry.baseTickets += event.ticketWeight
    entry.eventCount += 1
    entry.firstBuybackAt = entry.firstBuybackAt
      ? Math.min(entry.firstBuybackAt, event.timestamp)
      : event.timestamp
    entry.lastBuybackAt = entry.lastBuybackAt ? Math.max(entry.lastBuybackAt, event.timestamp) : event.timestamp
  }

  for (const entry of entriesByAddress.values()) {
    entry.sbt = 'none'
    entry.sbtMultiplier = 1
    entry.finalTickets = entry.rawTickets
    entry.totalVotingTickets = entry.finalTickets + entry.insiderPracticeTickets + entry.insiderGrantTickets
    entry.bonusTickets = 0
  }

  return entriesByAddress
}

function applyInsiderTicketGrants(entriesByAddress, insiderGrantConfig, walletMigrationMap, packRules) {
  const packKeys = packRules.map((rule) => rule.pack)
  const applied = []

  for (const grant of insiderGrantConfig.grants) {
    const canonicalAddress = normalizeAddress(walletMigrationMap.get(grant.address) || grant.address)
    if (!canonicalAddress) continue

    const existing = entriesByAddress.get(canonicalAddress)
    const entry = existing || emptyEntry(canonicalAddress, new Set([canonicalAddress]), packKeys)
    if (!entry.sourceAddresses.includes(grant.address)) entry.sourceAddresses.push(grant.address)
    entry.sourceAddresses = [...new Set(entry.sourceAddresses.map(normalizeAddress).filter(Boolean))].sort()
    entry.insiderPracticeTickets += grant.practiceTickets
    entry.insiderGrantTickets += grant.grantTickets
    entry.totalVotingTickets = entry.finalTickets + entry.insiderPracticeTickets + entry.insiderGrantTickets
    entriesByAddress.set(canonicalAddress, entry)
    applied.push({
      sourceAddress: grant.address,
      userAddress: canonicalAddress,
      practiceTickets: grant.practiceTickets,
      grantTickets: grant.grantTickets,
    })
  }

  return {
    applied,
    sources: insiderGrantConfig.sources,
    defaultPracticeTickets: insiderGrantConfig.defaultPracticeTickets,
    defaultGrantTickets: insiderGrantConfig.defaultGrantTickets,
  }
}

function allocateRawIntervals(entriesByAddress, events) {
  let cursor = 0
  for (const event of events) {
    const entry = entriesByAddress.get(event.canonicalAddress)
    if (!entry) continue
    const start = cursor + 1
    const end = cursor + event.ticketWeight
    cursor = end
    entry.ticketIntervals.push({
      start,
      end,
      displayStart: start,
      displayEnd: end,
      namespace: 'raw',
      source: event.eventKind,
      pack: event.pack,
      txHash: event.txHash,
      timestamp: event.timestamp,
      blockNumber: event.blockNumber,
      ordinal: event.logIndex ?? event.ordinal,
      legacyOpenTxHash: event.legacyOpenTxHash || null,
    })
  }

  return cursor
}

function updateEntryIntervalBounds(entriesByAddress) {
  for (const entry of entriesByAddress.values()) {
    entry.ticketIntervals.sort((left, right) => {
      if ((left.displayStart || left.start) !== (right.displayStart || right.start)) {
        return (left.displayStart || left.start) - (right.displayStart || right.start)
      }
      return left.start - right.start
    })
    const ranges = entry.ticketIntervals.filter((range) => range.end >= range.start)
    entry.ticketStart = ranges.length ? Math.min(...ranges.map((range) => range.start)) : null
    entry.ticketEnd = ranges.length ? Math.max(...ranges.map((range) => range.end)) : null
  }
}

function allocateIntervals(entriesByAddress, events) {
  const rawTicketTotal = allocateRawIntervals(entriesByAddress, events)

  updateEntryIntervalBounds(entriesByAddress)

  return {
    rawTicketTotal,
    shuffledBonusTicketTotal: 0,
    bonusShuffleSeed: null,
    bonusShuffleVersion: null,
  }
}

function finalizeEntries(entriesByAddress) {
  const entries = [...entriesByAddress.values()]
    .filter((entry) => entry.finalTickets + entry.insiderPracticeTickets + entry.insiderGrantTickets > 0)
    .sort((left, right) => {
      if (left.finalTickets !== right.finalTickets) return right.finalTickets - left.finalTickets
      if (left.rawTickets !== right.rawTickets) return right.rawTickets - left.rawTickets
      if ((left.totalVotingTickets || 0) !== (right.totalVotingTickets || 0)) {
        return (right.totalVotingTickets || 0) - (left.totalVotingTickets || 0)
      }
      const leftTs = left.firstBuybackAt || Number.MAX_SAFE_INTEGER
      const rightTs = right.firstBuybackAt || Number.MAX_SAFE_INTEGER
      if (leftTs !== rightTs) return leftTs - rightTs
      return left.userAddress.localeCompare(right.userAddress)
    })

  return entries.map((entry, index) => ({ ...entry, rank: index + 1 }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { campaignStart, campaignEnd } = getCampaignWindow(args)
  const localWalletMigrationMap = readWalletMigrationMap(args.walletMigrationMapPath)
  const remoteWalletMigration = args.skipWalletMigrationUrl
    ? { pairs: new Map(), meta: null }
    : await fetchWalletMigrationMap(args.walletMigrationUrl, args)
  const walletMigrationMap = new Map(remoteWalletMigration.pairs)
  for (const [oldAddress, newAddress] of localWalletMigrationMap.entries()) {
    walletMigrationMap.set(oldAddress, newAddress)
  }
  const sourceResult = await scanOnchainTicketEvents(args)
  const resolved = await resolveEventWallets(sourceResult.events, {
    ...args,
    walletMigrationMap,
  })
  const allEvents = resolved.events

  allEvents.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex
    if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp
    if (left.txHash !== right.txHash) return left.txHash.localeCompare(right.txHash)
    return left.id.localeCompare(right.id)
  })

  const packRules = Array.isArray(sourceResult.source.packEventSources)
    ? sourceResult.source.packEventSources
    : []
  const extraPackRules = packRules.filter((rule) => rule.configSource === EXTRA_LEGACY_PACKS_ENV)
  const entriesByAddress = aggregateBaseTickets(allEvents, resolved.canonicalSources, packRules)
  const insiderGrantConfig = readInsiderTicketGrants(args)
  const insiderTicketGrantSource = applyInsiderTicketGrants(entriesByAddress, insiderGrantConfig, walletMigrationMap, packRules)
  const carryoverLedger = await readCarryoverLedgerPayload(args)
  const carryoverTicketSource = applyCarryoverTickets(
    entriesByAddress,
    carryoverLedger,
    walletMigrationMap,
    {
      createEntry: (walletAddress, sourceAddresses) => emptyEntry(
        walletAddress,
        sourceAddresses,
        packRules.map((rule) => rule.pack),
      ),
      divisor: args.carryoverDivisor,
    },
  )
  const allocation = allocateIntervals(entriesByAddress, allEvents)
  const entries = finalizeEntries(entriesByAddress)
  const totalRawTickets = entries.reduce((sum, entry) => sum + entry.rawTickets, 0)
  const totalBonusTickets = entries.reduce((sum, entry) => sum + entry.bonusTickets, 0)
  const totalCarryoverTickets = entries.reduce((sum, entry) => sum + entry.carryoverTickets, 0)
  const totalInsiderPracticeTickets = entries.reduce((sum, entry) => sum + entry.insiderPracticeTickets, 0)
  const totalInsiderGrantTickets = entries.reduce((sum, entry) => sum + entry.insiderGrantTickets, 0)
  const totalFinalTickets = entries.reduce((sum, entry) => sum + entry.finalTickets, 0)
  const totalVotingTickets = totalFinalTickets + totalInsiderPracticeTickets + totalInsiderGrantTickets
  if (allocation.rawTicketTotal !== totalRawTickets) {
    throw new Error(`raw ticket allocation mismatch: ${allocation.rawTicketTotal} != ${totalRawTickets}`)
  }
  if (allocation.shuffledBonusTicketTotal !== totalBonusTickets) {
    throw new Error(
      `bonus ticket allocation mismatch: ${allocation.shuffledBonusTicketTotal} != ${totalBonusTickets}`,
    )
  }

  const entriesWithOldSourceAddresses = entries.filter((entry) => entry.sourceAddresses.length > 1).length
  const hashPayload = {
    campaignStart,
    campaignEnd,
    source: sourceResult.source,
    bonusShuffleVersion: allocation.bonusShuffleVersion,
    bonusShuffleSeed: allocation.bonusShuffleSeed,
    totalRawTickets,
    totalBonusTickets,
    totalCarryoverTickets,
    totalInsiderPracticeTickets,
    totalInsiderGrantTickets,
    totalFinalTickets,
    totalVotingTickets,
    carryoverTicketSource,
    insiderTicketGrantSource,
    entries: entries.map((entry) => ({
      userAddress: entry.userAddress,
      rawTickets: entry.rawTickets,
      carryoverTickets: entry.carryoverTickets,
      finalTickets: entry.finalTickets,
      insiderPracticeTickets: entry.insiderPracticeTickets,
      insiderGrantTickets: entry.insiderGrantTickets,
      totalVotingTickets: entry.totalVotingTickets,
      ticketIntervals: entry.ticketIntervals,
    })),
  }
  const ledgerHash = `0x${createHash('sha256').update(stableStringify(hashPayload)).digest('hex')}`
  const generatedAt = Math.floor(Date.now() / 1000)
  const ledger = {
    mode: 'buyback-ledger',
    generatedAt,
    campaignStart,
    campaignEnd,
    totalEntries: entries.length,
    totalRawTickets,
    totalBonusTickets,
    totalCarryoverTickets,
    totalInsiderPracticeTickets,
    totalInsiderGrantTickets,
    totalFinalTickets,
    totalVotingTickets,
    sourceEntries: resolved.canonicalSources.size,
    candidateSourceLimited: false,
    ledgerHash,
    drawContractAddress: process.env.VITE_DRAW_CONTRACT || null,
    bonusShuffleVersion: allocation.bonusShuffleVersion,
    bonusShuffleSeed: allocation.bonusShuffleSeed,
    bonusShuffleLocked: false,
    bonusShuffleLockedAt: null,
    source: sourceResult.source,
    carryoverTicketSource,
    insiderTicketGrantSource,
    packRules,
    entriesWithOldSourceAddresses,
    walletMigrationSource: remoteWalletMigration.meta,
    walletResolveCache: resolved.cacheStats,
    entries,
    notes: [
      'Official ledger path scans BSC contract logs directly.',
      'Legacy pack opens are matched to BuybackSuccessV3 logs on-chain by checkoutId.',
      'No Renaiss activity API fallback is used for ticket counting in this project.',
      'OMEGA buyback events count as 1 raw ticket.',
      'RenaCrypt Pack buyback events count as 2 raw tickets.',
      'EDEN buyback events count as 3 raw tickets.',
      'Costume Pack, MAGMA, Starry Pack, and Plasma Pack matched buybacks count as 2 raw tickets.',
      extraPackRules.length > 0
        ? `Applied ${extraPackRules.length} extra legacy pack rule(s) from ${EXTRA_LEGACY_PACKS_ENV}.`
        : `No extra legacy pack rules were loaded from ${EXTRA_LEGACY_PACKS_ENV}.`,
      'The complete pack rule set used for this ledger is recorded in packRules and source.packEventSources.',
      'Packs not listed in packRules are not counted unless the official rules change.',
      'Base ticket intervals are ordered by block number, transaction index, log index, timestamp, tx hash, then event id.',
      'This football campaign does not apply SBT ticket bonuses; final tickets equal raw buyback plus previous-campaign carryover tickets.',
      carryoverTicketSource.enabled
        ? `Applied ${carryoverTicketSource.totalCarryoverTickets} carryover ticket(s) from ${carryoverTicketSource.appliedWallets} wallet(s): floor(previous van Gogh finalTickets / ${carryoverTicketSource.divisor}).`
        : 'Previous-campaign carryover tickets were explicitly disabled.',
      insiderTicketGrantSource.applied.length > 0
        ? `Applied ${insiderTicketGrantSource.applied.length} insider ticket grant address(es): ${insiderTicketGrantSource.defaultPracticeTickets} practice ticket(s) for round32 and ${insiderTicketGrantSource.defaultGrantTickets} shared reward ticket(s) across round16-final by default.`
        : 'No insider ticket grants were configured.',
      'Leaderboard rank is sorted by final tickets, then raw buyback tickets, then first eligible event time.',
      args.skipWalletResolve
        ? 'Wallet migration resolver was skipped.'
        : 'Wallet migration resolver was applied to merge old and canonical addresses.',
      remoteWalletMigration.pairs.size > 0
        ? `Applied ${remoteWalletMigration.pairs.size} remote TCG Pro old-wallet migration pair(s) before final aggregation. Cache status: ${remoteWalletMigration.meta?.cacheStatus || 'disabled'}.`
        : 'No remote old-wallet migration map was loaded.',
      args.noCache
        ? 'API cache was disabled for this ledger generation.'
        : `API cache enabled: wallet migrations TTL ${args.walletMigrationCacheTtlMinutes} minute(s), wallet resolver TTL ${args.walletResolveCacheTtlMinutes} minute(s), on-chain event overlap ${args.eventCacheOverlapBlocks} block(s).`,
      resolved.cacheStats
        ? `Wallet resolver cache hits ${resolved.cacheStats.hits}, fetched ${resolved.cacheStats.fetched}, skipped by migration map ${resolved.cacheStats.skippedByMigrationMap}.`
        : 'Wallet resolver cache stats were not recorded.',
      localWalletMigrationMap.size > 0
        ? `Applied ${localWalletMigrationMap.size} local old-wallet migration pair(s), overriding remote pairs where addresses overlap.`
        : 'No local old-wallet migration map was provided.',
    ],
  }

  console.log(
    `Ledger: ${entries.length} entries, ${allEvents.length} eligible events, ${totalFinalTickets} final tickets, ${totalVotingTickets} voting tickets`,
  )
  console.log(`Carryover: ${totalCarryoverTickets} tickets from ${carryoverTicketSource.appliedWallets} wallet(s)`)
  console.log(`Ledger hash: ${ledgerHash}`)
  console.log(`Source: ${sourceResult.source.mode}, entries with old source addresses: ${entriesWithOldSourceAddresses}`)

  if (args.dryRun) return

  const absoluteOut = new URL(args.out, `file://${process.cwd()}/`)
  const outPath = fileURLToPath(absoluteOut)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(ledger, null, 2)}\n`)
  console.log(`Wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
