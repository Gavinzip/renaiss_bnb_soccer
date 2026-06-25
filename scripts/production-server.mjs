#!/usr/bin/env node
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

import { milestones } from '../src/app/data/worldCupCampaign.js'
import {
  createAuthContext,
  getAuthPublicStatus,
  handleAuthRoute,
  readAuthSession,
} from './auth/routes.mjs'
import { createUserProfileStore } from './auth/user-profile-store.mjs'
import { getXFollowStatus } from './auth/x-follow-gate.mjs'
import {
  buildLedgerEntryResponse,
  buildLedgerSummary,
  buildTicketLookupResponse,
  findLedgerEntry,
  parseTicketLookupQuery,
  parseEntryIntervalQuery,
  readLedgerPayload,
} from './soccer-ledger-api.mjs'
import { readMatchResultsSnapshot, summarizeMatchResults } from './soccer-match-results.mjs'
import { readVotePreview, readVoteState, submitVote } from './soccer-vote-store.mjs'
import { createSqliteVoteStore } from './soccer-vote-store-sqlite.mjs'
import { loadLocalEnvFiles } from './env-loader.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadLocalEnvFiles(repoRoot)

const port = Number(process.env.PORT || 3000)
const runtimeTarget = normalizeRuntimeTarget(process.env.SOCCER_RUNTIME_TARGET || process.env.RENAISS_RUNTIME_TARGET || 'server')
applyRuntimeDefaults({ runtimeTarget, repoRoot, port })

const distDir = resolve(repoRoot, 'dist')
const dataDir = process.env.SOCCER_DATA_DIR || process.env.LUCKY_DRAW_DATA_DIR || '/data/soccer'
const cacheDir = process.env.LUCKY_DRAW_CACHE_DIR || join(dataDir, 'cache')
const ledgerPath = process.env.LUCKY_DRAW_LEDGER_PATH || join(dataDir, 'lucky-draw-ledger.json')
const snapshotDir = process.env.LUCKY_DRAW_SNAPSHOT_DIR || join(dataDir, 'snapshots')
const votesDir = process.env.SOCCER_VOTES_DIR || join(dataDir, 'votes')
const voteEventsPath = process.env.SOCCER_VOTE_EVENTS_PATH || join(votesDir, 'vote-events.jsonl')
const voteStatePath = process.env.SOCCER_VOTE_STATE_PATH || join(votesDir, 'vote-state.json')
const votePreviewPath = process.env.SOCCER_VOTE_PREVIEW_PATH || join(votesDir, 'vote-preview.json')
const voteStoreMode = normalizeVoteStoreMode(process.env.SOCCER_VOTE_STORE || 'json')
const voteDbPath = process.env.SOCCER_VOTE_DB_PATH || join(votesDir, 'vote-store.sqlite')
const profileDbPath = process.env.SOCCER_PROFILE_DB_PATH || join(dataDir, 'profiles/user-profiles.sqlite')
const matchResultsPath = process.env.SOCCER_MATCH_RESULTS_PATH || join(dataDir, 'match-results.json')
const matchDrawLedgerPath = process.env.SOCCER_MATCH_DRAW_LEDGER_PATH || join(dataDir, 'match-draw-ledger.json')
const drawWinnersPath = process.env.SOCCER_DRAW_WINNERS_PATH || join(dataDir, 'draw-winners.json')
const winnerRevealVideoUrl = process.env.WINNER_REVEAL_VIDEO_URL || process.env.VITE_WINNER_REVEAL_VIDEO_URL || ''
const fifaSourceMapPath = process.env.FIFA_RESULTS_SOURCE_MAP_PATH || join(dataDir, 'fifa-match-map.json')
const userProfileStore = createUserProfileStore({ dbPath: profileDbPath })
const auth = createAuthContext({ dataDir, userProfileStore })
const snapshotKeep = readIntegerEnv('LUCKY_DRAW_SNAPSHOT_KEEP', 72, 1)
const refreshMinutes = readIntegerEnv('LUCKY_DRAW_REFRESH_MINUTES', 5, 1)
const refreshIntervalMs = refreshMinutes * 60 * 1000
const refreshHistoryLimit = readIntegerEnv('LUCKY_DRAW_REFRESH_HISTORY_LIMIT', 24, 1)
const refreshEnabled = process.env.LUCKY_DRAW_REFRESH_ENABLED !== '0'
const refreshOnStartup = process.env.LUCKY_DRAW_REFRESH_ON_STARTUP !== '0'
const fifaResultSyncMinutes = readIntegerEnv('FIFA_RESULT_SYNC_MINUTES', 10, 1)
const fifaResultSyncIntervalMs = fifaResultSyncMinutes * 60 * 1000
const fifaResultSyncHistoryLimit = readIntegerEnv('FIFA_RESULT_SYNC_HISTORY_LIMIT', 24, 1)
const fifaResultSyncEnabled = process.env.FIFA_RESULT_SYNC_ENABLED !== '0'
const fifaResultSyncOnStartup = process.env.FIFA_RESULT_SYNC_ON_STARTUP !== '0'
const backupIntervalMinutes = readIntegerEnv('DATA_BACKUP_INTERVAL_MINUTES', 60, 1)
const backupIntervalMs = backupIntervalMinutes * 60 * 1000
const backupHistoryLimit = readIntegerEnv('DATA_BACKUP_HISTORY_LIMIT', 24, 1)
const backupRepoUrl = process.env.DATA_BACKUP_REPO_URL || ''
const backupEnabled = Boolean(backupRepoUrl && process.env.DATA_BACKUP_GITHUB_TOKEN) && process.env.DATA_BACKUP_ENABLED !== '0'
const restoreHistoryLimit = readIntegerEnv('DATA_BACKUP_RESTORE_HISTORY_LIMIT', 12, 1)
const restoreOnStartup = process.env.DATA_BACKUP_RESTORE_ON_STARTUP !== '0'
const restoreEnabled = Boolean(backupRepoUrl && process.env.DATA_BACKUP_GITHUB_TOKEN) && restoreOnStartup
const blockChunk = process.env.LUCKY_DRAW_BLOCK_CHUNK || '20000'
const resolveConcurrency = process.env.LUCKY_DRAW_RESOLVE_CONCURRENCY || '3'
const delayMs = process.env.LUCKY_DRAW_DELAY_MS || '30'
const retries = process.env.LUCKY_DRAW_RETRIES || '8'
const backoffMs = process.env.LUCKY_DRAW_BACKOFF_MS || '1000'
const requestBodyLimitBytes = readIntegerEnv('HTTP_JSON_BODY_LIMIT_BYTES', 64 * 1024, 1024)
const authRequiredForVotes = process.env.AUTH_REQUIRE_SESSION_FOR_VOTES !== '0'

function normalizeVoteStoreMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (!mode || mode === 'json') return 'json'
  if (mode === 'sqlite') return 'sqlite'
  throw new Error(`Unsupported SOCCER_VOTE_STORE=${value}. Use json or sqlite.`)
}

function normalizeRuntimeTarget(value) {
  const target = String(value || '').trim().toLowerCase()
  if (!target || ['server', 'production', 'prod'].includes(target)) return 'server'
  if (['local', 'dev', 'development'].includes(target)) return 'local'
  throw new Error(`Unsupported SOCCER_RUNTIME_TARGET=${value}. Use server or local.`)
}

function resolveRuntimePath(rootDir, value) {
  const path = String(value || '').trim()
  if (!path) return ''
  return path.startsWith('/') ? path : resolve(rootDir, path)
}

function applyDefaultEnv(name, value, { replace = [] } = {}) {
  const current = process.env[name]
  if (current === undefined || current === '' || replace.includes(current)) {
    process.env[name] = value
  }
}

function applyRuntimeDefaults({ runtimeTarget, repoRoot, port }) {
  if (runtimeTarget !== 'local') return

  const localDataDir = resolveRuntimePath(repoRoot, process.env.SOCCER_LOCAL_DATA_DIR || '.local-data/soccer')
  const localOrigin = process.env.SOCCER_LOCAL_APP_ORIGIN || `http://127.0.0.1:${port}`
  const serverDataDir = '/data/soccer'
  const serverOrigin = 'https://renaiss-worldcup.zeabur.app'
  const localDefaultDirs = [
    '.local-data/soccer',
    '.local-data/soccer-production',
    '.local-data/soccer-test-batch',
  ]
  const localDataReplacements = [
    serverDataDir,
    ...localDefaultDirs,
    ...localDefaultDirs.map((path) => resolve(repoRoot, path)),
  ]
  const localPathReplacements = (...suffixes) => [
    ...suffixes.map((suffix) => `${serverDataDir}/${suffix}`),
    ...localDefaultDirs.flatMap((dir) => suffixes.map((suffix) => `${dir}/${suffix}`)),
    ...localDefaultDirs.flatMap((dir) => suffixes.map((suffix) => join(resolve(repoRoot, dir), suffix))),
  ]

  applyDefaultEnv('SOCCER_DATA_DIR', localDataDir, { replace: localDataReplacements })
  applyDefaultEnv('LUCKY_DRAW_DATA_DIR', localDataDir, { replace: localDataReplacements })
  applyDefaultEnv('LUCKY_DRAW_CACHE_DIR', join(localDataDir, 'cache'), { replace: localPathReplacements('cache') })
  applyDefaultEnv('LUCKY_DRAW_LEDGER_PATH', join(localDataDir, 'lucky-draw-ledger.json'), {
    replace: localPathReplacements('lucky-draw-ledger.json'),
  })
  applyDefaultEnv('LUCKY_DRAW_SNAPSHOT_DIR', join(localDataDir, 'snapshots'), {
    replace: localPathReplacements('snapshots'),
  })
  applyDefaultEnv('SOCCER_VOTES_DIR', join(localDataDir, 'votes'), { replace: localPathReplacements('votes') })
  applyDefaultEnv('SOCCER_VOTE_STORE', 'sqlite')
  applyDefaultEnv('SOCCER_VOTE_DB_PATH', join(localDataDir, 'votes/vote-store.sqlite'), {
    replace: localPathReplacements('votes/vote-store.sqlite'),
  })
  applyDefaultEnv('SOCCER_PROFILE_DB_PATH', join(localDataDir, 'profiles/user-profiles.sqlite'), {
    replace: localPathReplacements('profiles/user-profiles.sqlite'),
  })
  applyDefaultEnv('SOCCER_VOTE_STATE_PATH', join(localDataDir, 'votes/vote-state.json'), {
    replace: localPathReplacements('votes/vote-state.json'),
  })
  applyDefaultEnv('SOCCER_VOTE_PREVIEW_PATH', join(localDataDir, 'votes/vote-preview.json'), {
    replace: localPathReplacements('votes/vote-preview.json'),
  })
  applyDefaultEnv('SOCCER_MATCH_RESULTS_PATH', join(localDataDir, 'match-results.json'), {
    replace: localPathReplacements('match-results.json'),
  })
  applyDefaultEnv('SOCCER_MATCH_DRAW_LEDGER_PATH', join(localDataDir, 'match-draw-ledger.json'), {
    replace: localPathReplacements('match-draw-ledger.json'),
  })
  applyDefaultEnv('SOCCER_DRAW_WINNERS_PATH', join(localDataDir, 'draw-winners.json'), {
    replace: localPathReplacements('draw-winners.json'),
  })
  applyDefaultEnv('FIFA_RESULTS_SOURCE_MAP_PATH', join(localDataDir, 'fifa-match-map.json'), {
    replace: localPathReplacements('fifa-match-map.json'),
  })

  applyDefaultEnv('PUBLIC_APP_ORIGIN', localOrigin, { replace: [serverOrigin] })
  applyDefaultEnv('AUTH_PUBLIC_ORIGIN', localOrigin, { replace: [serverOrigin] })
  applyDefaultEnv('GOOGLE_REDIRECT_URI', `${localOrigin}/api/auth/google/callback`, {
    replace: [`${serverOrigin}/api/auth/google/callback`],
  })
  applyDefaultEnv('DISCORD_REDIRECT_URI', `${localOrigin}/api/auth/discord/callback`, {
    replace: [`${serverOrigin}/api/auth/discord/callback`],
  })
  applyDefaultEnv('X_REDIRECT_URI', `${localOrigin}/api/auth/x/callback`, {
    replace: [`${serverOrigin}/api/auth/x/callback`],
  })
  applyDefaultEnv('SIWE_DOMAIN', new URL(localOrigin).host, { replace: ['renaiss-worldcup.zeabur.app'] })
  applyDefaultEnv('AUTH_COOKIE_SECURE', '0', { replace: ['1'] })
  applyDefaultEnv('AUTH_REQUIRE_SESSION_FOR_VOTES', '0', { replace: ['1'] })
  applyDefaultEnv('X_FOLLOW_GATE_REQUIRED', '0', { replace: ['1'] })
  applyDefaultEnv('X_FOLLOW_SKIP_ENABLED', '1', { replace: ['0'] })

  applyDefaultEnv('LUCKY_DRAW_REFRESH_ENABLED', '0')
  applyDefaultEnv('LUCKY_DRAW_REFRESH_ON_STARTUP', '0')
  applyDefaultEnv('FIFA_RESULT_SYNC_ENABLED', '0')
  applyDefaultEnv('FIFA_RESULT_SYNC_ON_STARTUP', '0')
  applyDefaultEnv('DATA_BACKUP_ENABLED', '0')
  applyDefaultEnv('DATA_BACKUP_RESTORE_ON_STARTUP', '0')
}

