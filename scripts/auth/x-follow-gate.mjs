import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

import { parseCookies, serializeCookie } from './cookies.mjs'
import { readJsonFile, writeJsonFileAtomic } from './json-store.mjs'
import { readOAuthToken, saveOAuthToken } from './oauth-token-store.mjs'

const DEFAULT_TARGET_HANDLE = 'thefireflyapp'
const DEFAULT_RETRY_SECONDS = 60
const SKIP_COOKIE = 'renaiss_x_follow_skip'
const SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase()
}

function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function envEnabled(value, defaultValue = true) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return defaultValue
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  return defaultValue
}

function hasSigningSecret(config) {
  return Boolean(config?.sessionSecret && config.sessionSecret.length >= 32)
}

function signValue(secret, value) {
  return createHmac('sha256', secret).update(String(value)).digest('base64url')
}

function hashValue(secret, value) {
  return createHmac('sha256', secret).update(String(value)).digest('hex')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function skipCookieValue(config, token) {
  return `${token}.${signValue(config.sessionSecret, token)}`
}

function readSkipCookieToken(config, request) {
  if (!config.skipEnabled || !hasSigningSecret(config) || !request) return ''
  const cookies = parseCookies(request.headers.cookie || '')
  const [token, signature] = String(cookies[config.skipCookieName] || '').split('.')
  if (!token || !signature) return ''
  return safeEqual(signature, signValue(config.sessionSecret, token)) ? token : ''
}

function emptyVerificationState() {
  return {
    version: 1,
    updatedAt: null,
    verifications: {},
  }
}

function normalizeWalletAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function legacyXVerificationKey(providerUserId, targetHandle) {
  return `${targetHandle}:${providerUserId}`
}

function identityVerificationKey(identity, targetHandle) {
  if (!identity?.provider || !identity?.providerUserId) return ''
  return `${targetHandle}:${identity.provider}:${identity.providerUserId}`
}

function verificationSubject(session) {
  const walletAddress = normalizeWalletAddress(session?.walletAddress)
  if (walletAddress) {
    return {
      type: 'wallet',
      walletAddress,
      keyPart: `wallet:${walletAddress}`,
    }
  }

  const identity = session?.identity || null
  if (identity?.provider && identity?.providerUserId) {
    return {
      type: 'identity',
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      keyPart: `${identity.provider}:${identity.providerUserId}`,
    }
  }

  return null
}

function sessionVerificationKeys(session, targetHandle) {
  const identity = session?.identity || null
  const subject = verificationSubject(session)
  const current = subject ? `${targetHandle}:${subject.keyPart}` : ''
  const identityKey = identityVerificationKey(identity, targetHandle)
  const legacy = identity?.provider === 'x' ? legacyXVerificationKey(identity.providerUserId, targetHandle) : ''
  return [...new Set([current, identityKey, legacy].filter(Boolean))]
}

function skipCookieRecordKey(config, token) {
  return `${config.targetHandle}:skip-cookie:${hashValue(config.sessionSecret, token)}`
}

function readSessionRecord(state, session, targetHandle) {
  const records = sessionVerificationKeys(session, targetHandle)
    .map((key) => state.verifications[key])
    .filter(Boolean)
  return records.find((record) => record.status === 'verified')
    || records.find((record) => record.status === 'skipped')
    || records[0]
    || null
}

function readCookieSkipRecord(config, state, request) {
  const token = readSkipCookieToken(config, request)
  if (!token) return null
  const record = state.verifications[skipCookieRecordKey(config, token)] || null
  return record?.status === 'skipped' ? record : null
}

function createSkipCookie(config, token, maxAgeSeconds = Math.floor(SKIP_TTL_MS / 1000)) {
  return serializeCookie(config.skipCookieName, skipCookieValue(config, token), {
    maxAge: maxAgeSeconds,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
  })
}

function clearSkipCookie(config) {
  return serializeCookie(config.skipCookieName, '', {
    maxAge: 0,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
  })
}

function readState(path) {
  const state = readJsonFile(path, emptyVerificationState())
  return {
    ...emptyVerificationState(),
    ...state,
    verifications: Object.fromEntries(
      Object.entries(state.verifications || {}).filter(([, record]) => (
        record && typeof record === 'object'
      )),
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

function retryAfterSeconds(record, retrySeconds) {
  if (['verified', 'skipped'].includes(record?.status)) return 0
  const lastCheckedAt = Date.parse(record?.lastCheckedAt || '')
  if (!Number.isFinite(lastCheckedAt)) return 0
  const retryAt = lastCheckedAt + retrySeconds * 1000
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
}

function xIdentityFromSession(session) {
  const identity = session?.identity || null
  return identity?.provider === 'x' && identity?.providerUserId ? identity : null
}

function getSessionXIdentity(auth, session) {
  const token = readOAuthToken(auth.oauthTokenConfig, session, 'x')
  const tokenIdentity = token?.identity || null
  if (tokenIdentity?.provider === 'x' && tokenIdentity?.providerUserId) return tokenIdentity
  return xIdentityFromSession(session)
}

function checkWalletXIdentity(auth, session, xIdentity = null) {
  if (!auth.userProfileStore?.checkXIdentityForWallet) {
    return {
      ok: false,
      code: 'profile_store_missing',
      expectedUsername: null,
      actualUsername: xIdentity?.username || null,
    }
  }
  return auth.userProfileStore.checkXIdentityForWallet({
    walletAddress: session?.walletAddress,
    identity: xIdentity,
  })
}

function statusForSession(auth, session, request) {
  const config = auth.xFollowGateConfig
  const xIdentity = session ? getSessionXIdentity(auth, session) : null
  const subject = verificationSubject(session)
  const target = {
    handle: config.targetHandle,
    url: config.targetUrl,
  }
  const state = readState(config.path)
  const cookieRecord = readCookieSkipRecord(config, state, request)
  const cookieBypassed = config.skipEnabled && cookieRecord?.status === 'skipped'
  const cookieBypassStatus = {
    target,
    authenticated: Boolean(session),
    xConnected: false,
    verified: false,
    gatePassed: true,
    bypassed: true,
    skipEnabled: config.skipEnabled,
    status: 'skipped',
    verifiedAt: null,
    bypassedAt: cookieRecord?.bypassedAt || null,
    lastCheckedAt: cookieRecord?.lastCheckedAt || null,
    retryAfterSeconds: 0,
    connectionStatus: [],
  }

  if (!session) {
    if (cookieBypassed) return cookieBypassStatus
    return {
      target,
      authenticated: false,
      xConnected: false,
      verified: false,
      gatePassed: false,
      bypassed: false,
      skipEnabled: config.skipEnabled,
      status: 'login_required',
      verifiedAt: null,
      bypassedAt: null,
      lastCheckedAt: null,
      retryAfterSeconds: 0,
      connectionStatus: [],
    }
  }

  const rawRecord = readSessionRecord(state, session, config.targetHandle) || cookieRecord || null
  const record = rawRecord?.status === 'skipped' && !config.skipEnabled ? null : rawRecord
  const verified = record?.status === 'verified'
  const bypassed = config.skipEnabled && record?.status === 'skipped'
  const common = {
    target,
    authenticated: true,
    verificationScope: subject?.type || 'session',
    walletAddress: subject?.walletAddress || null,
    verified,
    gatePassed: verified || bypassed,
    bypassed,
    skipEnabled: config.skipEnabled,
    status: record?.status || null,
    verifiedAt: record?.verifiedAt || null,
    bypassedAt: bypassed ? (record?.bypassedAt || null) : null,
    lastCheckedAt: record?.lastCheckedAt || null,
    retryAfterSeconds: retryAfterSeconds(record, config.retrySeconds),
    connectionStatus: Array.isArray(record?.connectionStatus) ? record.connectionStatus : [],
  }

  const walletIdentityCheck = subject?.type === 'wallet'
    ? checkWalletXIdentity(auth, session, null)
    : { ok: false, code: 'wallet_required', expectedUsername: null, actualUsername: null }

  if (!walletIdentityCheck.ok) {
    return {
      ...common,
      verified: false,
      gatePassed: false,
      xConnected: Boolean(xIdentity?.providerUserId),
      xUserId: xIdentity?.providerUserId || null,
      username: xIdentity?.username || null,
      xIdentityMatch: false,
      expectedTwitterUsername: walletIdentityCheck.expectedUsername || null,
      status: walletIdentityCheck.code,
    }
  }

  if (!xIdentity?.providerUserId) {
    return {
      ...common,
      xConnected: false,
      xIdentityMatch: null,
      expectedTwitterUsername: walletIdentityCheck.expectedUsername || null,
      status: common.status || 'x_login_required',
    }
  }

  const xIdentityCheck = checkWalletXIdentity(auth, session, xIdentity)
  if (!xIdentityCheck.ok) {
    return {
      ...common,
      verified: false,
      gatePassed: false,
      xConnected: true,
      xUserId: xIdentity.providerUserId,
      username: xIdentity.username || null,
      xIdentityMatch: false,
      expectedTwitterUsername: xIdentityCheck.expectedUsername || null,
      status: xIdentityCheck.code,
    }
  }

  return {
    ...common,
    xConnected: true,
    xUserId: xIdentity.providerUserId,
    username: xIdentity.username || null,
    xIdentityMatch: true,
    expectedTwitterUsername: xIdentityCheck.expectedUsername || null,
    status: common.status || 'unverified',
  }
}

async function refreshXToken(auth, session, token) {
  const refreshToken = token?.refresh_token
  if (!refreshToken) return token

  const config = auth.providerConfig.x
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const headers = { 'content-type': 'application/x-www-form-urlencoded' }

  if (config.tokenAuthMethod === 'basic' && config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
  } else {
    body.set('client_id', config.clientId)
    if (config.clientSecret) body.set('client_secret', config.clientSecret)
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.access_token) return token
  if (!payload.refresh_token && refreshToken) {
    payload.refresh_token = refreshToken
  }
  saveOAuthToken(auth.oauthTokenConfig, session, 'x', payload, {
    identity: token.identity || xIdentityFromSession(session),
  })
  return payload
}

async function readUsableXToken(auth, session) {
  let token = readOAuthToken(auth.oauthTokenConfig, session, 'x')
  if (!token?.access_token) return null

  const expiresAt = Date.parse(token.accessTokenExpiresAt || '')
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000) {
    token = await refreshXToken(auth, session, token)
  }

  return token?.access_token ? token : null
}

async function fetchConnectionStatus(auth, config, session, accessToken) {
  const url = new URL(`${config.apiBaseUrl}/users/by/username/${encodeURIComponent(config.targetHandle)}`)
  url.searchParams.set('user.fields', 'connection_status,username,name')

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'renaiss-x-follow-gate/0.1.0',
    },
  })
  const payload = await response.json().catch(() => ({}))

  if ((response.status === 401 || response.status === 403) && session) {
    const token = readOAuthToken(auth.oauthTokenConfig, session, 'x')
    const refreshed = await refreshXToken(auth, session, token)
    if (refreshed?.access_token && refreshed.access_token !== accessToken) {
      return fetchConnectionStatus(auth, config, null, refreshed.access_token)
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.title || payload?.error || `X API returned HTTP ${response.status}`)
    error.statusCode = response.status === 429 ? 429 : 502
    error.xStatus = response.status
    error.payload = payload
    error.rateLimit = {
      limit: response.headers.get('x-rate-limit-limit'),
      remaining: response.headers.get('x-rate-limit-remaining'),
      reset: response.headers.get('x-rate-limit-reset'),
    }
    throw error
  }

  return {
    targetUser: payload?.data || null,
    connectionStatus: Array.isArray(payload?.data?.connection_status) ? payload.data.connection_status : [],
    rateLimit: {
      limit: response.headers.get('x-rate-limit-limit'),
      remaining: response.headers.get('x-rate-limit-remaining'),
      reset: response.headers.get('x-rate-limit-reset'),
    },
  }
}

