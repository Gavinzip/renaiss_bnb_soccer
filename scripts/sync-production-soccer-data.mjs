#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadLocalEnvFiles } from './env-loader.mjs'
import { createEmptyMatchResultsSnapshot, readMatchResultsSnapshot, writeJsonAtomic } from './soccer-match-results.mjs'
import { replaceSqliteVoteState } from './soccer-vote-store-sqlite.mjs'
import { toPositiveInteger } from './soccer-vote-store.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadLocalEnvFiles(repoRoot)

const DEFAULT_PRODUCTION_ORIGIN = 'https://renaiss-worldcup.zeabur.app'
const DEFAULT_LOCAL_DATA_DIR = '.local-data/soccer'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Usage:
  node scripts/sync-production-soccer-data.mjs [--origin <url>] [--data-dir <path>]

Pulls production read APIs into the local soccer data directory:
  - lucky-draw-ledger.json
  - votes/vote-store.sqlite
  - votes/vote-state.json
  - votes/vote-preview.json
  - match-results.json
  - match-draw-ledger.json
  - draw-winners.json
  - production-data-summary.json

This is read-only against production. It does not submit votes or send chain transactions.
`)
}

function resolveLocalPath(value) {
  const path = String(value || '').trim()
  if (!path) return resolve(repoRoot, DEFAULT_LOCAL_DATA_DIR)
  return path.startsWith('/') ? path : resolve(repoRoot, path)
}

function normalizeOrigin(value) {
  const raw = String(value || DEFAULT_PRODUCTION_ORIGIN).trim().replace(/\/+$/, '')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported origin protocol: ${url.protocol}`)
  return url.toString().replace(/\/+$/, '')
}

function safePublicOrigin(origin) {
  const url = new URL(origin)
  return `${url.protocol}//${url.host}`
}

