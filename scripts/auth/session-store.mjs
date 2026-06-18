import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

import { parseCookies, serializeCookie } from './cookies.mjs'
import { pruneRecordMap, readJsonFile, writeJsonFileAtomic } from './json-store.mjs'

const SESSION_COOKIE = 'renaiss_soccer_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function hashToken(secret, token) {
  return createHmac('sha256', secret).update(String(token)).digest('hex')
}

function signValue(secret, value) {
  return createHmac('sha256', secret).update(String(value)).digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function sessionCookieValue(secret, token) {
  return `${token}.${signValue(secret, token)}`
}

function verifySessionCookie(secret, value) {
  const [token, signature] = String(value || '').split('.')
  if (!token || !signature) return ''
  return safeEqual(signature, signValue(secret, token)) ? token : ''
}

function emptySessionState() {
  return {
    version: 1,
    updatedAt: null,
    sessions: {},
  }
}

function readSessionState(path) {
  const state = readJsonFile(path, emptySessionState())
  return {
    ...emptySessionState(),
    ...state,
    sessions: pruneRecordMap(state.sessions),
  }
}

function writeSessionState(path, state) {
  const nextState = {
    ...state,
    version: 1,
    updatedAt: nowIso(),
    sessions: pruneRecordMap(state.sessions),
  }
  writeJsonFileAtomic(path, nextState)
  return nextState
}

export function createSessionConfig({ authDir, sessionSecret, secureCookies }) {
  return {
    cookieName: SESSION_COOKIE,
    path: join(authDir, 'sessions.json'),
    sessionSecret: String(sessionSecret || ''),
    secureCookies: Boolean(secureCookies),
  }
}

export function hasSessionSecret(config) {
  return Boolean(config?.sessionSecret && config.sessionSecret.length >= 32)
}

export function createSession(config, response, payload) {
  if (!hasSessionSecret(config)) {
    throw Object.assign(new Error('AUTH_SESSION_SECRET must be configured before login can create sessions.'), {
      statusCode: 503,
    })
  }

  const token = randomBytes(32).toString('base64url')
  const id = hashToken(config.sessionSecret, token)
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const state = readSessionState(config.path)
  state.sessions[id] = {
    id,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    identity: payload.identity,
    walletAddress: payload.walletAddress || null,
    resolver: payload.resolver || null,
  }
  writeSessionState(config.path, state)

  response.setHeader('set-cookie', serializeCookie(config.cookieName, sessionCookieValue(config.sessionSecret, token), {
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
  }))

  return state.sessions[id]
}

export function readSession(config, request) {
  if (!hasSessionSecret(config)) return null
  const cookies = parseCookies(request.headers.cookie || '')
  const token = verifySessionCookie(config.sessionSecret, cookies[config.cookieName])
  if (!token) return null

  const id = hashToken(config.sessionSecret, token)
  const state = readSessionState(config.path)
  const session = state.sessions[id] || null
  if (!session) return null

  const expiresAt = Date.parse(session.expiresAt || '')
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    delete state.sessions[id]
    writeSessionState(config.path, state)
    return null
  }

  return session
}

export function clearSession(config, request, response) {
  if (hasSessionSecret(config)) {
    const cookies = parseCookies(request.headers.cookie || '')
    const token = verifySessionCookie(config.sessionSecret, cookies[config.cookieName])
    if (token) {
      const state = readSessionState(config.path)
      delete state.sessions[hashToken(config.sessionSecret, token)]
      writeSessionState(config.path, state)
    }
  }

  response.setHeader('set-cookie', serializeCookie(config.cookieName, '', {
    maxAge: 0,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
  }))
}
