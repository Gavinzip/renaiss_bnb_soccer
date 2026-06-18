export function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex <= 0) return cookies
      const name = entry.slice(0, separatorIndex).trim()
      const value = entry.slice(separatorIndex + 1).trim()
      if (!name) return cookies
      try {
        cookies[name] = decodeURIComponent(value)
      } catch {
        cookies[name] = value
      }
      return cookies
    }, {})
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`)
  if (options.domain) segments.push(`Domain=${options.domain}`)
  segments.push(`Path=${options.path || '/'}`)
  if (options.httpOnly !== false) segments.push('HttpOnly')
  if (options.secure) segments.push('Secure')
  segments.push(`SameSite=${options.sameSite || 'Lax'}`)
  return segments.join('; ')
}

export function appendSetCookie(headers, cookie) {
  if (!cookie) return headers
  const current = headers['set-cookie']
  if (!current) return { ...headers, 'set-cookie': cookie }
  if (Array.isArray(current)) return { ...headers, 'set-cookie': [...current, cookie] }
  return { ...headers, 'set-cookie': [current, cookie] }
}