let refreshRunning = false
let refreshTimer = null
let backupRunning = false
let backupTimer = null
let restoreRunning = false
let lastRefresh = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  exitCode: null,
  error: null,
  trigger: null,
}
let refreshHistory = []
let fifaResultSyncRunning = false
let fifaResultSyncTimer = null
let lastFifaResultSync = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  exitCode: null,
  error: null,
  trigger: null,
}
let fifaResultSyncHistory = []
let lastBackup = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  exitCode: null,
  error: null,
  trigger: null,
}
let backupHistory = []
let lastRestore = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  exitCode: null,
  error: null,
  trigger: null,
}
let restoreHistory = []

function readIntegerEnv(name, fallback, min = 0) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

function durationSeconds(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null
  const started = Date.parse(startedAt)
  const finished = Date.parse(finishedAt)
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null
  return Math.round(((finished - started) / 1000) * 1000) / 1000
}

function rememberRefresh(entry) {
  refreshHistory = [{ ...entry }, ...refreshHistory].slice(0, refreshHistoryLimit)
}

function rememberFifaResultSync(entry) {
  fifaResultSyncHistory = [{ ...entry }, ...fifaResultSyncHistory].slice(0, fifaResultSyncHistoryLimit)
}

function rememberBackup(entry) {
  backupHistory = [{ ...entry }, ...backupHistory].slice(0, backupHistoryLimit)
}

function rememberRestore(entry) {
  restoreHistory = [{ ...entry }, ...restoreHistory].slice(0, restoreHistoryLimit)
}

function readHealthLedgerSnapshot() {
  if (!existsSync(ledgerPath)) {
    return {
      exists: false,
      generatedAt: null,
      generatedAtIso: null,
      ageSeconds: null,
      totalEntries: 0,
      totalFinalTickets: 0,
      ledgerHash: null,
      error: null,
    }
  }

  try {
    const ledger = readLedgerPayload(ledgerPath)
    const generatedAt = Number(ledger.generatedAt || 0)
    const generatedAtIso = generatedAt > 0 ? new Date(generatedAt * 1000).toISOString() : null
    const ageSeconds = generatedAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - generatedAt) : null
    return {
      exists: true,
      generatedAt: generatedAt > 0 ? generatedAt : null,
      generatedAtIso,
      ageSeconds,
      totalEntries: readIntegerValue(ledger.totalEntries),
      totalFinalTickets: readIntegerValue(ledger.totalFinalTickets),
      ledgerHash: ledger.ledgerHash || null,
      error: null,
    }
  } catch (error) {
    return {
      exists: true,
      generatedAt: null,
      generatedAtIso: null,
      ageSeconds: null,
      totalEntries: 0,
      totalFinalTickets: 0,
      ledgerHash: null,
      error: error instanceof Error ? error.message : 'Could not read ledger.',
    }
  }
}

function readHealthMatchResultsSnapshot() {
  if (!existsSync(matchResultsPath)) {
    return {
      exists: false,
      generatedAt: null,
      sourceStatus: 'missing',
      hash: null,
      summary: summarizeMatchResults(null),
      error: null,
    }
  }

  try {
    const snapshot = readMatchResultsSnapshot(matchResultsPath)
    return {
      exists: true,
      generatedAt: snapshot.generatedAt || null,
      sourceStatus: snapshot.sourceStatus || null,
      hash: snapshot.hash || null,
      summary: summarizeMatchResults(snapshot),
      error: null,
    }
  } catch (error) {
    return {
      exists: true,
      generatedAt: null,
      sourceStatus: 'error',
      hash: null,
      summary: summarizeMatchResults(null),
      error: error instanceof Error ? error.message : 'Could not read match results.',
    }
  }
}

function readDrawWinnersSnapshot() {
  if (!existsSync(drawWinnersPath)) {
    return enrichDrawWinnersPayload({
      version: 1,
      mode: 'draw-winners',
      sourceLabel: 'on-chain-reveal',
      sourceStatus: 'pending',
      generatedAt: null,
      videoUrl: winnerRevealVideoUrl,
      winners: [],
      winnersBySlot: [],
    })
  }

  const payload = JSON.parse(readFileSync(drawWinnersPath, 'utf8'))
  return enrichDrawWinnersPayload({
    videoUrl: payload.videoUrl || winnerRevealVideoUrl,
    winners: Array.isArray(payload.winners) ? payload.winners : [],
    winnersBySlot: Array.isArray(payload.winnersBySlot) ? payload.winnersBySlot : [],
    ...payload,
    videoUrl: payload.videoUrl || winnerRevealVideoUrl,
  })
}

const WINNER_WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i

function normalizeWinnerWalletAddress(value) {
  const address = String(value || '').trim()
  return WINNER_WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function winnerWalletAddress(row) {
  if (!row || typeof row !== 'object') return ''
  return normalizeWinnerWalletAddress(
    row.walletAddress
      || row.wallet_address
      || row.userAddress
      || row.user_address
      || row.profile?.walletAddress
      || row.profile?.wallet_address,
  )
}

function collectWinnerAddressesFromRows(rows, addresses) {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const address = winnerWalletAddress(row)
    if (address) addresses.add(address)
  }
}

