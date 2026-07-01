#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_CARRYOVER_DIVISOR,
  DEFAULT_CARRYOVER_LEDGER_URL,
  applyCarryoverTickets,
  readCarryoverLedgerPayload,
  toTicketInteger,
} from './lucky-draw/carryover-tickets.mjs'
import { WALLET_MIGRATIONS_URL } from './lucky-draw/rules.mjs'
import { normalizeAddress, readEnvFile, readWalletMigrationMap, toNumber } from './lucky-draw/utils.mjs'
import { fetchWalletMigrationMap } from './lucky-draw/wallet-migrations.mjs'
import { normalizeFootballLedger, normalizeFootballLedgerEntry } from './soccer-ledger-api.mjs'

const DEFAULT_LEDGER_PATH = 'public/lucky-draw-ledger.json'

function parseArgs(argv) {
  const cliCarryoverLedgerUrl = argv.includes('--carryover-ledger-url')
  const cliCarryoverLedgerPath = argv.includes('--carryover-ledger-path')
  const cliCarryoverDivisor = argv.includes('--carryover-divisor')
  const cliOut = argv.includes('--out')
  const args = {
    envFile: '',
    ledgerPath: process.env.LUCKY_DRAW_LEDGER_PATH || DEFAULT_LEDGER_PATH,
    out: process.env.LUCKY_DRAW_LEDGER_PATH || '',
    walletMigrationMapPath: '',
    walletMigrationUrl: process.env.WALLET_MIGRATIONS_URL || WALLET_MIGRATIONS_URL,
    cacheDir: process.env.LUCKY_DRAW_CACHE_DIR || 'cache/lucky-draw',
    walletMigrationCacheTtlMinutes: 15,
    carryoverLedgerUrl: process.env.SOCCER_CARRYOVER_LEDGER_URL || DEFAULT_CARRYOVER_LEDGER_URL,
    carryoverLedgerPath: process.env.SOCCER_CARRYOVER_LEDGER_PATH || '',
    carryoverDivisor: toNumber(process.env.SOCCER_CARRYOVER_DIVISOR || DEFAULT_CARRYOVER_DIVISOR),
    skipCarryoverLedger: process.env.SOCCER_CARRYOVER_LEDGER_DISABLED === '1',
    skipWalletMigrationUrl: false,
    noCache: false,
    refreshCache: false,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--ledger') args.ledgerPath = argv[++index] || args.ledgerPath
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--wallet-migration-map') args.walletMigrationMapPath = argv[++index] || ''
    else if (arg === '--wallet-migration-url') args.walletMigrationUrl = argv[++index] || ''
    else if (arg === '--cache-dir') args.cacheDir = argv[++index] || args.cacheDir
    else if (arg === '--wallet-migration-cache-ttl-minutes') args.walletMigrationCacheTtlMinutes = toNumber(argv[++index])
    else if (arg === '--carryover-ledger-url') args.carryoverLedgerUrl = argv[++index] || ''
    else if (arg === '--carryover-ledger-path') args.carryoverLedgerPath = argv[++index] || ''
    else if (arg === '--carryover-divisor') args.carryoverDivisor = toNumber(argv[++index])
    else if (arg === '--skip-carryover-ledger') args.skipCarryoverLedger = true
    else if (arg === '--skip-wallet-migration-url') args.skipWalletMigrationUrl = true
    else if (arg === '--no-cache') args.noCache = true
    else if (arg === '--refresh-cache') args.refreshCache = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  if (args.envFile) {
    const envValues = readEnvFile(args.envFile)
    args.ledgerPath = envValues.LUCKY_DRAW_LEDGER_PATH || args.ledgerPath
    args.out = envValues.LUCKY_DRAW_LEDGER_PATH || args.out
    args.walletMigrationUrl = envValues.WALLET_MIGRATIONS_URL || args.walletMigrationUrl
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
  }

  args.carryoverDivisor = Math.max(1, Math.floor(args.carryoverDivisor || DEFAULT_CARRYOVER_DIVISOR))
  if (!cliOut) args.out = args.ledgerPath
  args.walletMigrationCacheTtlMs = Math.max(0, args.walletMigrationCacheTtlMinutes) * 60 * 1000
  args.walletMigrationCachePath = `${args.cacheDir}/wallet-migrations.json`
  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/apply-carryover-ledger.mjs --ledger <football-ledger.json> --out <football-ledger.json>

Reads an existing football ledger and adds previous Van Gogh campaign carryover
tickets without rescanning football buyback events.

Options:
  --env-file <path>             Optional env file.
  --ledger <path>               Existing football ledger. Default ${DEFAULT_LEDGER_PATH}.
  --out <path>                  Output path. Default same as --ledger.
  --wallet-migration-map <path> Optional old-wallet -> new-wallet JSON map.
  --wallet-migration-url <url>  Remote old-wallet -> new-wallet JSON map.
  --carryover-ledger-url <url>  Previous campaign ledger URL. Default ${DEFAULT_CARRYOVER_LEDGER_URL}.
  --carryover-ledger-path <path> Read previous campaign ledger from local JSON instead of URL.
  --carryover-divisor <n>       Previous campaign finalTickets divisor. Default ${DEFAULT_CARRYOVER_DIVISOR}.
  --skip-wallet-migration-url   Do not load the remote wallet migration list.
  --skip-carryover-ledger       Explicitly disable previous-campaign carryover tickets.
  --no-cache                    Disable wallet migration cache reads/writes.
  --refresh-cache               Ignore fresh wallet migration cache and refetch.
  --dry-run                     Print summary without writing.
`)
}

function readJsonFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function emptyCarryoverEntry(walletAddress, sourceAddresses, packKeys) {
  return {
    rank: 0,
    userAddress: walletAddress,
    sourceAddresses: [...sourceAddresses].map(normalizeAddress).filter(Boolean),
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

function entriesByAddressFromLedger(ledger) {
  const entriesByAddress = new Map()
  for (const row of Array.isArray(ledger.entries) ? ledger.entries : []) {
    const entry = normalizeFootballLedgerEntry(row)
    const address = normalizeAddress(entry.userAddress)
    if (!address) continue
    entriesByAddress.set(address, entry)
  }
  return entriesByAddress
}

function updateCarryoverNotes(notes, source) {
  const cleaned = (Array.isArray(notes) ? notes : []).filter((note) => {
    const text = String(note || '')
    return !text.includes('carryover ticket(s)')
      && !text.startsWith('Previous-campaign carryover tickets')
  })
  return [
    ...cleaned,
    source.enabled
      ? `Applied ${source.totalCarryoverTickets} carryover ticket(s) from ${source.appliedWallets} wallet(s): floor(previous van Gogh finalTickets / ${source.divisor}).`
      : 'Previous-campaign carryover tickets were explicitly disabled.',
  ]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const ledger = readJsonFile(args.ledgerPath, 'Football ledger')
  const localWalletMigrationMap = readWalletMigrationMap(args.walletMigrationMapPath)
  const remoteWalletMigration = args.skipWalletMigrationUrl
    ? { pairs: new Map(), meta: null }
    : await fetchWalletMigrationMap(args.walletMigrationUrl, args)
  const walletMigrationMap = new Map(remoteWalletMigration.pairs)
  for (const [oldAddress, newAddress] of localWalletMigrationMap.entries()) {
    walletMigrationMap.set(oldAddress, newAddress)
  }

  const entriesByAddress = entriesByAddressFromLedger(ledger)
  const carryoverLedger = await readCarryoverLedgerPayload(args)
  const packKeys = (Array.isArray(ledger.packRules) ? ledger.packRules : [])
    .map((rule) => String(rule?.pack || '').trim())
    .filter(Boolean)
  const carryoverTicketSource = applyCarryoverTickets(
    entriesByAddress,
    carryoverLedger,
    walletMigrationMap,
    {
      createEntry: (walletAddress, sourceAddresses) => emptyCarryoverEntry(walletAddress, sourceAddresses, packKeys),
      divisor: args.carryoverDivisor,
      replace: true,
    },
  )
  const updatedLedger = normalizeFootballLedger({
    ...ledger,
    generatedAt: Math.floor(Date.now() / 1000),
    carryoverTicketSource,
    walletMigrationSource: remoteWalletMigration.meta || ledger.walletMigrationSource || null,
    entries: [...entriesByAddress.values()],
    notes: updateCarryoverNotes(ledger.notes, carryoverTicketSource),
  })

  const beforeCarryoverTickets = toTicketInteger(ledger.totalCarryoverTickets)
  const afterCarryoverTickets = toTicketInteger(updatedLedger.totalCarryoverTickets)
  console.log(
    `Carryover: ${beforeCarryoverTickets} -> ${afterCarryoverTickets} tickets from ${carryoverTicketSource.appliedWallets} wallet(s)`,
  )
  console.log(
    `Ledger: ${toTicketInteger(ledger.totalEntries)} -> ${toTicketInteger(updatedLedger.totalEntries)} entries, `
      + `${toTicketInteger(ledger.totalFinalTickets)} -> ${toTicketInteger(updatedLedger.totalFinalTickets)} final tickets`,
  )
  console.log(`Ledger hash: ${ledger.ledgerHash || 'missing'} -> ${updatedLedger.ledgerHash}`)

  if (args.dryRun) return

  const absoluteOut = new URL(args.out, `file://${process.cwd()}/`)
  const outPath = fileURLToPath(absoluteOut)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(updatedLedger, null, 2)}\n`)
  console.log(`Wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