function saveVerificationResult(auth, session, result) {
  const config = auth.xFollowGateConfig
  const xIdentity = getSessionXIdentity(auth, session)
  const subject = verificationSubject(session)
  const checkedAt = nowIso()
  const connectionStatus = Array.isArray(result.connectionStatus) ? result.connectionStatus : []
  const verified = connectionStatus.includes('following')
  const state = readState(config.path)
  const key = sessionVerificationKeys(session, config.targetHandle)[0]
  if (!key || !subject || !xIdentity?.providerUserId) {
    throw Object.assign(new Error('X follow verification requires a session identity and connected X identity.'), {
      statusCode: 409,
    })
  }
  const existing = state.verifications[key] || {}

  state.verifications[key] = {
    ...existing,
    subjectType: subject?.type || existing.subjectType || 'identity',
    walletAddress: subject?.walletAddress || existing.walletAddress || null,
    provider: 'x',
    providerUserId: xIdentity.providerUserId,
    username: xIdentity.username || null,
    targetHandle: config.targetHandle,
    targetUserId: result.targetUser?.id || existing.targetUserId || null,
    connectionStatus,
    status: verified ? 'verified' : 'not_following',
    verifiedAt: verified ? (existing.verifiedAt || checkedAt) : null,
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
  }
  writeState(config.path, state)
  return statusForSession(auth, session)
}

