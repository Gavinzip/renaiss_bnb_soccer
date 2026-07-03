#!/usr/bin/env node
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { verifyMessage } from 'ethers'

import { milestones, roundDefinitions } from '../src/app/data/worldCupCampaign.js'
import {
  fetchFifaQualificationSnapshot,
  fetchFifaRound16MatchesSnapshot,
  fetchFifaRound32MatchesSnapshot,
} from '../src/app/data/fifaRealtime.js'
import {
  createAuthContext,
  getAuthPublicStatus,
  handleAuthRoute,
  readAuthSession,
} from './auth/routes.mjs'
import { createUserProfileStore } from './auth/user-profile-store.mjs'
import { getXFollowStatus } from './auth/x-follow-gate.mjs'
import { assertXAccountEligibilityForVote, getXAccountEligibilityStatus } from './auth/x-account-eligibility.mjs'
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
import {
  appendVary,
  corsHeadersForRequest,
  isAllowedRequestOrigin,
  requestHasBearerToken,
} from './http-security.mjs'
import { verifyCsrfRequest } from './auth/csrf.mjs'
import { createMemoryRateLimiter } from './rate-limit.mjs'

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
const bundledFifaSourceMapPath = join(repoRoot, 'config/fifa-match-map.production.json')
const fifaSourceMapPath = process.env.FIFA_RESULTS_SOURCE_MAP_PATH
  || (existsSync(bundledFifaSourceMapPath) ? bundledFifaSourceMapPath : join(dataDir, 'fifa-match-map.json'))
const userProfileStore = createUserProfileStore({ dbPath: profileDbPath })
const auth = createAuthContext({ dataDir, userProfileStore })
const snapshotKeep = readIntegerEnv('LUCKY_DRAW_SNAPSHOT_KEEP', 72, 1)
const refreshMinutes = readIntegerEnv('LUCKY_DRAW_REFRESH_MINUTES', 5, 1)
const refreshIntervalMs = refreshMinutes * 60 * 1000
const refreshHistoryLimit = readIntegerEnv('LUCKY_DRAW_REFRESH_HISTORY_LIMIT', 24, 1)
const refreshEnabled = process.env.LUCKY_DRAW_REFRESH_ENABLED !== '0'
const refreshOnStartup = process.env.LUCKY_DRAW_REFRESH_ON_STARTUP !== '0'
const eventCacheLookbackRounds = readIntegerEnv('LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS', 12, 0)
const eventCacheLookbackMinutesOverride = readIntegerEnv('LUCKY_DRAW_EVENT_CACHE_LOOKBACK_MINUTES', 0, 0)
const eventCacheLookbackMinutes = eventCacheLookbackMinutesOverride > 0
  ? eventCacheLookbackMinutesOverride
  : refreshMinutes * eventCacheLookbackRounds
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
const healthAdminToken = String(process.env.HEALTH_ADMIN_TOKEN || process.env.ADMIN_HEALTH_TOKEN || '').trim()
const drawAdminApiEnabled = process.env.DRAW_ADMIN_API_ENABLED === '1'
  || (runtimeTarget === 'local' && process.env.DRAW_ADMIN_API_ENABLED !== '0')
const drawAdminChallengeTtlSeconds = readIntegerEnv('DRAW_ADMIN_CHALLENGE_TTL_SECONDS', 300, 30)
const drawAdminChallengeTtlMs = drawAdminChallengeTtlSeconds * 1000
const drawAdminScriptTimeoutSeconds = readIntegerEnv('DRAW_ADMIN_SCRIPT_TIMEOUT_SECONDS', 14 * 60, 60)
const drawAdminScriptTimeoutMs = drawAdminScriptTimeoutSeconds * 1000
const drawAdminOutputLimitBytes = readIntegerEnv('DRAW_ADMIN_OUTPUT_LIMIT_BYTES', 512 * 1024, 16 * 1024)
const drawAdminRoundIds = new Set(roundDefinitions.map((round) => String(round.id || '').trim()).filter(Boolean))
const drawAdminChallenges = new Map()
let drawAdminRunRunning = false
let lastDrawAdminRun = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  exitCode: null,
  error: null,
  trigger: null,
}
const rateLimitEnabled = process.env.HTTP_RATE_LIMIT_ENABLED !== '0'
const rateLimiter = createMemoryRateLimiter({
  maxBuckets: readIntegerEnv('HTTP_RATE_LIMIT_MAX_BUCKETS', 20000, 1000),
})
const fifaStandingsCacheSeconds = readIntegerEnv('FIFA_STANDINGS_CACHE_SECONDS', 45, 0)
const fifaStandingsCacheMs = fifaStandingsCacheSeconds * 1000
let fifaStandingsCache = null
const fifaRound32MatchesCacheSeconds = readIntegerEnv('FIFA_ROUND32_MATCHES_CACHE_SECONDS', 45, 0)
const fifaRound32MatchesCacheMs = fifaRound32MatchesCacheSeconds * 1000
let fifaRound32MatchesCache = null
const fifaRound16MatchesCacheSeconds = readIntegerEnv('FIFA_ROUND16_MATCHES_CACHE_SECONDS', 45, 0)
const fifaRound16MatchesCacheMs = fifaRound16MatchesCacheSeconds * 1000
let fifaRound16MatchesCache = null

