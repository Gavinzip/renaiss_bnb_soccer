import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { readJsonFile, writeJsonFileAtomic } from './json-store.mjs'

function nowIso() {
  return new Date().toISOString()
}

function emptyTokenState() {
  return {
    version: 1,
    updatedAt: null,
    tokens: {},
  }
}

function tokenKey(sessionId, provider) {
  return `${provider}:${sessionId}`
}

function sanitizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null
  const provider = String(identity.provider || '').trim()
  const providerUserId = String(identity.providerUserId || '').trim()
  if (!provider || !providerUserId) return null

  return {
    provider,
    providerUserId,
    username: identity.username || null,
    email: identity.email || null,
    name: identity.name || identity.globalName || null,
    picture: identity.picture || null,
  }
}

function encryptionKey(secret) {
  return createHash('sha256').update(String(secret || '')).digest()
}

function encryptPayload(secret, payload) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    value: encrypted.toString('base64url'),
  }
}

function decryptPayload(secret, encryptedPayload) {
  const iv = Buffer.from(String(encryptedPayload?.iv || ''), 'base64url')
  const tag = Buffer.from(String(encryptedPayload?.tag || ''), 'base64url')
  const encrypted = Buffer.from(String(encryptedPayload?.value || ''), 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

function readTokenState(path) {
  const state = readJsonFile(path, emptyTokenState())
  return {
    ...emptyTokenState(),
    ...state,
    tokens: Object.fromEntries(
      Object.entries(state.tokens || {}).filter(([, record]) => (
        record && typeof record === 'object'
      )),
    ),
  }
}

function writeTokenState(path, state) {
  writeJsonFileAtomic(path, {
    ...state,
    version: 1,
    updatedAt: nowIso(),
  })
}

export function createOAuthTokenConfig({ authDir, sessionSecret }) {
  return {
    path: join(authDir, 'oauth-tokens.json'),
    sessionSecret: String(sessionSecret || ''),
  }
}

export function saveOAuthToken(config, session, provider, tokenPayload, options = {}) {
  if (!session?.id || !provider || !tokenPayload?.access_token) return null

  const state = readTokenState(config.path)
  const createdAt = nowIso()
  const existing = state.tokens[tokenKey(session.id, provider)] || {}
  const expiresIn = Math.max(0, Math.floor(Number(tokenPayload.expires_in || 0)))
  const accessTokenExpiresAt = expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null
  const identity = sanitizeIdentity(options.identity) || existing.identity || null

  const record = {
    ...existing,
    sessionId: session.id,
    provider,
    createdAt: existing.createdAt || createdAt,
    updatedAt: createdAt,
    expiresAt: session.expiresAt,
    accessTokenExpiresAt,
    scope: tokenPayload.scope || null,
    tokenType: tokenPayload.token_type || 'bearer',
    identity,
    encrypted: encryptPayload(config.sessionSecret, {
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token || null,
      expires_in: tokenPayload.expires_in || null,
      scope: tokenPayload.scope || null,
      token_type: tokenPayload.token_type || null,
    }),
  }

  state.tokens[tokenKey(session.id, provider)] = record
  writeTokenState(config.path, state)
  return record
}

export function readOAuthToken(config, session, provider) {
  if (!session?.id || !provider) return null
  const state = readTokenState(config.path)
  const record = state.tokens[tokenKey(session.id, provider)] || null
  if (!record) return null

  const expiresAt = Date.parse(record.expiresAt || '')
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    delete state.tokens[tokenKey(session.id, provider)]
    writeTokenState(config.path, state)
    return null
  }

  try {
    return {
      ...decryptPayload(config.sessionSecret, record.encrypted),
      accessTokenExpiresAt: record.accessTokenExpiresAt || null,
      scope: record.scope || null,
      tokenType: record.tokenType || 'bearer',
      identity: record.identity || null,
    }
  } catch {
    return null
  }
}

export function clearOAuthTokensForSession(config, sessionId) {
  if (!sessionId) return
  const state = readTokenState(config.path)
  let changed = false

  for (const [key, record] of Object.entries(state.tokens)) {
    if (record?.sessionId === sessionId) {
      delete state.tokens[key]
      changed = true
    }
  }

  if (changed) writeTokenState(config.path, state)
}