function collectWinnerProfileAddresses(payload) {
  const addresses = new Set()
  collectWinnerAddressesFromRows(payload?.winners, addresses)
  collectWinnerAddressesFromRows(payload?.winnersBySlot, addresses)
  collectWinnerAddressesFromRows(payload?.winners_by_slot, addresses)
  collectWinnerAddressesFromRows(payload?.alternates, addresses)

  for (const draw of Array.isArray(payload?.draws) ? payload.draws : []) {
    collectWinnerAddressesFromRows(draw?.winners, addresses)
    collectWinnerAddressesFromRows(draw?.alternates, addresses)
    for (const slot of Array.isArray(draw?.prizeSlots) ? draw.prizeSlots : []) {
      const winnerAddress = winnerWalletAddress(slot?.winner)
      if (winnerAddress) addresses.add(winnerAddress)
      collectWinnerAddressesFromRows(slot?.alternates, addresses)
    }
  }

  return [...addresses]
}

function enrichWinnerRows(rows, profilesByWallet) {
  if (!Array.isArray(rows)) return rows
  return rows.map((row) => enrichWinnerRow(row, profilesByWallet))
}

function enrichWinnerRow(row, profilesByWallet) {
  if (!row || typeof row !== 'object') return row
  const address = winnerWalletAddress(row)
  const profile = address ? profilesByWallet.get(address) : null
  if (!profile) return row
  return {
    ...row,
    profile: {
      ...(row.profile && typeof row.profile === 'object' ? row.profile : {}),
      ...profile,
    },
  }
}

function enrichDrawWinnersPayload(payload) {
  const addresses = collectWinnerProfileAddresses(payload)
  const profilesByWallet = userProfileStore.readProfilesForWallets(addresses)
  if (!profilesByWallet.size) return payload

  return {
    ...payload,
    winners: enrichWinnerRows(payload.winners, profilesByWallet),
    winnersBySlot: enrichWinnerRows(payload.winnersBySlot, profilesByWallet),
    winners_by_slot: enrichWinnerRows(payload.winners_by_slot, profilesByWallet),
    alternates: enrichWinnerRows(payload.alternates, profilesByWallet),
    draws: Array.isArray(payload.draws)
      ? payload.draws.map((draw) => ({
        ...draw,
        winners: enrichWinnerRows(draw.winners, profilesByWallet),
        alternates: enrichWinnerRows(draw.alternates, profilesByWallet),
        prizeSlots: Array.isArray(draw.prizeSlots)
          ? draw.prizeSlots.map((slot) => ({
            ...slot,
            winner: enrichWinnerRow(slot.winner, profilesByWallet),
            alternates: enrichWinnerRows(slot.alternates, profilesByWallet),
          }))
          : draw.prizeSlots,
      }))
      : payload.draws,
  }
}

function readIntegerValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function summarizeVoteState(state) {
  const allocations = Array.isArray(state?.allocations) ? state.allocations : []
  const voters = new Set()
  const ticketsByRound = new Map()
  const ticketsByMatch = new Map()
  let submittedTickets = 0

  for (const allocation of allocations) {
    const walletAddress = String(allocation.walletAddress || '').toLowerCase()
    if (walletAddress) voters.add(walletAddress)
    const tickets = readIntegerValue(allocation.tickets)
    submittedTickets += tickets
    const roundId = String(allocation.roundId || '')
    const matchId = String(allocation.matchId || '')
    if (roundId) ticketsByRound.set(roundId, (ticketsByRound.get(roundId) || 0) + tickets)
    if (matchId) ticketsByMatch.set(matchId, (ticketsByMatch.get(matchId) || 0) + tickets)
  }

  return {
    sourceLabel: state?.sourceLabel || null,
    sourceStatus: state?.sourceStatus || null,
    syncedFromProductionAt: state?.syncedFromProductionAt || null,
    productionOrigin: state?.productionOrigin || null,
    allocationCount: allocations.length,
    voterCount: voters.size,
    submittedTickets,
    eventCount: readIntegerValue(state?.eventCount),
    ticketsByRound: Object.fromEntries([...ticketsByRound.entries()].sort(([left], [right]) => left.localeCompare(right))),
    ticketsByMatch: Object.fromEntries([...ticketsByMatch.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
}

function contentType(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.mp4') return 'video/mp4'
  return 'application/octet-stream'
}

function acceptsGzip(request) {
  return /\bgzip\b/i.test(request.headers['accept-encoding'] || '')
}

function shouldCompress(path) {
  return ['.css', '.html', '.js', '.json', '.svg'].includes(extname(path).toLowerCase())
}

function fileFreshnessHeaders(stats) {
  return {
    etag: `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
    lastModified: stats.mtime.toUTCString(),
  }
}

function requestHasFreshFile(request, { etag, lastModified }) {
  const ifNoneMatch = request.headers['if-none-match']
  if (ifNoneMatch && ifNoneMatch.split(',').map((value) => value.trim()).includes(etag)) return true

  const ifModifiedSince = request.headers['if-modified-since']
  if (!ifModifiedSince) return false

  const modifiedSince = Date.parse(ifModifiedSince)
  const lastModifiedAt = Date.parse(lastModified)
  return Number.isFinite(modifiedSince) && Number.isFinite(lastModifiedAt) && modifiedSince >= lastModifiedAt
}

function sendFile(request, response, path, headers = {}) {
  if (!existsSync(path)) {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    })
    response.end('Not found')
    return
  }

  const stats = statSync(path)
  if (!stats.isFile()) {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    })
    response.end('Not found')
    return
  }

  const freshnessHeaders = fileFreshnessHeaders(stats)
  const sharedHeaders = {
    etag: freshnessHeaders.etag,
    'last-modified': freshnessHeaders.lastModified,
    ...headers,
  }

  if (requestHasFreshFile(request, freshnessHeaders)) {
    response.writeHead(304, sharedHeaders)
    response.end()
    return
  }

  const compress = acceptsGzip(request) && shouldCompress(path)
  response.writeHead(200, {
    'content-type': contentType(path),
    ...(shouldCompress(path) ? { vary: 'Accept-Encoding' } : {}),
    ...(compress ? { 'content-encoding': 'gzip' } : {}),
    ...sharedHeaders,
  })
  const stream = createReadStream(path)
  if (compress) {
    stream.pipe(createGzip()).pipe(response)
    return
  }
  stream.pipe(response)
}

function sendJson(request, response, status, payload, headers = {}) {
  const compress = acceptsGzip(request)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    vary: 'Accept-Encoding',
    ...(compress ? { 'content-encoding': 'gzip' } : {}),
    'access-control-allow-origin': '*',
    ...headers,
  })

  const stream = Readable.from([JSON.stringify(payload)])
  if (compress) {
    stream.pipe(createGzip()).pipe(response)
    return
  }
  stream.pipe(response)
}

function sendLedgerApiError(request, response, error) {
  sendJson(
    request,
    response,
    503,
    {
      error: error instanceof Error ? error.message : 'Could not read soccer ticket ledger.',
    },
    {
      'cache-control': 'no-store',
    },
  )
}

function distPathForUrl(url) {
  const rawPath = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(distDir, `.${safePath}`)
  return candidate.startsWith(distDir) ? candidate : null
}

function buildMilestoneSummary(ledger) {
  const currentMetricValue = Number(ledger.totalFinalTickets || 0)
  return {
    milestones: milestones.map((milestone) => ({
      ...milestone,
      status: currentMetricValue >= milestone.threshold ? 'unlocked' : 'locked',
      metricType: 'tickets_issued',
    })),
    currentMetricValue,
    metricType: 'tickets_issued',
    sourceLabel: 'server-ledger',
    sourceStatus: 'live',
    generatedAt: ledger.generatedAt || null,
  }
}

function createJsonVoteStore() {
  return {
    mode: 'json',
    statePath: voteStatePath,
    eventsPath: voteEventsPath,
    previewPath: votePreviewPath,
    readState() {
      return readVoteState(voteStatePath)
    },
    readPreview({ walletAddress = '', matchResults = null } = {}) {
      return readVotePreview({
        statePath: voteStatePath,
        walletAddress,
        matchResults,
      })
    },
    submitVote({ ledger, input, matchResults = null }) {
      return submitVote({
        statePath: voteStatePath,
        eventsPath: voteEventsPath,
        previewPath: votePreviewPath,
        ledger,
        matchResults,
        input,
      })
    },
    health() {
      const state = this.readState()
      return {
        mode: 'json',
        statePath: voteStatePath,
        eventsPath: voteEventsPath,
        previewPath: votePreviewPath,
        stateExists: existsSync(voteStatePath),
        allocationCount: Array.isArray(state.allocations) ? state.allocations.length : 0,
        eventCount: state.eventCount || 0,
        generatedAt: state.generatedAt || null,
        updatedAt: state.updatedAt || null,
      }
    },
    close() {},
  }
}

function createConfiguredVoteStore() {
  if (voteStoreMode === 'sqlite') {
    return createSqliteVoteStore({
      dbPath: voteDbPath,
      statePath: voteStatePath,
      previewPath: votePreviewPath,
    })
  }
  return createJsonVoteStore()
}

function snapshotLedger() {
  if (!existsSync(ledgerPath)) return null
  try {
    mkdirSync(snapshotDir, { recursive: true })
    const id = new Date().toISOString().replace(/[:.]/g, '-')
    const snapshotPath = join(snapshotDir, `lucky-draw-ledger-${id}.json`)
    copyFileSync(ledgerPath, snapshotPath)
    pruneLedgerSnapshots()
    return snapshotPath
  } catch (error) {
    console.error('[ledger-refresh] snapshot failed', error)
    return null
  }
}

function listLedgerSnapshots() {
  if (!existsSync(snapshotDir)) return []

  return readdirSync(snapshotDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^lucky-draw-ledger-.+\.json$/.test(entry.name))
    .flatMap((entry) => {
      const path = join(snapshotDir, entry.name)
      try {
        const stats = statSync(path)
        return [{ name: entry.name, path, mtimeMs: stats.mtimeMs }]
      } catch (error) {
        console.warn(`[ledger-refresh] could not stat snapshot ${path}`, error)
        return []
      }
    })
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) return right.mtimeMs - left.mtimeMs
      return right.name.localeCompare(left.name)
    })
}

function pruneLedgerSnapshots() {
  const snapshots = listLedgerSnapshots()
  if (snapshots.length <= snapshotKeep) return

  const staleSnapshots = snapshots.slice(snapshotKeep)
  let deleted = 0
  for (const snapshot of staleSnapshots) {
    try {
      rmSync(snapshot.path, { force: true })
      deleted += 1
    } catch (error) {
      console.warn(`[ledger-refresh] could not prune snapshot ${snapshot.path}`, error)
    }
  }
  if (deleted > 0) console.log(`[ledger-refresh] pruned ${deleted} stale snapshot(s), kept latest ${snapshotKeep}`)
}

function runDataBackup(trigger) {
  if (!backupEnabled || backupRunning) return
  backupRunning = true
  lastBackup = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationSeconds: null,
    exitCode: null,
    error: null,
    trigger,
  }

  const args = [
    fileURLToPath(new URL('./backup-soccer-data.mjs', import.meta.url)),
    '--data-dir',
    dataDir,
  ]

  console.log(`[data-backup] start trigger=${trigger} data=${dataDir}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    backupRunning = false
    const finishedAt = new Date().toISOString()
    lastBackup = {
      ...lastBackup,
      ok: code === 0,
      finishedAt,
      durationSeconds: durationSeconds(lastBackup.startedAt, finishedAt),
      exitCode: code,
      error: code === 0 ? null : `data backup exited with code ${code}`,
    }
    rememberBackup(lastBackup)
    console.log(`[data-backup] finish trigger=${trigger} code=${code} duration=${lastBackup.durationSeconds ?? 'n/a'}s`)
  })
  child.on('error', (error) => {
    backupRunning = false
    const finishedAt = new Date().toISOString()
    lastBackup = {
      ...lastBackup,
      ok: false,
      finishedAt,
      durationSeconds: durationSeconds(lastBackup.startedAt, finishedAt),
      exitCode: null,
      error: error.message,
    }
    rememberBackup(lastBackup)
    console.error('[data-backup] failed', error)
  })
}

function runDataRestore(trigger, onDone = () => {}) {
  if (!restoreEnabled || restoreRunning) {
    onDone()
    return
  }

  restoreRunning = true
  lastRestore = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationSeconds: null,
    exitCode: null,
    error: null,
    trigger,
  }

  const args = [
    fileURLToPath(new URL('./restore-soccer-data.mjs', import.meta.url)),
    '--data-dir',
    dataDir,
  ]

  console.log(`[data-restore] start trigger=${trigger} data=${dataDir}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    restoreRunning = false
    const finishedAt = new Date().toISOString()
    lastRestore = {
      ...lastRestore,
      ok: code === 0,
      finishedAt,
      durationSeconds: durationSeconds(lastRestore.startedAt, finishedAt),
      exitCode: code,
      error: code === 0 ? null : `data restore exited with code ${code}`,
    }
    rememberRestore(lastRestore)
    console.log(`[data-restore] finish trigger=${trigger} code=${code} duration=${lastRestore.durationSeconds ?? 'n/a'}s`)
    onDone()
  })
  child.on('error', (error) => {
    restoreRunning = false
    const finishedAt = new Date().toISOString()
    lastRestore = {
      ...lastRestore,
      ok: false,
      finishedAt,
      durationSeconds: durationSeconds(lastRestore.startedAt, finishedAt),
      exitCode: null,
      error: error.message,
    }
    rememberRestore(lastRestore)
    console.error('[data-restore] failed', error)
    onDone()
  })
}

function runLedgerRefresh(trigger) {
  if (!refreshEnabled || refreshRunning) return
  if (!process.env.BSCSCAN_API_KEY) {
    lastRefresh = {
      ok: false,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      durationSeconds: null,
      exitCode: null,
      error: 'BSCSCAN_API_KEY is not configured.',
      trigger,
      skipped: true,
      reason: 'missing-bscscan-api-key',
    }
    rememberRefresh(lastRefresh)
    console.warn('[ledger-refresh] skipped: BSCSCAN_API_KEY is not configured')
    return
  }

  refreshRunning = true
  lastRefresh = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationSeconds: null,
    exitCode: null,
    error: null,
    trigger,
  }
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  const args = [
    fileURLToPath(new URL('./fetch-lucky-draw-ledger.mjs', import.meta.url)),
    '--cache-dir',
    cacheDir,
    '--out',
    ledgerPath,
    '--block-chunk',
    blockChunk,
    '--resolve-concurrency',
    resolveConcurrency,
    '--delay-ms',
    delayMs,
    '--retries',
    retries,
    '--backoff-ms',
    backoffMs,
  ]

  console.log(`[ledger-refresh] start trigger=${trigger} data=${dataDir} cache=${cacheDir}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    refreshRunning = false
    let snapshotPath = null
    if (code === 0) snapshotPath = snapshotLedger()
    const finishedAt = new Date().toISOString()
    lastRefresh = {
      ...lastRefresh,
      ok: code === 0,
      finishedAt,
      durationSeconds: durationSeconds(lastRefresh.startedAt, finishedAt),
      exitCode: code,
      error: code === 0 ? null : `ledger refresh exited with code ${code}`,
      snapshotPath,
    }
    rememberRefresh(lastRefresh)
    if (snapshotPath) console.log(`[ledger-refresh] snapshot ${snapshotPath}`)
    console.log(`[ledger-refresh] finish trigger=${trigger} code=${code} duration=${lastRefresh.durationSeconds ?? 'n/a'}s`)
    if (code === 0) runDataBackup('ledger-refresh')
  })
  child.on('error', (error) => {
    refreshRunning = false
    const finishedAt = new Date().toISOString()
    lastRefresh = {
      ...lastRefresh,
      ok: false,
      finishedAt,
      durationSeconds: durationSeconds(lastRefresh.startedAt, finishedAt),
      exitCode: null,
      error: error.message,
    }
    rememberRefresh(lastRefresh)
    console.error('[ledger-refresh] failed', error)
  })
}