function cleanLogValue(value) {
  return String(value ?? 'none').replace(/\s+/g, ' ').slice(0, 160) || 'none'
}

function maskVoteWalletAddress(value) {
  const address = String(value || '').trim()
  if (!address) return 'none'
  if (address.length <= 12) return '[redacted]'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getVoteSubmitLogDetails(body, session) {
  return {
    requestId: cleanLogValue(body?.requestId),
    roundId: cleanLogValue(body?.roundId),
    matchId: cleanLogValue(body?.matchId),
    teamId: cleanLogValue(body?.teamId),
    tickets: cleanLogValue(body?.tickets),
    wallet: maskVoteWalletAddress(session?.walletAddress || body?.walletAddress),
  }
}

function writeVoteSubmitLog(level, stage, details = {}) {
  const payload = Object.entries(details)
    .map(([key, value]) => `${key}=${cleanLogValue(value)}`)
    .join(' ')
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  logger(`[vote-submit] ${stage}${payload ? ` ${payload}` : ''}`)
}

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
  const localOrigin = process.env.SOCCER_LOCAL_APP_ORIGIN || 'http://127.0.0.1:5173'
  const localOrigins = process.env.SOCCER_LOCAL_APP_ORIGINS
    || [localOrigin, 'http://127.0.0.1:5173', 'http://localhost:5173'].join(',')
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
  applyDefaultEnv('PUBLIC_APP_ORIGINS', localOrigins)
  applyDefaultEnv('AUTH_PUBLIC_ORIGINS', localOrigins)
  applyDefaultEnv('X_REDIRECT_URI', `${localOrigin}/api/auth/x/callback`, {
    replace: [`${serverOrigin}/api/auth/x/callback`],
  })
  applyDefaultEnv('AUTH_COOKIE_SECURE', '0', { replace: ['1'] })
  applyDefaultEnv('AUTH_REQUIRE_SESSION_FOR_VOTES', '0', { replace: ['1'] })
  applyDefaultEnv('X_FOLLOW_GATE_REQUIRED', '0', { replace: ['1'] })
  applyDefaultEnv('X_FOLLOW_SKIP_ENABLED', '1', { replace: ['0'] })
  applyDefaultEnv('FIREFLY_X_ACCOUNT_ELIGIBILITY_REQUIRED', '0', { replace: ['1'] })

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

function clientIp(request) {
  return String(
    request.headers['cf-connecting-ip']
      || request.headers['x-real-ip']
      || String(request.headers['x-forwarded-for'] || '').split(',')[0]
      || request.socket?.remoteAddress
      || 'unknown',
  ).trim() || 'unknown'
}

function minuteWindow(minutes = 1) {
  return Math.max(1, minutes) * 60 * 1000
}

function hourWindow(hours = 1) {
  return Math.max(1, hours) * 60 * 60 * 1000
}

function dayWindow(days = 1) {
  return Math.max(1, days) * 24 * 60 * 60 * 1000
}

function sendSecurityError(request, response, status, payload, headers = {}) {
  sendJson(
    request,
    response,
    status,
    {
      ok: false,
      ...payload,
    },
    {
      'cache-control': 'no-store',
      ...headers,
    },
  )
}

function enforceUnsafeRequestOrigin(request, response) {
  if (isAllowedRequestOrigin(request, process.env, { allowMissing: true })) return true
  sendSecurityError(request, response, 403, {
    code: 'invalid_origin',
    error: 'Request origin is not allowed.',
  })
  return false
}

function enforceSessionCsrf(request, response, session) {
  if (!session) return true
  if (verifyCsrfRequest(auth.sessionConfig, session, request)) return true
  sendSecurityError(request, response, 403, {
    code: 'csrf_required',
    error: 'A valid CSRF token is required for this action.',
  })
  return false
}

function enforceRateLimit(request, response, rules) {
  if (!rateLimitEnabled) return true
  const result = rateLimiter.check(rules)
  if (result.ok) return true

  sendSecurityError(
    request,
    response,
    429,
    {
      code: 'rate_limited',
      error: 'Too many requests. Try again later.',
      retryAfterSeconds: result.retryAfterSeconds,
      policy: result.policy,
    },
    {
      'retry-after': String(result.retryAfterSeconds),
    },
  )
  return false
}

function authStartRateLimitRules(request, provider) {
  const ip = clientIp(request)
  const providerKey = `${provider}:${ip}`
  return [
    {
      scope: 'auth_start_ip_minute',
      key: providerKey,
      limit: readIntegerEnv('AUTH_START_RATE_LIMIT_PER_MINUTE', 10, 1),
      windowMs: minuteWindow(1),
    },
    {
      scope: 'auth_start_ip_hour',
      key: providerKey,
      limit: readIntegerEnv('AUTH_START_RATE_LIMIT_PER_HOUR', 60, 1),
      windowMs: hourWindow(1),
    },
  ]
}

function voteRateLimitRules(request, session) {
  const wallet = session?.walletAddress || 'wallet-missing'
  return [
    {
      scope: 'vote_submit_wallet_minute',
      key: wallet,
      limit: readIntegerEnv('VOTE_RATE_LIMIT_PER_WALLET_PER_MINUTE', 20, 1),
      windowMs: minuteWindow(1),
    },
    {
      scope: 'vote_submit_wallet_hour',
      key: wallet,
      limit: readIntegerEnv('VOTE_RATE_LIMIT_PER_WALLET_PER_HOUR', 120, 1),
      windowMs: hourWindow(1),
    },
  ]
}

function xFollowVerifyRateLimitRules(request, session, status) {
  const ip = clientIp(request)
  const wallet = session?.walletAddress || status?.walletAddress || 'wallet-missing'
  const subject = `${wallet}:x:${status?.xUserId || 'x-missing'}`
  return [
    {
      scope: 'x_follow_verify_subject_10m',
      key: subject,
      limit: readIntegerEnv('X_FOLLOW_VERIFY_RATE_LIMIT_PER_SUBJECT_10M', 3, 1),
      windowMs: minuteWindow(10),
    },
    {
      scope: 'x_follow_verify_wallet_hour',
      key: wallet,
      limit: readIntegerEnv('X_FOLLOW_VERIFY_RATE_LIMIT_PER_WALLET_HOUR', 10, 1),
      windowMs: hourWindow(1),
    },
    {
      scope: 'x_follow_verify_ip_hour',
      key: ip,
      limit: readIntegerEnv('X_FOLLOW_VERIFY_RATE_LIMIT_PER_IP_HOUR', 30, 1),
      windowMs: hourWindow(1),
    },
  ]
}

function xEligibilityRateLimitRules(request, session, status) {
  const ip = clientIp(request)
  const wallet = session?.walletAddress || status?.walletAddress || 'wallet-missing'
  const subject = `${wallet}:x:${status?.xUserId || 'x-missing'}`
  return [
    {
      scope: 'x_eligibility_verify_subject_10m',
      key: subject,
      limit: readIntegerEnv('X_ELIGIBILITY_VERIFY_RATE_LIMIT_PER_SUBJECT_10M', 3, 1),
      windowMs: minuteWindow(10),
    },
    {
      scope: 'x_eligibility_verify_subject_day',
      key: subject,
      limit: readIntegerEnv('X_ELIGIBILITY_VERIFY_RATE_LIMIT_PER_SUBJECT_DAY', 10, 1),
      windowMs: dayWindow(1),
    },
    {
      scope: 'x_eligibility_verify_global_minute',
      key: 'global',
      limit: readIntegerEnv('X_ELIGIBILITY_VERIFY_RATE_LIMIT_GLOBAL_PER_MINUTE', 60, 1),
      windowMs: minuteWindow(1),
    },
    {
      scope: 'x_eligibility_verify_ip_hour',
      key: ip,
      limit: readIntegerEnv('X_ELIGIBILITY_VERIFY_RATE_LIMIT_PER_IP_HOUR', 30, 1),
      windowMs: hourWindow(1),
    },
  ]
}

function normalizeDrawAdminWalletAddress(value) {
  const address = String(value || '').trim()
  return /^0x[a-f0-9]{40}$/i.test(address) ? address.toLowerCase() : ''
}

function drawAdminAllowedAddresses() {
  return [
    process.env.DRAW_OWNER_ADDRESS,
    process.env.DRAW_OPERATOR_ADDRESS,
    process.env.DRAW_ADMIN_ADDRESSES,
  ]
    .flatMap((value) => String(value || '').split(/[,\s]+/))
    .map(normalizeDrawAdminWalletAddress)
    .filter(Boolean)
}

function drawContractAddress() {
  return normalizeDrawAdminWalletAddress(process.env.DRAW_CONTRACT_ADDRESS)
}

function drawExpectedChainId() {
  return String(process.env.BSC_CHAIN_ID || '56').trim() || '56'
}

function normalizeDrawAdminRoundId(value) {
  const roundId = String(value || '').trim()
  if (!drawAdminRoundIds.has(roundId)) {
    throw Object.assign(new Error('Unsupported draw round.'), {
      statusCode: 400,
      code: 'draw_round_invalid',
    })
  }
  return roundId
}

function normalizeDrawAdminAction(value, broadcast) {
  const action = String(value || (broadcast ? 'broadcast' : 'verify')).trim().toLowerCase()
  if (action === 'verify' || action === 'broadcast') return action
  throw Object.assign(new Error('Unsupported draw action.'), {
    statusCode: 400,
    code: 'draw_action_invalid',
  })
}

function drawAdminStatusPayload({ includeLastRun = false, includePrivate = false } = {}) {
  const allowedAddresses = drawAdminAllowedAddresses()
  const payload = {
    ok: true,
    enabled: drawAdminApiEnabled,
    chainId: drawExpectedChainId(),
    contractAddress: drawContractAddress() || null,
    contractConfigured: Boolean(drawContractAddress()),
    rpcConfigured: Boolean(process.env.BSC_RPC_URL),
    broadcasterConfigured: Boolean(process.env.BSC_DEPLOYER_PRIVATE_KEY),
    allowlistConfigured: allowedAddresses.length > 0,
    matchDrawLedgerExists: existsSync(matchDrawLedgerPath),
    drawWinnersExists: existsSync(drawWinnersPath),
    challengeTtlSeconds: drawAdminChallengeTtlSeconds,
    running: drawAdminRunRunning,
  }
  return {
    ...payload,
    ...(includePrivate ? { matchDrawLedgerPath, drawWinnersPath } : {}),
    ...(includeLastRun ? { lastRun: lastDrawAdminRun } : {}),
  }
}

function drawAdminDisabledError() {
  if (!drawAdminApiEnabled) {
    return Object.assign(new Error('Draw admin API is disabled.'), {
      statusCode: 404,
      code: 'draw_admin_disabled',
    })
  }
  return null
}

function assertDrawAdminReady({ requireBroadcast = false } = {}) {
  const disabled = drawAdminDisabledError()
  if (disabled) throw disabled
  if (!drawContractAddress()) {
    throw Object.assign(new Error('Draw contract address is not configured.'), {
      statusCode: 503,
      code: 'draw_contract_missing',
    })
  }
  if (!process.env.BSC_RPC_URL) {
    throw Object.assign(new Error('BSC RPC URL is not configured.'), {
      statusCode: 503,
      code: 'draw_rpc_missing',
    })
  }
  if (requireBroadcast && !process.env.BSC_DEPLOYER_PRIVATE_KEY) {
    throw Object.assign(new Error('Draw broadcaster private key is not configured.'), {
      statusCode: 503,
      code: 'draw_broadcaster_missing',
    })
  }
  if (drawAdminAllowedAddresses().length === 0) {
    throw Object.assign(new Error('Draw admin wallet allowlist is not configured.'), {
      statusCode: 503,
      code: 'draw_allowlist_missing',
    })
  }
  if (!existsSync(matchDrawLedgerPath)) {
    throw Object.assign(new Error('Match draw ledger is not ready.'), {
      statusCode: 503,
      code: 'draw_ledger_missing',
    })
  }
}

function drawAdminRateLimitRules(request, address, action) {
  const ip = clientIp(request)
  const subject = `${address || 'wallet-missing'}:${action || 'unknown'}`
  return [
    {
      scope: 'draw_admin_subject_10m',
      key: subject,
      limit: readIntegerEnv('DRAW_ADMIN_RATE_LIMIT_PER_WALLET_10M', 8, 1),
      windowMs: minuteWindow(10),
    },
    {
      scope: 'draw_admin_ip_10m',
      key: ip,
      limit: readIntegerEnv('DRAW_ADMIN_RATE_LIMIT_PER_IP_10M', 20, 1),
      windowMs: minuteWindow(10),
    },
  ]
}

function assertDrawAdminWalletAllowed(address) {
  const normalized = normalizeDrawAdminWalletAddress(address)
  if (!normalized) {
    throw Object.assign(new Error('Valid operator wallet address is required.'), {
      statusCode: 400,
      code: 'draw_wallet_invalid',
    })
  }
  if (!drawAdminAllowedAddresses().includes(normalized)) {
    throw Object.assign(new Error('This wallet is not allowed to run the draw.'), {
      statusCode: 403,
      code: 'draw_wallet_not_allowed',
    })
  }
  return normalized
}

function createDrawAdminMessage({ address, action, roundId, nonce, issuedAt }) {
  return [
    'Renaiss World Cup draw authorization',
    `Address: ${address}`,
    `Action: ${action}`,
    `Round: ${roundId}`,
    `Chain ID: ${drawExpectedChainId()}`,
    `Contract: ${drawContractAddress()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    'Only sign this from the official Renaiss draw room.',
  ].join('\n')
}

function createDrawAdminChallenge({ address, action, roundId }) {
  const nonce = randomUUID()
  const issuedAt = new Date().toISOString()
  const expiresAtMs = Date.now() + drawAdminChallengeTtlMs
  const message = createDrawAdminMessage({ address, action, roundId, nonce, issuedAt })
  drawAdminChallenges.set(nonce, {
    address,
    action,
    roundId,
    nonce,
    issuedAt,
    expiresAtMs,
    message,
  })
  return {
    address,
    action,
    roundId,
    nonce,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    message,
  }
}

function verifyDrawAdminChallenge({ address, action, roundId, nonce, signature }) {
  const normalizedAddress = assertDrawAdminWalletAllowed(address)
  const challenge = drawAdminChallenges.get(String(nonce || ''))
  drawAdminChallenges.delete(String(nonce || ''))

  if (!challenge) {
    throw Object.assign(new Error('Draw authorization challenge is missing or already used.'), {
      statusCode: 401,
      code: 'draw_challenge_missing',
    })
  }
  if (Date.now() > challenge.expiresAtMs) {
    throw Object.assign(new Error('Draw authorization challenge expired.'), {
      statusCode: 401,
      code: 'draw_challenge_expired',
    })
  }
  if (challenge.address !== normalizedAddress || challenge.action !== action || challenge.roundId !== roundId) {
    throw Object.assign(new Error('Draw authorization challenge does not match this request.'), {
      statusCode: 401,
      code: 'draw_challenge_mismatch',
    })
  }

  let recovered = ''
  try {
    recovered = normalizeDrawAdminWalletAddress(verifyMessage(challenge.message, String(signature || '')))
  } catch {
    recovered = ''
  }
  if (recovered !== normalizedAddress) {
    throw Object.assign(new Error('Draw authorization signature is invalid.'), {
      statusCode: 401,
      code: 'draw_signature_invalid',
    })
  }

  return challenge
}

function appendLimitedOutput(current, chunk) {
  const next = `${current}${chunk}`
  if (Buffer.byteLength(next) <= drawAdminOutputLimitBytes) return next
  return next.slice(-drawAdminOutputLimitBytes)
}

function parseDrawScriptOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return null
  return JSON.parse(text)
}

function runDrawAdminRound({ roundId, action }) {
  const broadcast = action === 'broadcast'
  const startedAt = new Date().toISOString()
  const args = [
    fileURLToPath(new URL('./run-lucky-draw-round-level.mjs', import.meta.url)),
    '--env-file',
    process.env.DRAW_CONTRACT_ENV_FILE || 'config/draw-contract.env.local',
    '--contract',
    drawContractAddress(),
    '--ledger',
    matchDrawLedgerPath,
    '--winners-out',
    drawWinnersPath,
    '--round-id',
    roundId,
  ]
  if (process.env.DRAW_MATCH_BATCH_SIZE) {
    args.push('--match-batch-size', process.env.DRAW_MATCH_BATCH_SIZE)
  }
  args.push(broadcast ? '--broadcast' : '--verify-only')

  drawAdminRunRunning = true
  lastDrawAdminRun = {
    ok: false,
    startedAt,
    finishedAt: null,
    durationSeconds: null,
    exitCode: null,
    error: null,
    trigger: `draw-admin:${action}:${roundId}`,
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      const finishedAt = new Date().toISOString()
      lastDrawAdminRun = {
        ...lastDrawAdminRun,
        ok: false,
        finishedAt,
        durationSeconds: durationSeconds(startedAt, finishedAt),
        exitCode: null,
        error: `draw script timed out after ${drawAdminScriptTimeoutSeconds} seconds`,
      }
      drawAdminRunRunning = false
      rejectPromise(Object.assign(new Error(lastDrawAdminRun.error), {
        statusCode: 504,
        code: 'draw_script_timeout',
      }))
    }, drawAdminScriptTimeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = appendLimitedOutput(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendLimitedOutput(stderr, chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const finishedAt = new Date().toISOString()
      lastDrawAdminRun = {
        ...lastDrawAdminRun,
        ok: false,
        finishedAt,
        durationSeconds: durationSeconds(startedAt, finishedAt),
        exitCode: null,
        error: error.message,
      }
      drawAdminRunRunning = false
      rejectPromise(Object.assign(error, { statusCode: 500, code: 'draw_script_failed' }))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const finishedAt = new Date().toISOString()
      let payload = null
      let parseError = null
      try {
        payload = parseDrawScriptOutput(stdout)
      } catch (error) {
        parseError = error
      }

      lastDrawAdminRun = {
        ...lastDrawAdminRun,
        ok: code === 0 && !parseError,
        finishedAt,
        durationSeconds: durationSeconds(startedAt, finishedAt),
        exitCode: code,
        error: code === 0 && !parseError
          ? null
          : parseError?.message || `draw script exited with code ${code}`,
      }
      drawAdminRunRunning = false

      if (code === 0 && !parseError) {
        if (broadcast) runDataBackup('draw-admin-round')
        resolvePromise({
          ok: true,
          action,
          roundId,
          result: payload,
          stderr: stderr.trim() || null,
          lastRun: lastDrawAdminRun,
        })
        return
      }

      rejectPromise(Object.assign(new Error(lastDrawAdminRun.error || 'Draw script failed.'), {
        statusCode: 500,
        code: parseError ? 'draw_script_output_invalid' : 'draw_script_failed',
        stdout: stdout.trim() || null,
        stderr: stderr.trim() || null,
      }))
    })
  })
}

function protectAuthRequest(request, response, url) {
  const routePathname = url.pathname === '/auth/callback' ? '/api/auth/renaiss/callback' : url.pathname
  const oauthStart = /^\/api\/auth\/([^/]+)\/start$/.exec(routePathname)
  if (oauthStart && request.method === 'GET') {
    if (!enforceRateLimit(request, response, authStartRateLimitRules(request, oauthStart[1]))) return false
  }

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || '')) return true
  if (!routePathname.startsWith('/api/auth/')) return true
  if (!enforceUnsafeRequestOrigin(request, response)) return false

  const session = readAuthSession(auth, request)
  if (!enforceSessionCsrf(request, response, session)) return false

  if (routePathname === '/api/auth/x-follow/verify') {
    const status = getXFollowStatus(auth, session, request)
    return enforceRateLimit(request, response, xFollowVerifyRateLimitRules(request, session, status))
  }

  if (routePathname === '/api/auth/x-account-eligibility/verify') {
    const xFollowStatus = getXFollowStatus(auth, session, request)
    const status = getXAccountEligibilityStatus(auth, session, request, { xFollowStatus })
    return enforceRateLimit(request, response, xEligibilityRateLimitRules(request, session, status))
  }

  return true
}

function publicHealthPayload() {
  return {
    ok: true,
    runtimeTarget,
    service: 'renaiss-worldcup',
    checkedAt: new Date().toISOString(),
  }
}

function privateHealthPayload() {
  return {
    ...publicHealthPayload(),
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
    drawAdmin: drawAdminStatusPayload({ includeLastRun: true, includePrivate: true }),
    authDir: auth.authDir,
    auth: {
      ...getAuthPublicStatus(auth),
      requiredForVotes: authRequiredForVotes,
    },
    refreshEnabled,
    refreshOnStartup,
    refreshMinutes,
    eventCacheLookbackRounds,
    eventCacheLookbackMinutes,
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
    security: {
      healthAdminTokenConfigured: Boolean(healthAdminToken),
      rateLimitEnabled,
      rateLimitBucketCount: rateLimiter.size(),
    },
  }
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
    eventHashHead: state?.eventHashHead || null,
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
  const corsHeaders = corsHeadersForRequest(request, process.env)
  const vary = appendVary(appendVary('Accept-Encoding', corsHeaders.vary), headers.vary)
  delete corsHeaders.vary
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(vary ? { vary } : {}),
    ...(compress ? { 'content-encoding': 'gzip' } : {}),
    ...corsHeaders,
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

async function readLiveQualificationSnapshot() {
  const now = Date.now()
  const cached = fifaStandingsCache
  if (cached?.snapshot && now - cached.fetchedAtMs <= fifaStandingsCacheMs) {
    return {
      ...cached.snapshot,
      cacheStatus: 'hit',
      cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
    }
  }

  try {
    const snapshot = await fetchFifaQualificationSnapshot(fetch)
    fifaStandingsCache = { snapshot, fetchedAtMs: now }
    return {
      ...snapshot,
      cacheStatus: 'fresh',
      cacheAgeSeconds: 0,
    }
  } catch (error) {
    if (cached?.snapshot) {
      return {
        ...cached.snapshot,
        sourceStatus: 'stale',
        issue: error instanceof Error ? error.message : 'Could not fetch FIFA standings.',
        cacheStatus: 'stale',
        cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
      }
    }
    throw error
  }
}

async function readLiveRound32MatchesSnapshot() {
  const now = Date.now()
  const cached = fifaRound32MatchesCache
  if (cached?.snapshot && now - cached.fetchedAtMs <= fifaRound32MatchesCacheMs) {
    return {
      ...cached.snapshot,
      cacheStatus: 'hit',
      cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
    }
  }

  try {
    const snapshot = await fetchFifaRound32MatchesSnapshot(fetch)
    fifaRound32MatchesCache = { snapshot, fetchedAtMs: now }
    return {
      ...snapshot,
      cacheStatus: 'fresh',
      cacheAgeSeconds: 0,
    }
  } catch (error) {
    if (cached?.snapshot) {
      return {
        ...cached.snapshot,
        sourceStatus: 'stale',
        issue: error instanceof Error ? error.message : 'Could not fetch FIFA round32 matches.',
        cacheStatus: 'stale',
        cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
      }
    }
    throw error
  }
}

async function readLiveRound16MatchesSnapshot() {
  const now = Date.now()
  const cached = fifaRound16MatchesCache
  if (cached?.snapshot && now - cached.fetchedAtMs <= fifaRound16MatchesCacheMs) {
    return {
      ...cached.snapshot,
      cacheStatus: 'hit',
      cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
    }
  }

  try {
    const snapshot = await fetchFifaRound16MatchesSnapshot(fetch)
    fifaRound16MatchesCache = { snapshot, fetchedAtMs: now }
    return {
      ...snapshot,
      cacheStatus: 'fresh',
      cacheAgeSeconds: 0,
    }
  } catch (error) {
    if (cached?.snapshot) {
      return {
        ...cached.snapshot,
        sourceStatus: 'stale',
        issue: error instanceof Error ? error.message : 'Could not fetch FIFA round16 matches.',
        cacheStatus: 'stale',
        cacheAgeSeconds: Math.max(0, Math.round((now - cached.fetchedAtMs) / 1000)),
      }
    }
    throw error
  }
}

function distPathForUrl(url) {
  const rawPath = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(distDir, `.${safePath}`)
  return candidate.startsWith(distDir) ? candidate : null
}

function buildMilestoneSummary(ledger) {
  const currentMetricValue = Number(ledger.totalRawTickets || 0)
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
  if (eventCacheLookbackMinutes > 0) {
    args.push('--event-cache-lookback-minutes', String(eventCacheLookbackMinutes))
  }

  console.log(
    `[ledger-refresh] start trigger=${trigger} data=${dataDir} cache=${cacheDir} lookback=${eventCacheLookbackMinutes}m`,
  )
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

function sendOptions(request, response) {
  if (!isAllowedRequestOrigin(request, process.env, { allowMissing: true })) {
    sendSecurityError(request, response, 403, {
      code: 'invalid_origin',
      error: 'Request origin is not allowed.',
    })
    return
  }

  const corsHeaders = corsHeadersForRequest(request, process.env)
  response.writeHead(204, {
    ...corsHeaders,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, x-csrf-token',
    'access-control-max-age': '86400',
  })
  response.end()
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'OPTIONS') {
    sendOptions(request, response)
    return
  }

  if (url.pathname === '/healthz') {
    sendJson(request, response, 200, publicHealthPayload(), {
      'cache-control': 'no-store',
    })
    return
  }

  if (url.pathname === '/health') {
    if (!healthAdminToken || !requestHasBearerToken(request, healthAdminToken)) {
      sendJson(request, response, healthAdminToken ? 401 : 404, {
        ok: false,
        code: healthAdminToken ? 'health_token_required' : 'health_disabled',
        error: healthAdminToken ? 'Health token is required.' : 'Health diagnostics are not enabled.',
      }, {
        'cache-control': 'no-store',
      })
      return
    }

    sendJson(
      request,
      response,
      200,
      privateHealthPayload(),
      {
        'cache-control': 'no-store',
      },
    )
    return
  }

  if (!protectAuthRequest(request, response, url)) {
    return
  }

  if (await handleAuthRoute({ auth, request, response, url, readJsonBody, sendJson })) {
    return
  }

  if (url.pathname === '/api/draw-admin/status') {
    sendJson(request, response, 200, drawAdminStatusPayload(), {
      'cache-control': 'no-store',
    })
    return
  }

  if (url.pathname === '/api/draw-admin/challenge') {
    if (request.method !== 'POST') {
      sendJson(request, response, 405, { ok: false, error: 'POST required.' }, { 'cache-control': 'no-store' })
      return
    }

    try {
      if (!enforceUnsafeRequestOrigin(request, response)) return
      const body = await readJsonBody(request)
      const action = normalizeDrawAdminAction(body?.action, body?.broadcast)
      const roundId = normalizeDrawAdminRoundId(body?.roundId)
      const address = assertDrawAdminWalletAllowed(body?.address)
      assertDrawAdminReady({ requireBroadcast: action === 'broadcast' })
      if (!enforceRateLimit(request, response, drawAdminRateLimitRules(request, address, action))) return

      sendJson(
        request,
        response,
        200,
        {
          ok: true,
          ...createDrawAdminChallenge({ address, action, roundId }),
        },
        { 'cache-control': 'no-store' },
      )
    } catch (error) {
      sendJson(
        request,
        response,
        Number(error?.statusCode || 500),
        {
          ok: false,
          code: error?.code || 'draw_challenge_failed',
          error: error instanceof Error ? error.message : 'Could not create draw authorization challenge.',
        },
        { 'cache-control': 'no-store' },
      )
    }
    return
  }

  if (url.pathname === '/api/draw-admin/round') {
    if (request.method !== 'POST') {
      sendJson(request, response, 405, { ok: false, error: 'POST required.' }, { 'cache-control': 'no-store' })
      return
    }

    try {
      if (!enforceUnsafeRequestOrigin(request, response)) return
      const body = await readJsonBody(request)
      const action = normalizeDrawAdminAction(body?.action, body?.broadcast)
      const roundId = normalizeDrawAdminRoundId(body?.roundId)
      const address = assertDrawAdminWalletAllowed(body?.address)
      assertDrawAdminReady({ requireBroadcast: action === 'broadcast' })
      if (!enforceRateLimit(request, response, drawAdminRateLimitRules(request, address, action))) return
      verifyDrawAdminChallenge({
        address,
        action,
        roundId,
        nonce: body?.nonce,
        signature: body?.signature,
      })
      if (drawAdminRunRunning) {
        sendJson(request, response, 409, {
          ok: false,
          code: 'draw_admin_running',
          error: 'A draw operation is already running.',
          lastRun: lastDrawAdminRun,
        }, { 'cache-control': 'no-store' })
        return
      }

      const result = await runDrawAdminRound({ roundId, action })
      sendJson(request, response, 200, result, { 'cache-control': 'no-store' })
    } catch (error) {
      sendJson(
        request,
        response,
        Number(error?.statusCode || 500),
        {
          ok: false,
          code: error?.code || 'draw_round_failed',
          error: error instanceof Error ? error.message : 'Draw round operation failed.',
          stdout: error?.stdout || undefined,
          stderr: error?.stderr || undefined,
          lastRun: lastDrawAdminRun,
        },
        { 'cache-control': 'no-store' },
      )
    }
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

  if (url.pathname === '/api/live-qualification') {
    try {
      sendJson(request, response, 200, await readLiveQualificationSnapshot(), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendJson(
        request,
        response,
        503,
        {
          error: error instanceof Error ? error.message : 'Could not read FIFA standings.',
        },
        {
          'cache-control': 'no-store',
        },
      )
    }
    return
  }

  if (url.pathname === '/api/live-round32-matches') {
    try {
      sendJson(request, response, 200, await readLiveRound32MatchesSnapshot(), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendJson(
        request,
        response,
        503,
        {
          error: error instanceof Error ? error.message : 'Could not read FIFA round32 matches.',
        },
        {
          'cache-control': 'no-store',
        },
      )
    }
    return
  }

  if (url.pathname === '/api/live-round16-matches') {
    try {
      sendJson(request, response, 200, await readLiveRound16MatchesSnapshot(), {
        'cache-control': 'no-store',
      })
    } catch (error) {
      sendJson(
        request,
        response,
        503,
        {
          error: error instanceof Error ? error.message : 'Could not read FIFA round16 matches.',
        },
        {
          'cache-control': 'no-store',
        },
      )
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

    let voteLogDetails = {
      requestId: 'unread',
      roundId: 'unread',
      matchId: 'unread',
      teamId: 'unread',
      tickets: 'unread',
      wallet: 'none',
    }

    try {
      const session = readAuthSession(auth, request)
      if (!enforceUnsafeRequestOrigin(request, response)) return
      if (authRequiredForVotes && !enforceSessionCsrf(request, response, session)) return
      if (!enforceRateLimit(request, response, voteRateLimitRules(request, session))) return

      const body = await readJsonBody(request)
      voteLogDetails = getVoteSubmitLogDetails(body, session)
      writeVoteSubmitLog('log', 'received', voteLogDetails)
      if (authRequiredForVotes && !session) {
        writeVoteSubmitLog('warn', 'blocked', { ...voteLogDetails, reason: 'login_required', status: 401 })
        sendJson(request, response, 401, { ok: false, error: 'Login is required before submitting votes.' }, { 'cache-control': 'no-store' })
        return
      }
      if (authRequiredForVotes && !session?.walletAddress) {
        writeVoteSubmitLog('warn', 'blocked', { ...voteLogDetails, reason: 'wallet_unlinked', status: 403 })
        sendJson(request, response, 403, { ok: false, error: 'This login is not linked to a voting wallet yet.' }, { 'cache-control': 'no-store' })
        return
      }
      const xFollowStatus = getXFollowStatus(auth, session, request)
      if (authRequiredForVotes && auth.xFollowGateConfig.required && !xFollowStatus.gatePassed) {
        writeVoteSubmitLog('warn', 'blocked', { ...voteLogDetails, reason: 'x_follow_required', status: 403 })
        sendJson(request, response, 403, { ok: false, error: 'Follow verification is required before submitting votes.' }, { 'cache-control': 'no-store' })
        return
      }
      if (authRequiredForVotes) {
        try {
          assertXAccountEligibilityForVote(auth, session, request, { xFollowStatus })
        } catch (error) {
          writeVoteSubmitLog('warn', 'blocked', {
            ...voteLogDetails,
            reason: error?.code || 'x_account_eligibility_required',
            status: Number(error?.statusCode || 403),
          })
          sendJson(
            request,
            response,
            Number(error?.statusCode || 403),
            {
              ok: false,
              code: error?.code || 'x_account_eligibility_required',
              error: error instanceof Error ? error.message : 'Firefly eligibility verification is required before submitting votes.',
              status: error?.status || getXAccountEligibilityStatus(auth, session, request, { xFollowStatus }),
            },
            { 'cache-control': 'no-store' },
          )
          return
        }
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
      writeVoteSubmitLog('log', 'accepted', {
        ...voteLogDetails,
        allocationId: result.allocation?.id || 'none',
        eventId: result.event?.id || 'none',
        status: 201,
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
      writeVoteSubmitLog(status >= 500 ? 'error' : 'warn', 'failed', {
        ...voteLogDetails,
        status,
        error: error instanceof Error ? error.message : 'Vote submission failed.',
      })
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
    sendJson(request, response, 200, readLedgerPayload(ledgerPath), {
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