function saveVerificationFailure(auth, session, status, error) {
  const config = auth.xFollowGateConfig
  const xIdentity = getSessionXIdentity(auth, session)
  const subject = verificationSubject(session)
  if (!xIdentity?.providerUserId || !subject) return

  const checkedAt = nowIso()
  const state = readState(config.path)
  const key = sessionVerificationKeys(session, config.targetHandle)[0]
  if (!key) return
  const existing = state.verifications[key] || {}
  state.verifications[key] = {
    ...existing,
    subjectType: subject.type,
    walletAddress: subject.walletAddress || existing.walletAddress || null,
    provider: 'x',
    providerUserId: xIdentity.providerUserId,
    username: xIdentity.username || null,
    targetHandle: config.targetHandle,
    status,
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
    lastError: error instanceof Error ? error.message : String(error || ''),
  }
  writeState(config.path, state)
}

export function createXFollowGateConfig({ authDir, env = process.env }) {
  const targetHandle = normalizeHandle(env.X_FOLLOW_GATE_HANDLE || env.X_REQUIRED_FOLLOW_HANDLE || DEFAULT_TARGET_HANDLE)
  const retrySeconds = Math.max(10, Math.floor(Number(env.X_FOLLOW_VERIFY_RETRY_SECONDS || DEFAULT_RETRY_SECONDS) || DEFAULT_RETRY_SECONDS))

  return {
    path: join(authDir, 'x-follow-verifications.json'),
    targetHandle,
    targetUrl: `https://x.com/${targetHandle}`,
    retrySeconds,
    required: envEnabled(env.X_FOLLOW_GATE_REQUIRED ?? env.X_FOLLOW_REQUIRED, true),
    skipEnabled: envFlag(env.X_FOLLOW_SKIP_ENABLED || env.X_FOLLOW_GATE_SKIP_ENABLED),
    skipCookieName: SKIP_COOKIE,
    sessionSecret: String(env.AUTH_SESSION_SECRET || env.SESSION_SECRET || ''),
    secureCookies: (env.AUTH_COOKIE_SECURE || '').trim()
      ? env.AUTH_COOKIE_SECURE !== '0'
      : String(env.PUBLIC_APP_ORIGIN || env.AUTH_PUBLIC_ORIGIN || '').startsWith('https://'),
    apiBaseUrl: String(env.X_API_BASE_URL || 'https://api.x.com/2').replace(/\/$/, ''),
  }
}