function runFifaResultSync(trigger) {
  if (!fifaResultSyncEnabled || fifaResultSyncRunning) return
  if (!existsSync(fifaSourceMapPath)) {
    lastFifaResultSync = {
      ok: false,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      durationSeconds: null,
      exitCode: null,
      error: `FIFA source map is not configured: ${fifaSourceMapPath}`,
      trigger,
      skipped: true,
      reason: 'missing-fifa-source-map',
    }
    rememberFifaResultSync(lastFifaResultSync)
    console.warn(`[fifa-result-sync] skipped: source map missing ${fifaSourceMapPath}`)
    return
  }

  fifaResultSyncRunning = true
  lastFifaResultSync = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationSeconds: null,
    exitCode: null,
    error: null,
    trigger,
  }
  mkdirSync(dataDir, { recursive: true })

  const args = [
    fileURLToPath(new URL('./sync-fifa-results.mjs', import.meta.url)),
    '--source-map',
    fifaSourceMapPath,
    '--out',
    matchResultsPath,
  ]

  if (process.env.FIFA_RESULTS_FROM) args.push('--from', process.env.FIFA_RESULTS_FROM)
  if (process.env.FIFA_RESULTS_TO) args.push('--to', process.env.FIFA_RESULTS_TO)
  if (process.env.FIFA_API_BASE_URL) args.push('--base-url', process.env.FIFA_API_BASE_URL)
  if (process.env.FIFA_RESULTS_REQUEST_TIMEOUT_MS) {
    args.push('--timeout-ms', process.env.FIFA_RESULTS_REQUEST_TIMEOUT_MS)
  }

  console.log(`[fifa-result-sync] start trigger=${trigger} sourceMap=${fifaSourceMapPath}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    fifaResultSyncRunning = false
    const finishedAt = new Date().toISOString()
    lastFifaResultSync = {
      ...lastFifaResultSync,
      ok: code === 0,
      finishedAt,
      durationSeconds: durationSeconds(lastFifaResultSync.startedAt, finishedAt),
      exitCode: code,
      error: code === 0 ? null : `FIFA result sync exited with code ${code}`,
    }
    rememberFifaResultSync(lastFifaResultSync)
    console.log(
      `[fifa-result-sync] finish trigger=${trigger} code=${code} duration=${lastFifaResultSync.durationSeconds ?? 'n/a'}s`,
    )
    if (code === 0) runDataBackup('fifa-result-sync')
  })
  child.on('error', (error) => {
    fifaResultSyncRunning = false
    const finishedAt = new Date().toISOString()
    lastFifaResultSync = {
      ...lastFifaResultSync,
      ok: false,
      finishedAt,
      durationSeconds: durationSeconds(lastFifaResultSync.startedAt, finishedAt),
      exitCode: null,
      error: error.message,
    }
    rememberFifaResultSync(lastFifaResultSync)
    console.error('[fifa-result-sync] failed', error)
  })
}

async function readJsonBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > requestBodyLimitBytes) {
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 })
    }
  }
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON body: ${error.message}`), { statusCode: 400 })
  }
}

