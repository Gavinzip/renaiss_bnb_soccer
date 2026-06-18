import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

import { pruneRecordMap, readJsonFile, writeJsonFileAtomic } from './json-store.mjs'

const OAUTH_TTL_MS = 10 * 60 * 1000
const WALLET_TTL_MS = 10 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_RESEND_COOLDOWN_MS = 60 * 1000
const OTP_MAX_ATTEMPTS = 5

function nowIso() {
  return new Date().toISOString()
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(String(value)).digest('hex')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function emptyAuthState() {
  return {
    version: 1,
    updatedAt: null,
    oauth: {},
    wallet: {},
    emailOtp: {},
  }
}

function readAuthState(path) {
  const state = readJsonFile(path, emptyAuthState())
  return {
    ...emptyAuthState(),
    ...state,
    oauth: pruneRecordMap(state.oauth),
    wallet: pruneRecordMap(state.wallet),
    emailOtp: pruneRecordMap(state.emailOtp),
  }
}

function writeAuthState(path, state) {
  const nextState = {
    ...state,
    version: 1,
    updatedAt: nowIso(),
    oauth: pruneRecordMap(state.oauth),
    wallet: pruneRecordMap(state.wallet),
    emailOtp: pruneRecordMap(state.emailOtp),
  }
  writeJsonFileAtomic(path, nextState)
  return nextState
}

export function createAuthStateConfig({ authDir, sessionSecret }) {
  return {
    path: join(authDir, 'auth-state.json'),
    sessionSecret: String(sessionSecret || ''),
  }
}

export function createOauthChallenge(config, provider, payload) {
  const stateToken = randomToken(32)
  const state = readAuthState(config.path)
  state.oauth[stateToken] = {
    provider,
    ...payload,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + OAUTH_TTL_MS).toISOString(),
  }
  writeAuthState(config.path, state)
  return stateToken
}

export function consumeOauthChallenge(config, provider, stateToken) {
  const state = readAuthState(config.path)
  const challenge = state.oauth[stateToken]
  if (!challenge || challenge.provider !== provider) return null
  delete state.oauth[stateToken]
  writeAuthState(config.path, state)
  return challenge
}

export function createWalletChallenge(config, address, payload) {
  const nonce = randomToken(18).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
  const expiresAt = payload?.expiresAt || new Date(Date.now() + WALLET_TTL_MS).toISOString()
  const state = readAuthState(config.path)
  state.wallet[nonce] = {
    address: String(address || '').toLowerCase(),
    ...payload,
    nonce,
    createdAt: nowIso(),
    expiresAt,
  }
  writeAuthState(config.path, state)
  return state.wallet[nonce]
}

export function consumeWalletChallenge(config, nonce) {
  const state = readAuthState(config.path)
  const challenge = state.wallet[nonce]
  if (!challenge) return null
  delete state.wallet[nonce]
  writeAuthState(config.path, state)
  return challenge
}

export function createEmailOtpChallenge(config, email) {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw Object.assign(new Error('AUTH_SESSION_SECRET must be configured before email OTP can be used.'), {
      statusCode: 503,
    })
  }

  const normalizedEmail = String(email || '').trim().toLowerCase()
  const key = hmac(config.sessionSecret, normalizedEmail)
  const state = readAuthState(config.path)
  const existing = state.emailOtp[key]
  const existingCreatedAt = Date.parse(existing?.createdAt || '')
  if (Number.isFinite(existingCreatedAt) && Date.now() - existingCreatedAt < OTP_RESEND_COOLDOWN_MS) {
    throw Object.assign(new Error('Please wait before requesting another OTP.'), {
      statusCode: 429,
      retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existingCreatedAt)) / 1000),
    })
  }

  const code = String(randomInt(100000, 1000000))
  const createdAt = nowIso()
  state.emailOtp[key] = {
    email: normalizedEmail,
    codeHash: hmac(config.sessionSecret, `${normalizedEmail}:${code}`),
    attempts: 0,
    createdAt,
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  }
  writeAuthState(config.path, state)
  return {
    email: normalizedEmail,
    code,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
  }
}

export function consumeEmailOtpChallenge(config, email, code) {
  if (!config.sessionSecret || config.sessionSecret.length < 32) return { ok: false, reason: 'session-secret-missing' }

  const normalizedEmail = String(email || '').trim().toLowerCase()
  const key = hmac(config.sessionSecret, normalizedEmail)
  const state = readAuthState(config.path)
  const challenge = state.emailOtp[key]
  if (!challenge) return { ok: false, reason: 'not-found' }

  const attempts = Number(challenge.attempts || 0)
  if (attempts >= OTP_MAX_ATTEMPTS) {
    delete state.emailOtp[key]
    writeAuthState(config.path, state)
    return { ok: false, reason: 'too-many-attempts' }
  }

  const expectedHash = challenge.codeHash
  const actualHash = hmac(config.sessionSecret, `${normalizedEmail}:${String(code || '').trim()}`)
  if (!safeEqual(expectedHash, actualHash)) {
    state.emailOtp[key] = { ...challenge, attempts: attempts + 1 }
    writeAuthState(config.path, state)
    return { ok: false, reason: 'invalid-code' }
  }

  delete state.emailOtp[key]
  writeAuthState(config.path, state)
  return { ok: true, email: normalizedEmail }
}
