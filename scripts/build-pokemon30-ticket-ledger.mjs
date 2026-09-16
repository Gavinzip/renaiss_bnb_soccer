#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { blockByTimestamp } from './lucky-draw/bscscan.mjs'
import { readEnvFile } from './lucky-draw/utils.mjs'
import {
  mergePokemon30EventCache,
  readPokemon30EventCache,
  resolvePokemon30ScanWindow,
  writePokemon30EventCache,
} from './pokemon30/event-cache.mjs'
import { readPokemon30CheckoutBuybackLinks, reconcilePokemon30Tickets } from './pokemon30/outcome-ledger.mjs'
import { POKEMON30_EVENT_END, POKEMON30_EVENT_START, parsePokemon30PackRules } from './pokemon30/rules.mjs'
import { scanPokemon30VrfV3Buybacks, scanPokemon30VrfV3Purchases } from './pokemon30/scan-vrf-v3.mjs'

function parseArgs(argv) {
  const args = {
    envFile: '',
    checkoutBuybackLinks: process.env.POKEMON30_CHECKOUT_BUYBACK_LINK_PATH || '',
    out: process.env.POKEMON30_TICKET_LEDGER_PATH || '/data/pokemon30/ticket-ledger.json',
    dryRun: false,
    fromBlock: 0,
    toBlock: 0,
    eventCachePath: process.env.POKEMON30_EVENT_CACHE_PATH || '',
    eventCacheLookbackRounds: 0,
    noEventCache: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--checkout-buyback-links') args.checkoutBuybackLinks = argv[++index] || ''
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--from-block') args.fromBlock = Number(argv[++index] || 0)
    else if (arg === '--to-block') args.toBlock = Number(argv[++index] || 0)
    else if (arg === '--event-cache-path') args.eventCachePath = argv[++index] || ''
    else if (arg === '--event-cache-lookback-rounds') args.eventCacheLookbackRounds = Number(argv[++index] || 0)
    else if (arg === '--no-event-cache') args.noEventCache = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/build-pokemon30-ticket-ledger.mjs --env-file config/pokemon30.env.local --checkout-buyback-links /secure/checkout-buyback-links.json [--event-cache-lookback-rounds 5] [--dry-run]')
      process.exit(0)
    }
  }
  return args
}

function envValue(env, name) {
  return String(env[name] || process.env[name] || '').trim()
}

