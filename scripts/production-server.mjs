#!/usr/bin/env node
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

import { milestones } from '../src/app/data/worldCupCampaign.js'
import {
  buildLedgerEntryResponse,
  buildLedgerSummary,
  findLedgerEntry,
  parseEntryIntervalQuery,
  readLedgerPayload,
} from './soccer-ledger-api.mjs'
import { readVotePreview, submitVote } from './soccer-vote-store.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = resolve(repoRoot, 'dist')
const dataDir = process.env.SOCCER_DATA_DIR || process.env.LUCKY_DRAW_DATA_DIR || '/data/soccer'
const cacheDir = process.env.LUCKY_DRAW_CACHE_DIR || join(dataDir, 'cache')
const ledgerPath = process.env.LUCKY_DRAW_LEDGER_PATH || join(dataDir, 'lucky-draw-ledger.json')
const snapshotDir = process.env.LUCKY_DRAW_SNAPSHOT_DIR || join(dataDir, 'snapshots')
const votesDir = process.env.SOCCER_VOTES_DIR || join(dataDir, 'votes')
const voteEventsPath = process.env.SOCCER_VOTE_EVENTS_PATH || join(votesDir, 'vote-events.jsonl')
const voteStatePath = process.env.SOCCER_VOTE_STATE_PATH || join(votesDir, 'vote-state.json')
const votePreviewPath = process.env.SOCCER_VOTE_PREVIEW_PATH || join(votesDir, 'vote-preview.json')
const snapshotKeep = readIntegerEnv('LUCKY_DRAW_SNAPSHOT_KEEP', 72, 1)
const port = Number(process.env.PORT || 3000)
const refreshMinutes = readIntegerEnv('LUCKY_DRAW_REFRESH_MINUTES', 60, 1)
const refreshIntervalMs = refreshMinutes * 60 * 1000
const refreshEnabled = process.env.LUCKY_DRAW_REFRESH_ENABLED !== '0'
const refreshOnStartup = process.env.LUCKY_DRAW_REFRESH_ON_STARTUP !== '0'
const backupIntervalMinutes = readIntegerEnv('DATA_BACKUP_INTERVAL_MINUTES', 60, 1)
const backupIntervalMs = backupIntervalMinutes * 60 * 1000
const backupRepoUrl = process.env.DATA_BACKUP_REPO_URL || ''
const backupEnabled = Boolean(backupRepoUrl && process.env.DATA_BACKUP_GITHUB_TOKEN) && process.env.DATA_BACKUP_ENABLED !== '0'
const blockChunk = process.env.LUCKY_DRAW_BLOCK_CHUNK || '20000'
const resolveConcurrency = process.env.LUCKY_DRAW_RESOLVE_CONCURRENCY || '3'
const delayMs = process.env.LUCKY_DRAW_DELAY_MS || '30'
const retries = process.env.LUCKY_DRAW_RETRIES || '8'
const backoffMs = process.env.LUCKY_DRAW_BACKOFF_MS || '1000'
const requestBodyLimitBytes = readIntegerEnv('HTTP_JSON_BODY_LIMIT_BYTES', 64 * 1024, 1024)

let refreshRunning = false
let refreshTimer = null
let backupRunning = false
let backupTimer = null
let lastRefresh = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  trigger: null,
}
let lastBackup = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  trigger: null,
}

function readIntegerEnv(name, fallback, min = 0) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
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
    lastBackup = {
      ...lastBackup,
      ok: code === 0,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? null : `data backup exited with code ${code}`,
    }
    console.log(`[data-backup] finish trigger=${trigger} code=${code}`)
  })
  child.on('error', (error) => {
    backupRunning = false
    lastBackup = {
      ...lastBackup,
      ok: false,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      error: error.message,
    }
    console.error('[data-backup] failed', error)
  })
}

function runLedgerRefresh(trigger) {
  if (!refreshEnabled || refreshRunning) return
  if (!process.env.BSCSCAN_API_KEY) {
    lastRefresh = {
      ok: false,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      error: 'BSCSCAN_API_KEY is not configured.',
      trigger,
      skipped: true,
      reason: 'missing-bscscan-api-key',
    }
    console.warn('[ledger-refresh] skipped: BSCSCAN_API_KEY is not configured')
    return
  }

  refreshRunning = true
  lastRefresh = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
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
    lastRefresh = {
      ...lastRefresh,
      ok: code === 0,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? null : `ledger refresh exited with code ${code}`,
      snapshotPath,
    }
    if (snapshotPath) console.log(`[ledger-refresh] snapshot ${snapshotPath}`)
    console.log(`[ledger-refresh] finish trigger=${trigger} code=${code}`)
    if (code === 0) runDataBackup('ledger-refresh')
  })
  child.on('error', (error) => {
    refreshRunning = false
    lastRefresh = {
      ...lastRefresh,
      ok: false,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      error: error.message,
    }
    console.error('[ledger-refresh] failed', error)
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
        dataDir,
        cacheDir,
        ledgerPath,
        ledgerExists: existsSync(ledgerPath),
        snapshotDir,
        snapshotKeep,
        votesDir,
        voteEventsPath,
        voteStatePath,
        votePreviewPath,
        voteStateExists: existsSync(voteStatePath),
        refreshEnabled,
        refreshOnStartup,
        refreshMinutes,
        refreshRunning,
        bscscanApiKeyConfigured: Boolean(process.env.BSCSCAN_API_KEY),
        lastRefresh,
        backupEnabled,
        backupRepoUrlConfigured: Boolean(backupRepoUrl),
        backupTokenConfigured: Boolean(process.env.DATA_BACKUP_GITHUB_TOKEN),
        backupIntervalMinutes,
        backupRunning,
        lastBackup,
      },
      {
        'cache-control': 'no-store',
      },
    )
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
    const walletQuery = url.searchParams.get('wallet') || ''
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

  if (url.pathname === '/api/vote-preview') {
    try {
      sendJson(
        request,
        response,
        200,
        readVotePreview({
          statePath: voteStatePath,
          walletAddress: url.searchParams.get('wallet') || '',
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
      const ledger = readLedgerPayload(ledgerPath)
      const result = submitVote({
        statePath: voteStatePath,
        eventsPath: voteEventsPath,
        previewPath: votePreviewPath,
        ledger,
        input: body,
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

  if (url.pathname === '/vote-preview.json') {
    if (existsSync(votePreviewPath)) {
      sendFile(request, response, votePreviewPath, {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      })
      return
    }
    sendJson(request, response, 200, readVotePreview({ statePath: voteStatePath }), {
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

server.listen(port, () => {
  console.log(`[server] listening on ${port}`)
  console.log(`[server] dataDir=${dataDir}`)
  console.log(`[server] ledgerPath=${ledgerPath}`)
  console.log(`[server] voteStatePath=${voteStatePath}`)
  if (refreshEnabled && refreshOnStartup) runLedgerRefresh('startup')
  if (refreshEnabled) refreshTimer = setInterval(() => runLedgerRefresh('interval'), refreshIntervalMs)
  if (backupEnabled) {
    backupTimer = setInterval(() => runDataBackup('interval'), backupIntervalMs)
  } else {
    console.log('[data-backup] disabled: DATA_BACKUP_REPO_URL or DATA_BACKUP_GITHUB_TOKEN is not configured')
  }
})

function shutdown(signal) {
  console.log(`[server] shutdown signal=${signal}`)
  if (refreshTimer) clearInterval(refreshTimer)
  if (backupTimer) clearInterval(backupTimer)
  server.close(() => process.exit(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
