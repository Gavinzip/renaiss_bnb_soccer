import { createRemoteJWKSet, jwtVerify } from 'jose'

const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i
const DEFAULT_SCOPE = 'openid profile email safe x'
const DEFAULT_ISSUER = 'https://feat-sso-oidc-provider.vercel.app/api/auth'
const DEFAULT_TIMEOUT_MS = 8000

const discoveryCache = new Map()

function normalizeAddress(value) {
  const address = String(value || '').trim()
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function normalizeIssuer(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function readEnvString(env, names, fallback = '') {
  for (const name of names) {
    const value = String(env[name] || '').trim()
    if (value) return value
  }
  return fallback
}

function normalizeTokenAuthMethod(value) {
  const method = String(value || '').trim().toLowerCase()
  if (method === 'client_secret_post' || method === 'post' || method === 'body') return 'post'
  return 'basic'
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function publicTokenError(payload, status) {
  return payload?.error_description
    || payload?.error
    || payload?.message
    || `Renaiss token endpoint returned HTTP ${status}.`
}

function publicUserinfoError(payload, status) {
  return payload?.error_description
    || payload?.error
    || payload?.message
    || `Renaiss userinfo endpoint returned HTTP ${status}.`
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function requireDiscoveryEndpoint(doc, field) {
  const value = String(doc?.[field] || '').trim()
  if (!value) throw new Error(`Renaiss OIDC discovery document is missing ${field}.`)
  return value
}

export function createRenaissProviderConfig(env = process.env) {
  const issuer = normalizeIssuer(readEnvString(env, ['RENAISS_ISSUER'], DEFAULT_ISSUER))
  return {
    provider: 'renaiss',
    oidc: true,
    issuer,
    clientId: readEnvString(env, ['RENAISS_CLIENT_ID']),
    clientSecret: readEnvString(env, ['RENAISS_CLIENT_SECRET']),
    redirectUri: readEnvString(env, ['RENAISS_REDIRECT_URI']),
    scope: readEnvString(env, ['RENAISS_SCOPE'], DEFAULT_SCOPE),
    authParams: {
      prompt: readEnvString(env, ['RENAISS_PROMPT'], 'consent'),
    },
    requiresClientSecret: true,
    requiresRedirectUri: true,
    tokenAuthMethod: normalizeTokenAuthMethod(readEnvString(env, ['RENAISS_TOKEN_AUTH_METHOD'], 'basic')),
    timeoutMs: Math.max(1000, Math.floor(Number(env.RENAISS_OIDC_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)),
  }
}

export async function getRenaissDiscovery(config) {
  const issuer = normalizeIssuer(config?.issuer)
  if (!issuer) throw new Error('RENAISS_ISSUER is not configured.')

  const cached = discoveryCache.get(issuer)
  if (cached) return cached

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`
  const response = await fetchWithTimeout(discoveryUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'renaiss-worldcup-auth/0.1.0',
    },
  }, config.timeoutMs)
  const body = await response.text()
  const doc = parseJson(body)
  if (!response.ok) {
    throw new Error(doc?.error_description || doc?.error || `Renaiss discovery failed with HTTP ${response.status}.`)
  }

  requireDiscoveryEndpoint(doc, 'issuer')
  requireDiscoveryEndpoint(doc, 'authorization_endpoint')
  requireDiscoveryEndpoint(doc, 'token_endpoint')
  requireDiscoveryEndpoint(doc, 'userinfo_endpoint')
  requireDiscoveryEndpoint(doc, 'jwks_uri')

  const discovered = {
    doc,
    jwks: createRemoteJWKSet(new URL(doc.jwks_uri)),
  }
  discoveryCache.set(issuer, discovered)
  return discovered
}

async function fetchRenaissUserinfo(config, doc, accessToken) {
  if (!accessToken) return { claims: {}, error: 'missing-access-token' }

  try {
    const response = await fetchWithTimeout(doc.userinfo_endpoint, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'renaiss-worldcup-auth/0.1.0',
      },
    }, config.timeoutMs)
    const body = await response.text()
    const payload = parseJson(body)
    if (!response.ok) return { claims: {}, error: publicUserinfoError(payload, response.status) }
    return { claims: payload, error: '' }
  } catch (error) {
    return {
      claims: {},
      error: error instanceof Error ? error.message : 'Renaiss userinfo request failed.',
    }
  }
}

function buildRenaissIdentity({ claims, userinfoError }) {
  const providerUserId = String(claims.sub || '').trim()
  const rawSafeWallet = claims.safe_wallet_address
  const safeWalletAddress = normalizeAddress(rawSafeWallet)
  const legacyWalletAddress = normalizeAddress(claims.legacy_wallet_address)
  const twitterUsername = claims.twitter_username == null ? null : String(claims.twitter_username || '').trim() || null
  const email = String(claims.email || '').trim().toLowerCase()
  const safeWalletClaimPresent = Object.prototype.hasOwnProperty.call(claims, 'safe_wallet_address')
  const safeWalletInvalid = safeWalletClaimPresent
    && rawSafeWallet !== null
    && String(rawSafeWallet || '').trim()
    && !safeWalletAddress

  return {
    provider: 'renaiss',
    providerUserId,
    issuer: String(claims.iss || '').trim() || null,
    email: email || null,
    emailVerified: Boolean(claims.email_verified),
    name: claims.name || null,
    picture: claims.picture || null,
    safeWalletAddress: safeWalletAddress || null,
    safeWalletReady: rawSafeWallet !== null && Boolean(safeWalletAddress),
    safeWalletClaimPresent,
    safeWalletInvalid: Boolean(safeWalletInvalid),
    legacyWalletAddress: legacyWalletAddress || null,
    chainId: claims.chain_id == null ? null : String(claims.chain_id),
    twitterUsername,
    userinfoError: userinfoError || null,
  }
}

export async function exchangeRenaissOidcCode(config, { code, codeVerifier, redirectUri, nonce }) {
  const { doc, jwks } = await getRenaissDiscovery(config)
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  })
  const tokenHeaders = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
    'user-agent': 'renaiss-worldcup-auth/0.1.0',
  }
  if (config.tokenAuthMethod === 'basic' && config.clientSecret) {
    tokenHeaders.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
  } else {
    tokenBody.set('client_id', config.clientId)
    if (config.clientSecret) tokenBody.set('client_secret', config.clientSecret)
  }

  const tokenResponse = await fetchWithTimeout(doc.token_endpoint, {
    method: 'POST',
    headers: tokenHeaders,
    body: tokenBody.toString(),
  }, config.timeoutMs)

  const tokenText = await tokenResponse.text()
  const token = parseJson(tokenText)
  if (!tokenResponse.ok) throw new Error(publicTokenError(token, tokenResponse.status))
  if (!token.id_token) throw new Error('Renaiss token response did not include an id_token.')

  const { payload } = await jwtVerify(token.id_token, jwks, {
    issuer: doc.issuer,
    audience: config.clientId,
  })
  if (nonce && payload.nonce !== nonce) throw new Error('Renaiss id_token nonce mismatch.')

  const userinfo = await fetchRenaissUserinfo(config, doc, token.access_token)
  const claims = {
    ...payload,
    ...userinfo.claims,
  }
  const identity = buildRenaissIdentity({ claims, userinfoError: userinfo.error })
  if (!identity.providerUserId) throw new Error('Renaiss identity is missing sub.')

  return {
    token,
    claims,
    identity,
    discoveryIssuer: doc.issuer,
  }
}
