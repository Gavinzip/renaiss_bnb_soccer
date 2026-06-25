import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

const GEO_HEADER_SOURCES = [
  {
    source: 'vercel',
    country: 'x-vercel-ip-country',
    region: 'x-vercel-ip-country-region',
    city: 'x-vercel-ip-city',
    timezone: 'x-vercel-ip-timezone',
  },
  {
    source: 'cloudflare',
    country: 'cf-ipcountry',
    region: 'cf-region',
    city: 'cf-ipcity',
    timezone: 'cf-timezone',
  },
  {
    source: 'generic',
    country: 'x-country-code',
    region: 'x-region-code',
    city: 'x-city',
    timezone: 'x-timezone',
  },
]

function cleanText(value, maxLength = 160) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanHeaderValue(value) {
  if (Array.isArray(value)) return cleanText(value[0])
  return cleanText(value)
}

function decodeHeaderText(value) {
  const text = cleanHeaderValue(value)
  if (!text) return null
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    return text
  }
}

function normalizeIp(value) {
  let text = String(value || '').trim()
  if (!text) return ''
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  if (text.startsWith('[')) text = text.slice(1, text.indexOf(']') >= 0 ? text.indexOf(']') : undefined)
  if (/^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/i.test(text)) text = text.slice(7)
  if (text.includes(':') && !text.includes('::') && text.split(':').length === 2) text = text.split(':')[0]
  return isIP(text) ? text : ''
}

function ipCandidatesFromRequest(request) {
  const headers = request?.headers || {}
  const candidates = []
  for (const name of ['cf-connecting-ip', 'x-real-ip', 'x-client-ip']) {
    const value = cleanHeaderValue(headers[name])
    if (value) candidates.push(value)
  }
  const forwardedFor = cleanHeaderValue(headers['x-forwarded-for'])
  if (forwardedFor) {
    candidates.push(...forwardedFor.split(',').map((part) => part.trim()).filter(Boolean))
  }
  return candidates.map(normalizeIp).filter(Boolean)
}

function ipv4Parts(ip) {
  return ip.split('.').map((part) => Number(part))
}

function isPrivateIp(ip) {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b] = ipv4Parts(ip)
    return (
      a === 10
      || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127)
      || a === 0
    )
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')
  }
  return false
}

function ipPrefix(ip) {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b, c] = ip.split('.')
    return `${a}.${b}.${c}.0/24`
  }
  if (version === 6) {
    const expanded = ip.toLowerCase().split(':').filter(Boolean)
    return `${expanded.slice(0, 3).join(':')}::/48`
  }
  return null
}

function hashValue(value, secret) {
  const text = String(value || '').trim()
  if (!text) return null
  return createHash('sha256').update(`${secret || 'renaiss-login-audit'}:${text}`).digest('hex')
}

export function clientIpFromRequest(request) {
  const candidates = ipCandidatesFromRequest(request)
  return candidates.find((ip) => !isPrivateIp(ip)) || candidates[0] || ''
}

export function geoFromRequestHeaders(request) {
  const headers = request?.headers || {}
  for (const source of GEO_HEADER_SOURCES) {
    const country = cleanHeaderValue(headers[source.country])
    const region = cleanHeaderValue(headers[source.region])
    const city = decodeHeaderText(headers[source.city])
    const timezone = cleanHeaderValue(headers[source.timezone])
    if (country || region || city || timezone) {
      return {
        source: source.source,
        country,
        region,
        city,
        timezone,
      }
    }
  }
  return {
    source: 'none',
    country: null,
    region: null,
    city: null,
    timezone: null,
  }
}

export function buildLoginAudit({ session, identity, request, env = process.env } = {}) {
  const ip = clientIpFromRequest(request)
  const ipVersion = isIP(ip) || null
  const privateIp = ip ? isPrivateIp(ip) : false
  const geo = geoFromRequestHeaders(request)
  const secret = env.LOGIN_AUDIT_HASH_SECRET || env.AUTH_SESSION_SECRET || env.SESSION_SECRET || ''
  const requestUrl = new URL(request?.url || '/', 'http://localhost')
  const headers = request?.headers || {}
  const host = cleanHeaderValue(headers['x-forwarded-host']) || cleanHeaderValue(headers.host)
  const referrer = cleanHeaderValue(headers.referer || headers.referrer)
  let referrerOrigin = null
  try {
    referrerOrigin = referrer ? new URL(referrer).origin : null
  } catch {
    referrerOrigin = null
  }

  return {
    walletAddress: session?.walletAddress || identity?.walletAddress || identity?.safeWalletAddress || null,
    provider: identity?.provider || null,
    providerUserId: identity?.providerUserId || null,
    twitterUsername: identity?.twitterUsername || identity?.username || null,
    ipHash: hashValue(ip, secret),
    ipPrefix: ip && !privateIp ? ipPrefix(ip) : privateIp ? 'private' : null,
    ipVersion,
    ipIsPrivate: privateIp ? 1 : 0,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    timezone: geo.timezone,
    geoSource: geo.source,
    userAgentHash: hashValue(cleanHeaderValue(headers['user-agent']), secret),
    referrerOrigin,
    requestHost: host,
    requestPathname: requestUrl.pathname,
  }
}
