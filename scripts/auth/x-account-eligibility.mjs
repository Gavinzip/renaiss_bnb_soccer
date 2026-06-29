import { join } from 'node:path'

import { readJsonFile, writeJsonFileAtomic } from './json-store.mjs'
import { getXFollowStatus } from './x-follow-gate.mjs'

const DEFAULT_API_BASE_URL = 'https://api.firefly.land'
const DEFAULT_PATH = '/v1/renaiss/x-account/eligibility'
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i

function nowIso() {
  return new Date().toISOString()
}

function envEnabled(value, defaultValue = true) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return defaultValue
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  return defaultValue
}

function readIntegerEnv(env, names, defaultValue, minValue = 0) {
  for (const name of names) {
    const value = Number(env[name])
    if (Number.isFinite(value)) return Math.max(minValue, Math.floor(value))
  }
  return defaultValue
}

function normalizeAddress(value) {
  const address = String(value || '').trim()
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function cleanXUserId(value) {
  const id = String(value ?? '').trim()
  return /^\d{1,32}$/.test(id) ? id : ''
}

function emptyEligibilityState() {
  return {
    version: 1,
    updatedAt: null,
    checks: {},
  }
}

function readState(path) {
  const state = readJsonFile(path, emptyEligibilityState())
  return {
    ...emptyEligibilityState(),
    ...state,
    checks: Object.fromEntries(
      Object.entries(state.checks || {}).filter(([, record]) => record && typeof record === 'object'),
    ),
  }
}

function writeState(path, state) {
  writeJsonFileAtomic(path, {
    ...state,
    version: 1,
    updatedAt: nowIso(),
  })
}

function statusKey(walletAddress, xUserId) {
  return walletAddress && xUserId ? `${walletAddress}:x:${xUserId}` : ''
}

function readRecord(config, walletAddress, xUserId) {
  const key = statusKey(walletAddress, xUserId)
  if (!key) return null
  return readState(config.path).checks[key] || null
}

function recordExpiresAt(record, config) {
  if (!record?.lastCheckedAt || !config.cacheTtlSeconds) return null
  const checkedAt = Date.parse(record.lastCheckedAt)
  if (!Number.isFinite(checkedAt)) return null
  return new Date(checkedAt + config.cacheTtlSeconds * 1000).toISOString()
}

function recordIsFresh(record, config) {
  if (!record?.lastCheckedAt) return false
  if (!config.cacheTtlSeconds) return true
  const checkedAt = Date.parse(record.lastCheckedAt)
  return Number.isFinite(checkedAt) && checkedAt + config.cacheTtlSeconds * 1000 > Date.now()
}

function responseCodeForRecord(record) {
  if (!record) return 'unverified'
  if (record.eligible) return 'eligible'
  if (
    record.lastErrorCode
    && typeof record.hasFireflyAccount !== 'boolean'
    && typeof record.hasPlacedBet !== 'boolean'
  ) {
    return record.lastErrorCode
  }
  if (record.hasFireflyAccount === false) return 'missing_firefly_account'
  if (record.hasPlacedBet === false) return 'missing_predict_bet'
  return 'ineligible'
}

function buildStatus({
  config,
  session,
  xFollowStatus,
  walletAddress,
  xUserId,
  record,
  status,
  gatePassed = false,
}) {
  return {
    required: config.required,
    configured: Boolean(config.apiKey),
    authenticated: Boolean(session),
    walletAddress: walletAddress || null,
    xUserId: xUserId || null,
    xFollowPassed: Boolean(xFollowStatus?.gatePassed),
    verified: Boolean(gatePassed),
    gatePassed: Boolean(gatePassed || !config.required),
    eligible: typeof record?.eligible === 'boolean' ? record.eligible : null,
    hasFireflyAccount: typeof record?.hasFireflyAccount === 'boolean' ? record.hasFireflyAccount : null,
    hasPlacedBet: typeof record?.hasPlacedBet === 'boolean' ? record.hasPlacedBet : null,
    status,
    lastCheckedAt: record?.lastCheckedAt || null,
    expiresAt: recordExpiresAt(record, config),
  }
}

function readSubject(auth, session, request, options = {}) {
  const xFollowStatus = options.xFollowStatus || getXFollowStatus(auth, session, request)
  const walletAddress = normalizeAddress(session?.walletAddress || xFollowStatus?.walletAddress)
  const xUserId = cleanXUserId(xFollowStatus?.xUserId || '')
  return { xFollowStatus, walletAddress, xUserId }
}

function eligibilityErrorMessage(code) {
  if (code === 'login_required') return 'Login is required before vote eligibility verification.'
  if (code === 'wallet_required') return 'This login is not linked to a voting wallet yet.'
  if (code === 'x_follow_required') return 'X follow verification is required before Firefly eligibility verification.'
  if (code === 'x_identity_required') return 'A verified X account id is required before Firefly eligibility verification.'
  if (code === 'service_unconfigured') return 'Firefly eligibility API is not configured.'
  if (code === 'missing_firefly_account') return 'This X account is not linked to an active Firefly account.'
  if (code === 'missing_predict_bet') return 'This X account has not placed a Predict bet yet.'
  if (code === 'eligibility_expired') return 'Firefly eligibility verification expired. Verify again before voting.'
  if (code === 'rate_limited') return 'Firefly eligibility verification is rate limited. Try again later.'
  if (code === 'request_timeout') return 'Firefly eligibility verification timed out. Try again later.'
  if (code === 'api_error') return 'Firefly eligibility verification is temporarily unavailable.'
  return 'Firefly eligibility verification is required before voting.'
}

function throwEligibilityError(code, status, statusCode = 403, extra = {}) {
  throw Object.assign(new Error(eligibilityErrorMessage(code)), {
    statusCode,
    code,
    status,
    ...extra,
  })
}

function normalizeEligibilityPayload(payload) {
  const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  return {
    eligible: Boolean(source?.eligible),
    hasFireflyAccount: Boolean(source?.has_ff_account),
    hasPlacedBet: Boolean(source?.has_placed_bet),
  }
}

async function fetchEligibility(config, xUserId) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const url = new URL(config.path, `${config.apiBaseUrl}/`)
  url.searchParams.set('x_account_id', xUserId)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'x-api-key': config.apiKey,
        'user-agent': 'renaiss-worldcup-eligibility/0.1.0',
      },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const code = response.status === 401
        ? 'service_unconfigured'
        : response.status === 429
          ? 'rate_limited'
          : 'api_error'
      const error = new Error(payload?.error || payload?.message || `Firefly eligibility API returned HTTP ${response.status}.`)
      error.statusCode = response.status === 429 ? 429 : 503
      error.code = code
      error.retryAfterSeconds = Number(response.headers.get('retry-after') || 0) || 0
      throw error
    }

    const eligibility = normalizeEligibilityPayload(payload)
    return {
      ...eligibility,
      rawStatus: response.status,
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error(eligibilityErrorMessage('request_timeout')), {
        statusCode: 503,
        code: 'request_timeout',
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function saveEligibilityResult(config, walletAddress, xUserId, result) {
  const key = statusKey(walletAddress, xUserId)
  if (!key) return
  const checkedAt = nowIso()
  const state = readState(config.path)
  const existing = state.checks[key] || {}
  state.checks[key] = {
    ...existing,
    walletAddress,
    xUserId,
    eligible: Boolean(result.eligible),
    hasFireflyAccount: Boolean(result.hasFireflyAccount),
    hasPlacedBet: Boolean(result.hasPlacedBet),
    status: result.eligible ? 'eligible' : responseCodeForRecord(result),
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
    lastError: null,
  }
  writeState(config.path, state)
}

function saveEligibilityFailure(config, walletAddress, xUserId, error) {
  const key = statusKey(walletAddress, xUserId)
  if (!key) return
  const checkedAt = nowIso()
  const state = readState(config.path)
  const existing = state.checks[key] || {}
  state.checks[key] = {
    ...existing,
    walletAddress,
    xUserId,
    lastError: error instanceof Error ? error.message : String(error || ''),
    lastErrorCode: error?.code || 'api_error',
    lastErrorAt: checkedAt,
    updatedAt: checkedAt,
  }
  writeState(config.path, state)
}

export function createXAccountEligibilityConfig({ authDir, env = process.env }) {
  const apiKey = String(
    env.FIREFLY_RENAISS_API_KEY
      || env.FIREFLY_X_ACCOUNT_ELIGIBILITY_API_KEY
      || env.X_ACCOUNT_ELIGIBILITY_API_KEY
      || '',
  ).trim()

  return {
    path: join(authDir, 'x-account-eligibility.json'),
    apiBaseUrl: String(env.FIREFLY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
    apiPath: String(env.FIREFLY_X_ACCOUNT_ELIGIBILITY_PATH || DEFAULT_PATH),
    apiKey,
    required: envEnabled(env.FIREFLY_X_ACCOUNT_ELIGIBILITY_REQUIRED ?? env.X_ACCOUNT_ELIGIBILITY_REQUIRED, true),
    timeoutMs: readIntegerEnv(env, ['FIREFLY_X_ACCOUNT_ELIGIBILITY_TIMEOUT_MS', 'X_ACCOUNT_ELIGIBILITY_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS, 1000),
    cacheTtlSeconds: readIntegerEnv(
      env,
      ['FIREFLY_X_ACCOUNT_ELIGIBILITY_TTL_SECONDS', 'X_ACCOUNT_ELIGIBILITY_TTL_SECONDS'],
      DEFAULT_CACHE_TTL_SECONDS,
      0,
    ),
  }
}

export function getXAccountEligibilityStatus(auth, session, request, options = {}) {
  const config = auth.xAccountEligibilityConfig
  const { xFollowStatus, walletAddress, xUserId } = readSubject(auth, session, request, options)
  const record = readRecord(config, walletAddress, xUserId)

  if (!config.required) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'not_required', gatePassed: true })
  }
  if (!session) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'login_required' })
  }
  if (!walletAddress) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'wallet_required' })
  }
  if (!xFollowStatus?.gatePassed) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'x_follow_required' })
  }
  if (!xUserId) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'x_identity_required' })
  }
  if (!config.apiKey) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'service_unconfigured' })
  }
  if (!record) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'unverified' })
  }
  if (record.eligible && recordIsFresh(record, config)) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'eligible', gatePassed: true })
  }
  if (record.eligible && !recordIsFresh(record, config)) {
    return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: 'eligibility_expired' })
  }
  return buildStatus({ config, session, xFollowStatus, walletAddress, xUserId, record, status: responseCodeForRecord(record) })
}