function envFlag(env, name) {
  return ['1', 'true', 'yes'].includes(envValue(env, name).toLowerCase())
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = args.envFile ? readEnvFile(args.envFile) : {}
  const packRules = parsePokemon30PackRules(envValue(env, 'POKEMON30_PACK_RULES_JSON'), {
    allowPendingLimited100: envFlag(env, 'POKEMON30_ALLOW_PENDING_LIMITED_100'),
  })
  if (!packRules.ok) throw Object.assign(new Error(packRules.message), { code: packRules.code })

  const checkoutBuybackLinks = readPokemon30CheckoutBuybackLinks(
    args.checkoutBuybackLinks || envValue(env, 'POKEMON30_CHECKOUT_BUYBACK_LINK_PATH'),
  )
  const scanArgs = {
    apiKey: envValue(env, 'BSCSCAN_API_KEY'),
    apiUrl: envValue(env, 'BSCSCAN_API_URL') || undefined,
    chainId: Number(envValue(env, 'BSCSCAN_CHAIN_ID') || 56),
    retries: Number(envValue(env, 'BSCSCAN_RETRIES') || 5),
    backoffMs: Number(envValue(env, 'BSCSCAN_BACKOFF_MS') || 900),
    requestTimeoutMs: Number(envValue(env, 'BSCSCAN_REQUEST_TIMEOUT_MS') || 30_000),
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    blockChunk: Number(envValue(env, 'POKEMON30_BLOCK_CHUNK') || 4_000),
    pageSize: Number(envValue(env, 'POKEMON30_LOG_PAGE_SIZE') || 1_000),
    paymentToken: envValue(env, 'POKEMON30_PAYMENT_TOKEN') || undefined,
    packs: packRules.packs,
  }
  const now = Math.floor(Date.now() / 1000)
  const windowEnd = Math.min(POKEMON30_EVENT_END, now)
  if (windowEnd < POKEMON30_EVENT_START) {
    throw Object.assign(new Error('Pokémon 30 ticket scanning is unavailable before the campaign starts.'), {
      code: 'pokemon30_campaign_not_started',
      result: { eventId: 'pokemon-30th-celebration-2026', windowEnd },
    })
  }
  const cachePath = args.eventCachePath || envValue(env, 'POKEMON30_EVENT_CACHE_PATH') || join(dirname(args.out), 'onchain-events.json')
  const lookbackRounds = positiveInteger(
    args.eventCacheLookbackRounds || envValue(env, 'POKEMON30_EVENT_CACHE_LOOKBACK_ROUNDS'),
    5,
  )
  const bscscanConfig = {
    apiKey: scanArgs.apiKey,
    apiUrl: scanArgs.apiUrl,
    chainId: scanArgs.chainId,
    retries: scanArgs.retries,
    backoffMs: scanArgs.backoffMs,
    requestTimeoutMs: scanArgs.requestTimeoutMs,
  }
  if (!String(bscscanConfig.apiKey || '').trim()) {
    throw Object.assign(new Error('BSCSCAN_API_KEY is required for the read-only Pokémon 30 V3 scan.'), {
      code: 'pokemon30_bscscan_api_key_missing',
    })
  }
  const campaignStartBlock = positiveInteger(
    args.fromBlock || await blockByTimestamp(bscscanConfig, POKEMON30_EVENT_START, 'after'),
    0,
  )
  const scanEndBlock = positiveInteger(
    args.toBlock || await blockByTimestamp(bscscanConfig, windowEnd, 'before'),
    0,
  )
  if (!campaignStartBlock || !scanEndBlock || scanEndBlock < campaignStartBlock) {
    throw Object.assign(new Error('Could not resolve a valid Pokémon 30 campaign block range.'), {
      code: 'pokemon30_scan_window_invalid',
    })
  }
  const eventCache = args.noEventCache ? null : readPokemon30EventCache(cachePath)
  const scanWindow = args.noEventCache
    ? {
        campaignStartBlock,
        scanStartBlock: campaignStartBlock,
        toBlock: scanEndBlock,
        lookbackRounds: 0,
        selectedCheckpoints: [],
        mode: 'uncached-full-scan',
      }
    : resolvePokemon30ScanWindow({
        cache: eventCache,
        campaignStartBlock,
        toBlock: scanEndBlock,
        lookbackRounds,
      })
  scanArgs.fromBlock = scanWindow.scanStartBlock
  scanArgs.toBlock = scanWindow.toBlock
  const [scan, buybackScan] = await Promise.all([
    scanPokemon30VrfV3Purchases(scanArgs),
    scanPokemon30VrfV3Buybacks(scanArgs),
  ])
  if (scan.source.notStarted || buybackScan.source.notStarted) {
    throw Object.assign(new Error('Pokémon 30 ticket scanning is unavailable before the campaign starts.'), {
      code: 'pokemon30_campaign_not_started',
      result: { eventId: 'pokemon-30th-celebration-2026', source: scan.source },
    })
  }
  const nextEventCache = args.noEventCache
    ? null
    : mergePokemon30EventCache({
        cache: eventCache,
        window: scanWindow,
        purchases: scan.allPurchases,
        buybacks: buybackScan.buybacks,
      })
  const cachePurchases = nextEventCache ? nextEventCache.sources.checkout.events : scan.purchases
  const configuredPackIds = new Set(packRules.packs.map((pack) => pack.packId))
  const reconciledPurchases = cachePurchases.filter((purchase) => configuredPackIds.has(String(purchase?.packId || '').toLowerCase()))
  if (nextEventCache) writePokemon30EventCache(cachePath, nextEventCache)
  const ledger = reconcilePokemon30Tickets({
    purchases: reconciledPurchases,
    checkoutBuybackLinks,
    buybacks: nextEventCache ? nextEventCache.sources.buyback.events : buybackScan.buybacks,
    packs: packRules.packs,
    pendingPackConfigurations: packRules.pendingPacks,
  })
  const result = {
    eventId: ledger.eventId,
    sourceStatus: ledger.sourceStatus,
    source: {
      checkout: scan.source,
      buyback: buybackScan.source,
      eventCache: nextEventCache
        ? {
            path: cachePath,
            mode: scanWindow.mode,
            scanStartBlock: scanWindow.scanStartBlock,
            toBlock: scanWindow.toBlock,
            lookbackRounds: scanWindow.lookbackRounds,
            checkpointCount: nextEventCache.blockCheckpoints.length,
            selectedCheckpoints: scanWindow.selectedCheckpoints,
          }
        : { mode: scanWindow.mode },
    },
    totals: ledger.totals,
    reconciliation: ledger.reconciliation,
    pendingPackConfigurations: ledger.pendingPackConfigurations,
    cachedCheckoutEventCount: nextEventCache ? nextEventCache.sources.checkout.events.length : scan.allPurchases.length,
    configuredCheckoutEventCount: reconciledPurchases.length,
    rejectedPurchaseRecords: scan.rejected.length,
    rejectedBuybackRecords: buybackScan.rejected.length,
    ledgerHash: ledger.ledgerHash,
  }
  if (ledger.sourceStatus !== 'ready') {
    throw Object.assign(new Error(`Refusing to publish a partial ticket ledger: ${ledger.reconciliation.unresolvedCheckoutCount} unresolved and ${ledger.reconciliation.invalidRecordCount} invalid records.`), {
      code: 'pokemon30_reconciliation_blocked',
      result,
    })
  }
  if (!args.dryRun) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, `${JSON.stringify(ledger, null, 2)}\n`)
  }
  console.log(JSON.stringify({ ...result, out: args.dryRun ? null : args.out }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'pokemon30_ledger_failed', error: error?.message || String(error), result: error?.result || null }))
  process.exit(1)
})