export function getXFollowStatus(auth, session, request) {
  return statusForSession(auth, session, request)
}

export function clearXFollowSkipCookie(auth) {
  return clearSkipCookie(auth.xFollowGateConfig)
}

export function skipXFollow(auth, session, request) {
  const config = auth.xFollowGateConfig
  const status = statusForSession(auth, session, request)
  if (!config.skipEnabled) {
    throw Object.assign(new Error('X follow test bypass is disabled.'), {
      statusCode: 404,
      code: 'skip_disabled',
      status,
    })
  }
  if (!hasSigningSecret(config)) {
    throw Object.assign(new Error('AUTH_SESSION_SECRET must be configured before test bypass can be used.'), {
      statusCode: 503,
      code: 'session_secret_missing',
      status,
    })
  }

  const checkedAt = nowIso()
  const state = readState(config.path)
  const cookieToken = readSkipCookieToken(config, request) || randomBytes(32).toString('base64url')
  const cookieKey = skipCookieRecordKey(config, cookieToken)
  const cookieExisting = state.verifications[cookieKey] || {}

  state.verifications[cookieKey] = {
    ...cookieExisting,
    provider: 'test-skip-cookie',
    targetHandle: config.targetHandle,
    status: 'skipped',
    bypassedAt: cookieExisting.bypassedAt || checkedAt,
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
  }

  const identity = session?.identity || null
  const subject = verificationSubject(session)
  const sessionKey = sessionVerificationKeys(session, config.targetHandle)[0]
  if (sessionKey && subject && identity?.provider && identity?.providerUserId) {
    const existing = state.verifications[sessionKey] || {}
    state.verifications[sessionKey] = {
      ...existing,
      subjectType: subject.type,
      walletAddress: subject.walletAddress || existing.walletAddress || null,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      username: identity.username || null,
      targetHandle: config.targetHandle,
      status: 'skipped',
      bypassedAt: existing.bypassedAt || checkedAt,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
    }
  }

  writeState(config.path, state)

  const nextStatus = session
    ? statusForSession(auth, session, request)
    : {
      target: {
        handle: config.targetHandle,
        url: config.targetUrl,
      },
      authenticated: false,
      xConnected: false,
      verified: false,
      gatePassed: true,
      bypassed: true,
      skipEnabled: true,
      status: 'skipped',
      verifiedAt: null,
      bypassedAt: cookieExisting.bypassedAt || checkedAt,
      lastCheckedAt: checkedAt,
      retryAfterSeconds: 0,
      connectionStatus: [],
    }

  return {
    status: nextStatus,
    cookie: createSkipCookie(config, cookieToken),
  }
}

