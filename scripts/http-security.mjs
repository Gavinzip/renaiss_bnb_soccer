import { timingSafeEqual } from 'node:crypto'

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim()
}

export function requestOrigin(request) {
  const proto = firstHeaderValue(request.headers['x-forwarded-proto'])
    || (request.socket?.encrypted ? 'https' : 'http')
  const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host)
  return host ? `${proto}://${host}` : ''
}

export function normalizeOrigin(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).origin
  } catch {
    return ''
  }
}

export function allowedOriginsForRequest(request, env = process.env) {
  const origins = new Set()
  for (const value of [
    env.PUBLIC_APP_ORIGIN,
    env.AUTH_PUBLIC_ORIGIN,
    requestOrigin(request),
  ]) {
    const origin = normalizeOrigin(value)
    if (origin) origins.add(origin)
  }
  return origins
}

export function isAllowedRequestOrigin(request, env = process.env, { allowMissing = true } = {}) {
  const origin = normalizeOrigin(request.headers.origin)
  if (!origin) return allowMissing
  return allowedOriginsForRequest(request, env).has(origin)
}

export function appendVary(left, right) {
  const values = new Set()
  for (const item of [left, right]) {
    String(item || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => values.add(value))
  }
  return Array.from(values).join(', ')
}

export function corsHeadersForRequest(request, env = process.env) {
  const origin = normalizeOrigin(request.headers.origin)
  if (!origin || !allowedOriginsForRequest(request, env).has(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function bearerTokenFromRequest(request) {
  const header = String(request.headers.authorization || '').trim()
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : ''
}

export function requestHasBearerToken(request, expectedToken) {
  const expected = String(expectedToken || '').trim()
  const token = bearerTokenFromRequest(request)
  return Boolean(expected && token && safeEqual(token, expected))
}