export async function verifyXAccountEligibility(auth, session, request, options = {}) {
  const config = auth.xAccountEligibilityConfig
  const subject = readSubject(auth, session, request, options)
  const status = getXAccountEligibilityStatus(auth, session, request, subject)

  if (!config.required) return status
  if (!session) throwEligibilityError('login_required', status, 401)
  if (!subject.walletAddress) throwEligibilityError('wallet_required', status, 403)
  if (!subject.xFollowStatus?.gatePassed) throwEligibilityError('x_follow_required', status, 403)
  if (!subject.xUserId) throwEligibilityError('x_identity_required', status, 403)
  if (!config.apiKey) throwEligibilityError('service_unconfigured', status, 503)
  if (status.gatePassed && !options.force) return status

  try {
    const result = await fetchEligibility({
      ...config,
      path: config.apiPath || DEFAULT_PATH,
    }, subject.xUserId)
    saveEligibilityResult(config, subject.walletAddress, subject.xUserId, result)
  } catch (error) {
    saveEligibilityFailure(config, subject.walletAddress, subject.xUserId, error)
    const failedStatus = getXAccountEligibilityStatus(auth, session, request, subject)
    throwEligibilityError(error?.code || 'api_error', failedStatus, Number(error?.statusCode || 503), {
      retryAfterSeconds: error?.retryAfterSeconds || 0,
    })
  }

  const nextStatus = getXAccountEligibilityStatus(auth, session, request, subject)
  if (!nextStatus.gatePassed) {
    throwEligibilityError(nextStatus.status, nextStatus, 403)
  }
  return nextStatus
}

export function assertXAccountEligibilityForVote(auth, session, request, options = {}) {
  const status = getXAccountEligibilityStatus(auth, session, request, options)
  if (!auth.xAccountEligibilityConfig.required || status.gatePassed) return status
  const statusCode = status.status === 'login_required' ? 401 : status.status === 'service_unconfigured' ? 503 : 403
  throwEligibilityError(status.status, status, statusCode)
}