export async function verifyXFollow(auth, session, request) {
  const status = statusForSession(auth, session, request)
  if (!session) {
    throw Object.assign(new Error('X login is required before verification.'), {
      statusCode: 401,
      code: 'login_required',
      status,
    })
  }
  if (status.gatePassed) return status
  if (['wallet_required', 'profile_store_missing', 'renaiss_twitter_required', 'twitter_identity_missing', 'twitter_identity_mismatch'].includes(status.status)) {
    throw Object.assign(new Error('X identity does not match the Renaiss Twitter account for this wallet.'), {
      statusCode: status.status === 'profile_store_missing' ? 503 : 403,
      code: status.status,
      status,
    })
  }
  if (!status.xConnected) {
    throw Object.assign(new Error('Connect X before verifying follow status.'), {
      statusCode: 403,
      code: 'x_login_required',
      status,
    })
  }
  if (status.retryAfterSeconds > 0) {
    throw Object.assign(new Error('Please wait before verifying again.'), {
      statusCode: 429,
      code: 'retry_later',
      retryAfterSeconds: status.retryAfterSeconds,
      status,
    })
  }

  const token = await readUsableXToken(auth, session)
  if (!token?.access_token) {
    throw Object.assign(new Error('Reconnect X to grant follow verification access.'), {
      statusCode: 409,
      code: 'x_token_missing',
      status,
    })
  }

  try {
    const result = await fetchConnectionStatus(auth, auth.xFollowGateConfig, session, token.access_token)
    return saveVerificationResult(auth, session, result)
  } catch (error) {
    const failureStatus = error?.statusCode === 429 ? 'rate_limited' : 'api_error'
    saveVerificationFailure(auth, session, failureStatus, error)
    throw Object.assign(error, {
      code: failureStatus,
      status: statusForSession(auth, session, request),
    })
  }
}
