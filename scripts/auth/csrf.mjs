import { createHmac, timingSafeEqual } from 'node:crypto'

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function csrfTokenForSession(sessionConfig, session) {
  const secret = String(sessionConfig?.sessionSecret || '')
  const sessionId = String(session?.id || '')
  if (!secret || secret.length < 32 || !sessionId) return ''
  return createHmac('sha256', secret).update(`csrf:v1:${sessionId}`).digest('base64url')
}

export function readCsrfToken(request) {
  return String(
    request.headers['x-csrf-token']
      || request.headers['x-xsrf-token']
      || '',
  ).trim()
}

export function verifyCsrfRequest(sessionConfig, session, request) {
  const expected = csrfTokenForSession(sessionConfig, session)
  const actual = readCsrfToken(request)
  return Boolean(expected && actual && safeEqual(actual, expected))
}