async function fetchJson(origin, path, options = {}) {
  const url = `${origin}${path}`
  const headers = {
    accept: 'application/json',
  }
  const bearerToken = String(process.env.SOCCER_PRODUCTION_API_BEARER_TOKEN || '').trim()
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`

  const response = await fetch(url, {
    headers,
    cache: 'no-store',
  })
  const text = await response.text()
  if (!response.ok) {
    if (options.optional) {
      return {
        ok: false,
        status: response.status,
        payload: options.missingPayload || null,
        error: `HTTP ${response.status}`,
      }
    }
    throw new Error(`${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  try {
    return {
      ok: true,
      status: response.status,
      payload: JSON.parse(text),
      error: null,
    }
  } catch (error) {
    if (options.optional) {
      return {
        ok: false,
        status: response.status,
        payload: options.missingPayload || null,
        error: `Invalid JSON: ${error.message}`,
      }
    }
    throw new Error(`${path} returned invalid JSON: ${error.message}`)
  }
}

function allocationsFromVotePreview(payload) {
  return (Array.isArray(payload?.allocations) ? payload.allocations : []).map((allocation) => ({
    id: allocation.id,
    walletAddress: allocation.walletAddress,
    roundId: allocation.roundId,
    matchId: allocation.matchId,
    teamId: allocation.teamId,
    tickets: allocation.tickets,
    source: 'production-api-vote-preview',
    official: Boolean(allocation.official),
    createdAt: allocation.createdAt,
    updatedAt: allocation.updatedAt,
  }))
}

function voteSummaryFromAllocations(allocations, eventCount = 0) {
  const voters = new Set()
  const rounds = new Map()
  const matches = new Map()
  let submittedTickets = 0

  for (const allocation of allocations) {
    const walletAddress = String(allocation.walletAddress || '').toLowerCase()
    if (walletAddress) voters.add(walletAddress)
    const tickets = toPositiveInteger(allocation.tickets)
    submittedTickets += tickets
    rounds.set(allocation.roundId, (rounds.get(allocation.roundId) || 0) + tickets)
    matches.set(allocation.matchId, (matches.get(allocation.matchId) || 0) + tickets)
  }

  return {
    allocationCount: allocations.length,
    voterCount: voters.size,
    submittedTickets,
    eventCount: toPositiveInteger(eventCount),
    ticketsByRound: Object.fromEntries([...rounds.entries()].sort(([left], [right]) => left.localeCompare(right))),
    ticketsByMatch: Object.fromEntries([...matches.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
}

function ledgerSummary(ledger) {
  return {
    mode: ledger?.mode || null,
    generatedAt: ledger?.generatedAt || null,
    totalEntries: toPositiveInteger(ledger?.totalEntries),
    totalFinalTickets: toPositiveInteger(ledger?.totalFinalTickets),
    totalRawTickets: toPositiveInteger(ledger?.totalRawTickets),
    totalBonusTickets: toPositiveInteger(ledger?.totalBonusTickets),
    ledgerHash: ledger?.ledgerHash || null,
    candidateSourceLimited: Boolean(ledger?.candidateSourceLimited),
  }
}

function missingMatchDrawLedger(reason) {
  return {
    version: 1,
    mode: 'match-draw-ledger',
    sourceLabel: 'production-api',
    sourceStatus: 'missing',
    generatedAt: new Date().toISOString(),
    draws: [],
    errors: [{ message: reason }],
  }
}

function missingDrawWinners(reason) {
  return {
    version: 1,
    mode: 'draw-winners',
    sourceLabel: 'production-api',
    sourceStatus: 'pending',
    generatedAt: null,
    winners: [],
    winnersBySlot: [],
    errors: [{ message: reason }],
  }
}

async function main() {
  if (hasFlag('--help')) {
    printHelp()
    return
  }

  const origin = normalizeOrigin(
    argValue('--origin') || process.env.SOCCER_PRODUCTION_API_ORIGIN || process.env.VITE_LOCAL_PRODUCTION_API_ORIGIN,
  )
  const dataDir = resolveLocalPath(argValue('--data-dir') || process.env.SOCCER_LOCAL_DATA_DIR || process.env.SOCCER_DATA_DIR)
  const paths = {
    dataDir,
    ledger: join(dataDir, 'lucky-draw-ledger.json'),
    votesDir: join(dataDir, 'votes'),
    voteDb: join(dataDir, 'votes/vote-store.sqlite'),
    voteState: join(dataDir, 'votes/vote-state.json'),
    votePreview: join(dataDir, 'votes/vote-preview.json'),
    matchResults: join(dataDir, 'match-results.json'),
    matchDrawLedger: join(dataDir, 'match-draw-ledger.json'),
    drawWinners: join(dataDir, 'draw-winners.json'),
    summary: join(dataDir, 'production-data-summary.json'),
  }

  mkdirSync(paths.votesDir, { recursive: true })

  const ledgerResult = await fetchJson(origin, '/lucky-draw-ledger.json')
  const matchResultsResult = await fetchJson(origin, '/api/match-results', {
    optional: true,
    missingPayload: {
      ...createEmptyMatchResultsSnapshot('Production /api/match-results is not available yet.'),
      sourceLabel: 'production-api',
      sourceStatus: 'missing',
    },
  })
  const votePreviewResult = await fetchJson(origin, '/api/vote-preview')
  const matchDrawLedgerResult = await fetchJson(origin, '/match-draw-ledger.json', {
    optional: true,
    missingPayload: missingMatchDrawLedger('Production match draw ledger is not available yet.'),
  })
  const drawWinnersResult = await fetchJson(origin, '/api/draw-winners', {
    optional: true,
    missingPayload: missingDrawWinners('Production draw winners are not available yet.'),
  })

  const allocations = allocationsFromVotePreview(votePreviewResult.payload)
  const matchResults = matchResultsResult.payload
  writeJsonAtomic(paths.ledger, ledgerResult.payload)
  writeJsonAtomic(paths.matchResults, matchResults)
  const syncedAt = new Date().toISOString()
  replaceSqliteVoteState({
    dbPath: paths.voteDb,
    allocations,
    statePath: paths.voteState,
    previewPath: paths.votePreview,
    matchResults: readMatchResultsSnapshot(paths.matchResults),
    meta: {
      sourceLabel: 'production-api-vote-preview',
      sourceStatus: votePreviewResult.payload?.sourceStatus || 'live',
      syncedFromProductionAt: syncedAt,
      productionOrigin: safePublicOrigin(origin),
    },
  })
  writeJsonAtomic(paths.matchDrawLedger, matchDrawLedgerResult.payload)
  writeJsonAtomic(paths.drawWinners, drawWinnersResult.payload)

  const summary = {
    version: 1,
    mode: 'production-data-sync-summary',
    sourceLabel: 'production-api',
    sourceStatus: 'synced',
    productionOrigin: safePublicOrigin(origin),
    generatedAt: syncedAt,
    ledger: ledgerSummary(ledgerResult.payload),
    votes: voteSummaryFromAllocations(allocations, votePreviewResult.payload?.eventCount),
    matchResults: {
      sourceLabel: matchResults?.sourceLabel || null,
      sourceStatus: matchResults?.sourceStatus || null,
      generatedAt: matchResults?.generatedAt || null,
      resultCount: Array.isArray(matchResults?.results) ? matchResults.results.length : 0,
      confirmedCount: Array.isArray(matchResults?.results)
        ? matchResults.results.filter((result) => result.resultStatus === 'confirmed').length
        : 0,
    },
    optionalFiles: {
      matchDrawLedger: {
        ok: matchDrawLedgerResult.ok,
        status: matchDrawLedgerResult.status,
        sourceStatus: matchDrawLedgerResult.payload?.sourceStatus || null,
        drawCount: Array.isArray(matchDrawLedgerResult.payload?.draws) ? matchDrawLedgerResult.payload.draws.length : 0,
        error: matchDrawLedgerResult.error,
      },
      drawWinners: {
        ok: drawWinnersResult.ok,
        status: drawWinnersResult.status,
        sourceStatus: drawWinnersResult.payload?.sourceStatus || null,
        winnerCount: Array.isArray(drawWinnersResult.payload?.winners) ? drawWinnersResult.payload.winners.length : 0,
        error: drawWinnersResult.error,
      },
    },
    files: paths,
    notes: [
      'Production data sync is read-only against the production API.',
      'Local SQLite vote-store is rebuilt from production vote-preview allocations for local draw testing.',
      'No fake vote allocation is generated by this sync command.',
    ],
  }
  writeJsonAtomic(paths.summary, summary)

  console.log(JSON.stringify({
    ok: true,
    productionOrigin: summary.productionOrigin,
    dataDir,
    ledger: summary.ledger,
    votes: summary.votes,
    matchResults: summary.matchResults,
    optionalFiles: summary.optionalFiles,
    files: {
      ledger: paths.ledger,
      voteDb: paths.voteDb,
      voteState: paths.voteState,
      votePreview: paths.votePreview,
      matchResults: paths.matchResults,
      matchDrawLedger: paths.matchDrawLedger,
      drawWinners: paths.drawWinners,
      summary: paths.summary,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