function sendOptions(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  })
  response.end()
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'OPTIONS') {
    sendOptions(response)
    return
  }

  if (url.pathname === '/health') {
    sendJson(
      request,
      response,
      200,
      {
        ok: true,
        runtimeTarget,
        dataDir,
        cacheDir,
        ledgerPath,
        ledgerExists: existsSync(ledgerPath),
        ledger: readHealthLedgerSnapshot(),
        snapshotDir,
        snapshotKeep,
        votesDir,
        voteEventsPath,
        voteStatePath,
        votePreviewPath,
        voteStoreMode,
        voteDbPath: voteStoreMode === 'sqlite' ? voteDbPath : null,
        voteStateExists: existsSync(voteStatePath),
        voteStore: voteStore.health(),
        votes: summarizeVoteState(voteStore.readState()),
        profileDbPath,
        userProfiles: userProfileStore.health(),
        matchResultsPath,
        matchResults: readHealthMatchResultsSnapshot(),
        matchDrawLedgerPath,
        matchDrawLedgerExists: existsSync(matchDrawLedgerPath),
        drawWinnersPath,
        drawWinnersExists: existsSync(drawWinnersPath),
        winnerRevealVideoUrlConfigured: Boolean(winnerRevealVideoUrl),
        authDir: auth.authDir,
        auth: {
          ...getAuthPublicStatus(auth),
          requiredForVotes: authRequiredForVotes,
        },
        refreshEnabled,
        refreshOnStartup,
        refreshMinutes,
        refreshRunning,
        bscscanApiKeyConfigured: Boolean(process.env.BSCSCAN_API_KEY),
        lastRefresh,
        refreshHistory,
        fifaResultSyncEnabled,
        fifaResultSyncOnStartup,
        fifaResultSyncMinutes,
        fifaResultSyncRunning,
        fifaSourceMapPath,
        fifaSourceMapExists: existsSync(fifaSourceMapPath),
        lastFifaResultSync,
        fifaResultSyncHistory,
        backupEnabled,
        backupRepoUrlConfigured: Boolean(backupRepoUrl),
        backupTokenConfigured: Boolean(process.env.DATA_BACKUP_GITHUB_TOKEN),
        backupIntervalMinutes,
        backupRunning,
        lastBackup,
        backupHistory,
        restoreEnabled,
        restoreOnStartup,
        restoreRunning,
        lastRestore,
        restoreHistory,
      },
      {
        'cache-control': 'no-store',
      },
    )
    return
  }

  if (await handleAuthRoute({ auth, request, response, url, readJsonBody, sendJson })) {
    return
  }

  if (url.pathname === '/api/raffle-summary') {
    try {
      sendJson(request, response, 200, buildLedgerSummary(readLedgerPayload(ledgerPath)), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendLedgerApiError(request, response, error)
    }
    return
  }

  if (url.pathname === '/api/milestones') {
    try {
      sendJson(request, response, 200, buildMilestoneSummary(readLedgerPayload(ledgerPath)), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendLedgerApiError(request, response, error)
    }
    return
  }

  if (url.pathname === '/api/raffle-entry') {
    const session = readAuthSession(auth, request)
    const walletQuery = url.searchParams.get('wallet') || session?.walletAddress || ''
    if (!walletQuery.trim()) {
      sendJson(
        request,
        response,
        400,
        { entry: null, error: 'wallet query is required' },
        { 'cache-control': 'no-store' },
      )
      return
    }

    try {
      const ledger = readLedgerPayload(ledgerPath)
      const entry = findLedgerEntry(ledger, walletQuery)
      sendJson(
        request,
        response,
        200,
        {
          entry: buildLedgerEntryResponse(entry, parseEntryIntervalQuery(url.searchParams)),
        },
        {
          'cache-control': 'no-store',
        },
      )
    } catch (error) {
      sendLedgerApiError(request, response, error)
    }
    return
  }

  if (url.pathname === '/api/raffle-ticket-lookup') {
    try {
      const ledger = readLedgerPayload(ledgerPath)
      sendJson(
        request,
        response,
        200,
        buildTicketLookupResponse(ledger, parseTicketLookupQuery(url.searchParams)),
        {
          'cache-control': 'no-store',
        },
      )
    } catch (error) {
      sendLedgerApiError(request, response, error)
    }
    return
  }

  if (url.pathname === '/api/match-results') {
    try {
      const snapshot = readMatchResultsSnapshot(matchResultsPath)
      sendJson(request, response, 200, snapshot, {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendJson(
        request,
        response,
        503,
        { error: error instanceof Error ? error.message : 'Could not read match results.' },
        { 'cache-control': 'no-store' },
      )
    }
    return
  }

  if (url.pathname === '/api/draw-winners') {
    try {
      sendJson(request, response, 200, readDrawWinnersSnapshot(), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendJson(
        request,
        response,
        503,
        { error: error instanceof Error ? error.message : 'Could not read draw winners.' },
        { 'cache-control': 'no-store' },
      )
    }
    return
  }

  if (url.pathname === '/api/vote-preview') {
    try {
      const session = readAuthSession(auth, request)
      const matchResults = readMatchResultsSnapshot(matchResultsPath)
      const scope = String(url.searchParams.get('scope') || '').trim().toLowerCase()
      const includeAllWallets = ['all', 'global', 'pool'].includes(scope)
      sendJson(
        request,
        response,
        200,
        voteStore.readPreview({
          walletAddress: includeAllWallets ? '' : url.searchParams.get('wallet') || session?.walletAddress || '',
          matchResults,
        }),
        { 'cache-control': 'no-store' },
      )
    } catch (error) {
      sendJson(
        request,
        response,
        500,
        { error: error instanceof Error ? error.message : 'Could not read vote preview.' },
        { 'cache-control': 'no-store' },
      )
    }
    return
  }

  if (url.pathname === '/api/votes') {
    if (request.method !== 'POST') {
      sendJson(request, response, 405, { error: 'POST required.' }, { 'cache-control': 'no-store' })
      return
    }

    try {
      const body = await readJsonBody(request)
      const session = readAuthSession(auth, request)
      if (authRequiredForVotes && !session) {
        sendJson(request, response, 401, { ok: false, error: 'Login is required before submitting votes.' }, { 'cache-control': 'no-store' })
        return
      }
      if (authRequiredForVotes && !session?.walletAddress) {
        sendJson(request, response, 403, { ok: false, error: 'This login is not linked to a voting wallet yet.' }, { 'cache-control': 'no-store' })
        return
      }
      if (authRequiredForVotes && auth.xFollowGateConfig.required && !getXFollowStatus(auth, session, request).gatePassed) {
        sendJson(request, response, 403, { ok: false, error: 'Follow verification is required before submitting votes.' }, { 'cache-control': 'no-store' })
        return
      }
      const ledger = readLedgerPayload(ledgerPath)
      const matchResults = readMatchResultsSnapshot(matchResultsPath)
      const result = voteStore.submitVote({
        ledger,
        matchResults,
        input: {
          ...body,
          ...(session?.walletAddress ? { walletAddress: session.walletAddress } : {}),
        },
      })
      sendJson(
        request,
        response,
        201,
        {
          ok: true,
          event: result.event,
          allocation: result.allocation,
          preview: result.preview,
        },
        { 'cache-control': 'no-store' },
      )
    } catch (error) {
      const status = Number(error?.statusCode || 500)
      sendJson(
        request,
        response,
        status,
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Vote submission failed.',
          availableTickets: error?.availableTickets,
        },
        { 'cache-control': 'no-store' },
      )
    }
    return
  }

  if (url.pathname === '/lucky-draw-ledger.json') {
    sendFile(request, response, ledgerPath, {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    return
  }

  if (url.pathname === '/match-draw-ledger.json') {
    sendFile(request, response, matchDrawLedgerPath, {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    return
  }

  if (url.pathname === '/draw-winners.json') {
    sendJson(request, response, 200, readDrawWinnersSnapshot(), {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    return
  }

  if (url.pathname === '/vote-preview.json') {
    if (existsSync(votePreviewPath)) {
      sendFile(request, response, votePreviewPath, {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      })
      return
    }
    sendJson(request, response, 200, voteStore.readPreview({
      matchResults: readMatchResultsSnapshot(matchResultsPath),
    }), {
      'cache-control': 'no-store',
    })
    return
  }

  const candidate = distPathForUrl(request.url || '/')
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(request, response, candidate, {
      'cache-control': candidate.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    return
  }

  const indexPath = join(distDir, 'index.html')
  if (existsSync(indexPath)) {
    sendFile(request, response, indexPath, { 'cache-control': 'no-cache' })
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Build output not found. Run npm run build before starting the production server.')
})

mkdirSync(dataDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })
mkdirSync(votesDir, { recursive: true })
mkdirSync(auth.authDir, { recursive: true })
mkdirSync(dirname(profileDbPath), { recursive: true })

const voteStore = createConfiguredVoteStore()

function startBackgroundJobs() {
  if (refreshEnabled && refreshOnStartup) runLedgerRefresh('startup')
  if (refreshEnabled) refreshTimer = setInterval(() => runLedgerRefresh('interval'), refreshIntervalMs)
  if (fifaResultSyncEnabled && fifaResultSyncOnStartup) runFifaResultSync('startup')
  if (fifaResultSyncEnabled) {
    fifaResultSyncTimer = setInterval(() => runFifaResultSync('interval'), fifaResultSyncIntervalMs)
  }
  if (backupEnabled) {
    backupTimer = setInterval(() => runDataBackup('interval'), backupIntervalMs)
  } else {
    console.log('[data-backup] disabled: DATA_BACKUP_REPO_URL or DATA_BACKUP_GITHUB_TOKEN is not configured')
  }
}

server.listen(port, () => {
  console.log(`[server] listening on ${port}`)
  console.log(`[server] dataDir=${dataDir}`)
  console.log(`[server] ledgerPath=${ledgerPath}`)
  console.log(`[server] voteStore=${voteStore.mode}`)
  console.log(`[server] voteStatePath=${voteStatePath}`)
  if (voteStore.mode === 'sqlite') console.log(`[server] voteDbPath=${voteDbPath}`)
  console.log(`[server] profileDbPath=${profileDbPath}`)
  console.log(`[server] matchResultsPath=${matchResultsPath}`)
  console.log(`[server] matchDrawLedgerPath=${matchDrawLedgerPath}`)
  if (restoreEnabled) {
    runDataRestore('startup', startBackgroundJobs)
  } else {
    if (!restoreOnStartup) console.log('[data-restore] disabled: DATA_BACKUP_RESTORE_ON_STARTUP=0')
    else console.log('[data-restore] disabled: DATA_BACKUP_REPO_URL or DATA_BACKUP_GITHUB_TOKEN is not configured')
    startBackgroundJobs()
  }
})

function shutdown(signal) {
  console.log(`[server] shutdown signal=${signal}`)
  if (refreshTimer) clearInterval(refreshTimer)
  if (fifaResultSyncTimer) clearInterval(fifaResultSyncTimer)
  if (backupTimer) clearInterval(backupTimer)
  voteStore.close?.()
  userProfileStore.close?.()
  server.close(() => process.exit(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
