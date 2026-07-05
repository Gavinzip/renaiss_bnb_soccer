import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { getAddress } from 'ethers'
import { SiweMessage } from 'siwe'

import {
  consumeEmailOtpChallenge,
  consumeOauthChallenge,
  consumeWalletChallenge,
  createAuthStateConfig,
  createEmailOtpChallenge,
  createOauthChallenge,
  createWalletChallenge,
} from './auth-state.mjs'
import { appendSetCookie, parseCookies, serializeCookie } from './cookies.mjs'
import { csrfTokenForSession } from './csrf.mjs'
import { createEmailConfig, emailSenderConfigured, sendOtpEmail } from './email-sender.mjs'
import {
  createIdentityResolverConfig,
  identityResolverConfigured,
  resolveIdentityToWallet,
} from './identity-resolver.mjs'
import {
  clearSession,
  createSession,
  createSessionConfig,
  hasSessionSecret,
  readSession,
} from './session-store.mjs'
import {
  clearOAuthTokensForSession,
  createOAuthTokenConfig,
  saveOAuthToken,
} from './oauth-token-store.mjs'
import { buildLoginAudit } from './request-audit.mjs'
import {
  createRenaissProviderConfig,
  exchangeRenaissOidcCode,
  getRenaissDiscovery,
} from './renaiss-oidc.mjs'
import {
  clearXFollowSkipCookie,
  createXFollowGateConfig,
  getXFollowVerificationStats,
  getXFollowStatus,
  skipXFollow,
  verifyXFollow,
} from './x-follow-gate.mjs'
import {
  createXAccountEligibilityConfig,
  getXAccountEligibilityStats,
  getXAccountEligibilityStatus,
  verifyXAccountEligibility,
} from './x-account-eligibility.mjs'

const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AUTH_STATE_COOKIE_PREFIX = 'renaiss_auth_state_'
const OAUTH_PROVIDER_IDS = ['google', 'x', 'discord', 'renaiss']
// Renaiss discovery advertises select_account, but authorize currently rejects it.
const RENAISS_PROMPT_VALUES = new Set(['login', 'consent', 'create', 'none'])

function normalizeAddress(value) {
  const address = String(value || '').trim()
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function checksumAddress(value) {
  try {
    return getAddress(value)
  } catch {
    return ''
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : ''
}

function readRenaissPromptOverride(url, provider) {
  if (provider !== 'renaiss') return ''
  const prompt = String(url.searchParams.get('prompt') || '').trim()
  return RENAISS_PROMPT_VALUES.has(prompt) ? prompt : ''
}

function readRenaissMaxAgeOverride(url, provider) {
  if (provider !== 'renaiss') return ''
  const maxAge = String(url.searchParams.get('max_age') || '').trim()
  return /^\d+$/.test(maxAge) ? maxAge : ''
}

function createPkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function getRequestOrigin(request) {
  const proto = request.headers['x-forwarded-proto'] || (request.socket?.encrypted ? 'https' : 'http')
  const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost'
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`
}

function createRedirectUri(provider, request, env) {
  const upper = provider.toUpperCase()
  const explicit = env[`${upper}_REDIRECT_URI`] || env[`AUTH_${upper}_REDIRECT_URI`]
  if (explicit) return explicit
  const origin = env.PUBLIC_APP_ORIGIN || env.AUTH_PUBLIC_ORIGIN || getRequestOrigin(request)
  if (provider === 'renaiss') return `${origin}/auth/callback`
  return `${origin}/api/auth/${provider}/callback`
}

function authSuccessRedirect(env) {
  return env.AUTH_SUCCESS_REDIRECT_PATH || '/?auth=success'
}

function authErrorRedirect(env, reason, details = {}) {
  const base = env.AUTH_ERROR_REDIRECT_PATH || '/?auth=error'
  const url = new URL(base, 'http://localhost')
  if (reason) url.searchParams.set('reason', reason)
  for (const [key, value] of Object.entries(details)) {
    if (value) url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function authErrorRedirectForChallenge(env, challenge, reason, details = {}) {
  const returnTo = safeReturnTo(challenge?.returnTo)
  if (!returnTo) return authErrorRedirect(env, reason, details)

  const url = new URL(returnTo, 'http://localhost')
  url.searchParams.set('auth', 'error')
  if (reason) url.searchParams.set('reason', reason)
  for (const [key, value] of Object.entries(details)) {
    if (value) url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function safeReturnTo(value) {
  const raw = String(value || '').trim()
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return ''
  try {
    const parsed = new URL(raw, 'https://renaiss.local')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ''
  }
}

function sanitizeAuthError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown OAuth failure')
  return message
    .replace(/[A-Za-z0-9_-]{48,}/g, '[redacted]')
    .slice(0, 240)
}

function logOAuthCallbackFailure(provider, stage, error) {
  console.warn('[auth] oauth callback failed', {
    provider,
    stage,
    message: sanitizeAuthError(error),
  })
}

function maskWalletAddress(value) {
  const address = normalizeAddress(value)
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null
}

function logXFollowVerifyFailure(session, error) {
  const xUserId = error?.status?.xUserId
    || (session?.identity?.provider === 'x' ? session.identity.providerUserId : null)

  console.warn('[x-follow] verify failed', {
    code: error?.code || 'verify_failed',
    httpStatus: Number(error?.statusCode || 500),
    xStatus: error?.xStatus || null,
    retryAfterSeconds: error?.retryAfterSeconds || error?.status?.retryAfterSeconds || 0,
    status: error?.status?.status || null,
    walletAddress: maskWalletAddress(session?.walletAddress),
    xUserId,
    rateLimit: error?.rateLimit || null,
    message: sanitizeAuthError(error),
  })
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { location, ...headers })
  response.end()
}

function sendJsonResponse(sendJson, request, response, status, payload, headers = {}) {
  sendJson(request, response, status, payload, {
    'cache-control': 'no-store',
    ...headers,
  })
}

function readEnvString(env, names) {
  for (const name of names) {
    const value = String(env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function envEnabled(value, defaultValue = true) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return defaultValue
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  return defaultValue
}

function legacyLoginEnabled(env) {
  return envEnabled(env.AUTH_LEGACY_LOGIN_ENABLED || env.AUTH_EXTRA_LOGIN_PROVIDERS_ENABLED, false)
}

function buildProviderConfig(env) {
  return {
    google: {
      clientId: readEnvString(env, ['GOOGLE_CLIENT_ID']),
      clientSecret: readEnvString(env, ['GOOGLE_CLIENT_SECRET']),
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
      authParams: {
        prompt: 'select_account',
      },
      requiresClientSecret: true,
      tokenAuthMethod: 'body',
    },
    x: {
      clientId: readEnvString(env, ['X_CLIENT_ID', 'TWITTER_CLIENT_ID']),
      clientSecret: readEnvString(env, ['X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET']),
      authUrl: 'https://x.com/i/oauth2/authorize',
      tokenUrl: 'https://api.x.com/2/oauth2/token',
      userInfoUrl: 'https://api.x.com/2/users/me?user.fields=profile_image_url,verified',
      scope: String(env.X_OAUTH_SCOPE || 'users.read follows.read offline.access').trim(),
      requiresClientSecret: true,
      tokenAuthMethod: 'basic',
    },
    discord: {
      clientId: readEnvString(env, ['DISCORD_CLIENT_ID']),
      clientSecret: readEnvString(env, ['DISCORD_CLIENT_SECRET']),
      authUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      userInfoUrl: 'https://discord.com/api/users/@me',
      scope: String(env.DISCORD_OAUTH_SCOPE || 'identify email').trim(),
      authParams: {
        prompt: String(env.DISCORD_OAUTH_PROMPT || 'consent').trim(),
      },
      requiresClientSecret: true,
      tokenAuthMethod: 'body',
    },
    renaiss: createRenaissProviderConfig(env),
  }
}

function providerConfigured(providerConfig, provider) {
  const config = providerConfig[provider]
  return Boolean(
    config?.clientId
    && (!config.requiresClientSecret || config.clientSecret)
    && (!config.requiresRedirectUri || config.redirectUri || config.oidc),
  )
}

function parseOAuthRoute(pathname) {
  const match = /^\/api\/auth\/([^/]+)\/(start|callback)$/.exec(pathname)
  if (!match) return null
  const provider = match[1]
  if (!OAUTH_PROVIDER_IDS.includes(provider)) return null
  return { provider, action: match[2] }
}

function oauthStateCookieName(provider) {
  return `${AUTH_STATE_COOKIE_PREFIX}${provider}`
}

function stateCookie(provider, value, secureCookies, maxAge = 600) {
  return serializeCookie(oauthStateCookieName(provider), value, {
    maxAge,
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'Lax',
  })
}

async function exchangeOAuthCode(provider, providerConfig, { code, codeVerifier, redirectUri }) {
  const config = providerConfig[provider]
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
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
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `OAuth token exchange failed with HTTP ${response.status}.`)
  return payload
}

async function fetchOAuthIdentity(provider, providerConfig, accessToken) {
  const config = providerConfig[provider]
  const response = await fetch(config.userInfoUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `OAuth userinfo failed with HTTP ${response.status}.`)

  if (provider === 'google') {
    return {
      provider: 'google',
      providerUserId: String(payload.sub || ''),
      email: String(payload.email || '').toLowerCase() || null,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name || null,
      picture: payload.picture || null,
    }
  }

  if (provider === 'discord') {
    return {
      provider: 'discord',
      providerUserId: String(payload.id || ''),
      username: payload.username || null,
      globalName: payload.global_name || null,
      discriminator: payload.discriminator || null,
      email: String(payload.email || '').toLowerCase() || null,
      emailVerified: Boolean(payload.verified),
      picture: payload.avatar ? `https://cdn.discordapp.com/avatars/${payload.id}/${payload.avatar}.png` : null,
    }
  }

  const user = payload.data || payload
  return {
    provider: 'x',
    providerUserId: String(user.id || ''),
    username: user.username || null,
    name: user.name || null,
    picture: user.profile_image_url || null,
    verified: Boolean(user.verified),
  }
}

function buildWalletMessage({ domain, origin, address, chainId, nonce, issuedAt, expiresAt }) {
  const checksummedAddress = checksumAddress(address)
  if (!checksummedAddress) throw Object.assign(new Error('Wallet address is invalid.'), { statusCode: 400 })

  return new SiweMessage({
    domain,
    address: checksummedAddress,
    statement: 'Sign in to Renaiss World Cup.',
    uri: origin,
    version: '1',
    chainId: Number(chainId),
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  }).prepareMessage()
}

function parseWalletMessage(message) {
  try {
    const parsed = new SiweMessage(String(message || ''))
    return {
      address: normalizeAddress(parsed.address),
      domain: String(parsed.domain || ''),
      nonce: String(parsed.nonce || ''),
      chainId: String(parsed.chainId || ''),
      expirationTime: String(parsed.expirationTime || ''),
    }
  } catch {
    return { address: '', domain: '', nonce: '', chainId: '', expirationTime: '' }
  }
}

async function createSessionForIdentity({ auth, request, response, identity }) {
  const resolver = await resolveIdentityToWallet(auth.identityResolverConfig, identity)
  const session = createSession(auth.sessionConfig, response, {
    identity,
    walletAddress: resolver.walletAddress,
    resolver,
  })
  return { session, resolver }
}

function enqueueLoginProfileWrite(auth, session, identity, request) {
  if (!auth.userProfileStore?.enqueueLoginProfile) return
  try {
    auth.userProfileStore.enqueueLoginProfile({
      session,
      identity,
      audit: buildLoginAudit({ session, identity, request, env: auth.env }),
    })
  } catch (error) {
    console.warn('[auth] profile queue failed', {
      provider: identity?.provider || null,
      message: sanitizeAuthError(error),
    })
  }
}

function xIdentityErrorMessage(code) {
  if (code === 'twitter_identity_mismatch') return 'Connected X account does not match the Renaiss Twitter account for this wallet.'
  if (code === 'renaiss_twitter_required') return 'This wallet has no Renaiss Twitter account recorded yet.'
  if (code === 'wallet_required') return 'A wallet-linked session is required before connecting X.'
  if (code === 'profile_store_missing') return 'User profile store is not available.'
  return 'X identity could not be matched to this wallet.'
}

function assertXIdentityMatchesWalletProfile(auth, session, identity) {
  if (!auth.userProfileStore?.checkXIdentityForWallet) {
    throw Object.assign(new Error(xIdentityErrorMessage('profile_store_missing')), {
      statusCode: 503,
      code: 'profile_store_missing',
    })
  }

  const result = auth.userProfileStore.checkXIdentityForWallet({
    walletAddress: session?.walletAddress,
    identity,
  })
  if (result.ok) return result

  throw Object.assign(new Error(xIdentityErrorMessage(result.code)), {
    statusCode: 403,
    code: result.code,
    expectedUsername: result.expectedUsername,
    actualUsername: result.actualUsername,
  })
}

function createRenaissProviderSignOutUrl(issuer) {
  const base = String(issuer || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  try {
    return new URL(`${base}/sign-out`).toString()
  } catch {
    return ''
  }
}

async function getRenaissPublicConfig(auth) {
  const config = auth.providerConfig.renaiss
  if (!providerConfigured(auth.providerConfig, 'renaiss')) return null

  try {
    const { doc } = await getRenaissDiscovery(config)
    return {
      signOutUrl: createRenaissProviderSignOutUrl(doc.issuer || config.issuer),
    }
  } catch {
    return {
      signOutUrl: createRenaissProviderSignOutUrl(config.issuer),
    }
  }
}

export function createAuthContext({ dataDir, env = process.env, userProfileStore = null }) {
  const authDir = env.SOCCER_AUTH_DIR || join(dataDir, 'auth')
  const sessionSecret = env.AUTH_SESSION_SECRET || env.SESSION_SECRET || ''
  const secureCookies = (env.AUTH_COOKIE_SECURE || '').trim()
    ? env.AUTH_COOKIE_SECURE !== '0'
    : String(env.PUBLIC_APP_ORIGIN || env.AUTH_PUBLIC_ORIGIN || '').startsWith('https://')

  const sessionConfig = createSessionConfig({ authDir, sessionSecret, secureCookies })
  const stateConfig = createAuthStateConfig({ authDir, sessionSecret })
  const oauthTokenConfig = createOAuthTokenConfig({ authDir, sessionSecret })
  const xFollowGateConfig = createXFollowGateConfig({ authDir, env })
  const xAccountEligibilityConfig = createXAccountEligibilityConfig({ authDir, env })
  const providerConfig = buildProviderConfig(env)
  const identityResolverConfig = createIdentityResolverConfig(env)
  const emailConfig = createEmailConfig(env)
  const legacyProvidersEnabled = legacyLoginEnabled(env)

  return {
    authDir,
    env,
    sessionConfig,
    stateConfig,
    oauthTokenConfig,
    userProfileStore,
    xFollowGateConfig,
    xAccountEligibilityConfig,
    providerConfig,
    identityResolverConfig,
    emailConfig,
    legacyProvidersEnabled,
    providers: {
      renaiss: providerConfigured(providerConfig, 'renaiss'),
      google: legacyProvidersEnabled && providerConfigured(providerConfig, 'google'),
      x: providerConfigured(providerConfig, 'x'),
      discord: legacyProvidersEnabled && providerConfigured(providerConfig, 'discord'),
      wallet: legacyProvidersEnabled,
      email: legacyProvidersEnabled && emailSenderConfigured(emailConfig),
    },
    sessionConfigured: hasSessionSecret(sessionConfig),
    identityResolverConfigured: identityResolverConfigured(identityResolverConfig),
  }
}

export function readAuthSession(auth, request) {
  return readSession(auth.sessionConfig, request)
}

export function getAuthPublicStatus(auth) {
  return {
    sessionConfigured: auth.sessionConfigured,
    identityResolverConfigured: auth.identityResolverConfigured,
    providers: auth.providers,
    xFollowGate: {
      targetHandle: auth.xFollowGateConfig.targetHandle,
      targetUrl: auth.xFollowGateConfig.targetUrl,
      retrySeconds: auth.xFollowGateConfig.retrySeconds,
      required: auth.xFollowGateConfig.required,
      skipEnabled: auth.xFollowGateConfig.skipEnabled,
    },
    xAccountEligibility: {
      required: auth.xAccountEligibilityConfig.required,
      configured: Boolean(auth.xAccountEligibilityConfig.apiKey),
      cacheTtlSeconds: auth.xAccountEligibilityConfig.cacheTtlSeconds,
    },
  }
}

export async function handleAuthRoute({
  auth,
  request,
  response,
  url,
  readJsonBody,
  sendJson,
}) {
  const routePathname = url.pathname === '/auth/callback' ? '/api/auth/renaiss/callback' : url.pathname
  if (!routePathname.startsWith('/api/auth/')) return false

  if (routePathname === '/api/auth/me') {
    const session = readAuthSession(auth, request)
    const publicConfig = getAuthPublicStatus(auth)
    publicConfig.renaiss = await getRenaissPublicConfig(auth)
    const xFollow = getXFollowStatus(auth, session, request)
    sendJsonResponse(sendJson, request, response, 200, {
      authenticated: Boolean(session),
      identity: session?.identity || null,
      walletAddress: session?.walletAddress || null,
      resolver: session?.resolver || null,
      csrfToken: csrfTokenForSession(auth.sessionConfig, session) || null,
      xFollow,
      xAccountEligibility: getXAccountEligibilityStatus(auth, session, request, { xFollowStatus: xFollow }),
      requiresWalletLink: Boolean(session && !session.walletAddress),
      config: publicConfig,
    })
    return true
  }

  if (routePathname === '/api/auth/x-follow/status') {
    const session = readAuthSession(auth, request)
    sendJsonResponse(sendJson, request, response, 200, getXFollowStatus(auth, session, request))
    return true
  }

  if (routePathname === '/api/auth/x-account-eligibility/status') {
    const session = readAuthSession(auth, request)
    const xFollow = getXFollowStatus(auth, session, request)
    sendJsonResponse(
      sendJson,
      request,
      response,
      200,
      getXAccountEligibilityStatus(auth, session, request, { xFollowStatus: xFollow }),
    )
    return true
  }

  if (routePathname === '/api/auth/verification-stats') {
    if (request.method !== 'GET') {
      sendJsonResponse(sendJson, request, response, 405, { ok: false, error: 'GET required.' })
      return true
    }

    const xFollowStats = getXFollowVerificationStats(auth.xFollowGateConfig)
    const eligibilityStats = getXAccountEligibilityStats(auth.xAccountEligibilityConfig)
    sendJsonResponse(sendJson, request, response, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      counts: {
        xVerified: xFollowStats.verifiedPeople,
        voteEligible: eligibilityStats.eligiblePeople,
      },
      sources: {
        xFollow: {
          updatedAt: xFollowStats.updatedAt,
          targetHandle: xFollowStats.targetHandle,
        },
        xAccountEligibility: {
          updatedAt: eligibilityStats.updatedAt,
        },
      },
    })
    return true
  }

  if (routePathname === '/api/auth/x-account-eligibility/verify') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { ok: false, error: 'POST required.' })
      return true
    }

    const session = readAuthSession(auth, request)
    const xFollow = getXFollowStatus(auth, session, request)
    try {
      const body = await readJsonBody(request)
      const status = await verifyXAccountEligibility(auth, session, request, {
        xFollowStatus: xFollow,
        force: true,
        fireflyUid: body?.ffAccountUid ?? body?.ff_account_uid ?? body?.fireflyUid,
      })
      sendJsonResponse(sendJson, request, response, 200, { ok: true, ...status })
    } catch (error) {
      sendJsonResponse(
        sendJson,
        request,
        response,
        Number(error?.statusCode || 500),
        {
          ok: false,
          code: error?.code || 'eligibility_verify_failed',
          error: error instanceof Error ? error.message : 'Firefly eligibility verification failed.',
          retryAfterSeconds: error?.retryAfterSeconds || 0,
          status: error?.status || getXAccountEligibilityStatus(auth, session, request, { xFollowStatus: xFollow }),
        },
      )
    }
    return true
  }

  if (routePathname === '/api/auth/x-follow/verify') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { ok: false, error: 'POST required.' })
      return true
    }

    const session = readAuthSession(auth, request)
    try {
      const status = await verifyXFollow(auth, session, request)
      sendJsonResponse(sendJson, request, response, 200, { ok: true, ...status })
    } catch (error) {
      logXFollowVerifyFailure(session, error)
      sendJsonResponse(
        sendJson,
        request,
        response,
        Number(error?.statusCode || 500),
        {
          ok: false,
          code: error?.code || 'verify_failed',
          error: error instanceof Error ? error.message : 'X follow verification failed.',
          retryAfterSeconds: error?.retryAfterSeconds || error?.status?.retryAfterSeconds || 0,
          status: error?.status || getXFollowStatus(auth, session, request),
        },
      )
    }
    return true
  }

  if (routePathname === '/api/auth/x-follow/skip') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { ok: false, error: 'POST required.' })
      return true
    }

    const session = readAuthSession(auth, request)
    try {
      const result = skipXFollow(auth, session, request)
      sendJsonResponse(sendJson, request, response, 200, { ok: true, ...result.status }, {
        'set-cookie': result.cookie,
      })
    } catch (error) {
      sendJsonResponse(
        sendJson,
        request,
        response,
        Number(error?.statusCode || 500),
        {
          ok: false,
          code: error?.code || 'skip_failed',
          error: error instanceof Error ? error.message : 'X follow test bypass failed.',
          status: error?.status || getXFollowStatus(auth, session, request),
        },
      )
    }
    return true
  }

  if (routePathname === '/api/auth/logout') {
    if (request.method !== 'POST' && request.method !== 'GET') {
      sendJsonResponse(sendJson, request, response, 405, { error: 'POST or GET required.' })
      return true
    }
    const session = readAuthSession(auth, request)
    clearSession(auth.sessionConfig, request, response)
    clearOAuthTokensForSession(auth.oauthTokenConfig, session?.id)
    const currentSetCookie = response.getHeader('set-cookie')
    const headers = appendSetCookie({ 'set-cookie': currentSetCookie }, clearXFollowSkipCookie(auth))
    if (request.method === 'GET') {
      redirect(response, safeReturnTo(url.searchParams.get('return_to')) || '/', headers)
      return true
    }
    sendJsonResponse(sendJson, request, response, 200, { ok: true }, headers)
    return true
  }

  const oauthRoute = parseOAuthRoute(routePathname)

  if (oauthRoute?.action === 'start') {
    const provider = oauthRoute.provider
    const currentSession = readAuthSession(auth, request)
    const connectRequested = provider === 'x' && url.searchParams.get('connect') === '1'
    if (!auth.legacyProvidersEnabled && ['google', 'discord'].includes(provider)) {
      sendJsonResponse(sendJson, request, response, 404, { error: `${provider} login is disabled. Use Renaiss SSO.` })
      return true
    }
    if (provider === 'x' && !connectRequested) {
      sendJsonResponse(sendJson, request, response, 404, { error: 'X is only available as a verification connection.' })
      return true
    }
    if (provider === 'x' && !currentSession?.walletAddress) {
      redirect(response, authErrorRedirectForChallenge(auth.env, { returnTo: url.searchParams.get('return_to') }, 'oauth_failed', {
        provider,
        stage: 'wallet_required',
      }))
      return true
    }
    if (!providerConfigured(auth.providerConfig, provider)) {
      sendJsonResponse(sendJson, request, response, 503, { error: `${provider} OAuth is not configured.` })
      return true
    }
    if (!auth.sessionConfigured) {
      sendJsonResponse(sendJson, request, response, 503, { error: 'AUTH_SESSION_SECRET is not configured.' })
      return true
    }

    const config = auth.providerConfig[provider]
    const redirectUri = config.redirectUri || createRedirectUri(provider, request, auth.env)
    const { verifier, challenge: codeChallenge } = createPkcePair()
    const nonce = config.oidc ? randomBytes(16).toString('base64url') : null
    let authorizationEndpoint = config.authUrl
    try {
      if (config.oidc) {
        const { doc } = await getRenaissDiscovery(config)
        authorizationEndpoint = doc.authorization_endpoint
      }
    } catch (error) {
      logOAuthCallbackFailure(provider, 'discovery', error)
      redirect(response, authErrorRedirect(auth.env, 'oauth_failed', { provider, stage: 'discovery' }))
      return true
    }

    const stateToken = createOauthChallenge(auth.stateConfig, provider, {
      codeVerifier: verifier,
      redirectUri,
      nonce,
      returnTo: safeReturnTo(url.searchParams.get('return_to')),
      connectSessionId: connectRequested && currentSession?.id ? currentSession.id : null,
    })

    const authorizeUrl = new URL(authorizationEndpoint)
    const authParams = { ...(config.authParams || {}) }
    const promptOverride = readRenaissPromptOverride(url, provider)
    const maxAgeOverride = readRenaissMaxAgeOverride(url, provider)
    if (promptOverride) authParams.prompt = promptOverride
    if (maxAgeOverride) authParams.max_age = maxAgeOverride
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', config.clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('scope', config.scope)
    authorizeUrl.searchParams.set('state', stateToken)
    authorizeUrl.searchParams.set('code_challenge', codeChallenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    if (nonce) authorizeUrl.searchParams.set('nonce', nonce)
    for (const [key, value] of Object.entries(authParams)) {
      if (value) authorizeUrl.searchParams.set(key, value)
    }

    redirect(response, authorizeUrl.toString(), {
      'set-cookie': stateCookie(provider, stateToken, auth.sessionConfig.secureCookies),
    })
    return true
  }

  if (oauthRoute?.action === 'callback') {
    const provider = oauthRoute.provider
    if (!auth.legacyProvidersEnabled && ['google', 'discord'].includes(provider)) {
      redirect(response, authErrorRedirect(auth.env, 'oauth_failed', { provider, stage: 'provider_disabled' }))
      return true
    }
    const stateToken = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const oauthError = url.searchParams.get('error') || ''
    const oauthErrorDescription = url.searchParams.get('error_description') || ''
    const cookies = parseCookies(request.headers.cookie || '')
    const expectedState = cookies[oauthStateCookieName(provider)]
    const clearStateHeader = stateCookie(provider, '', auth.sessionConfig.secureCookies, 0)

    let challenge = null
    let failureStage = 'callback'
    try {
      if (oauthError) {
        failureStage = 'provider_returned_error'
        throw new Error(oauthErrorDescription || oauthError)
      }
      failureStage = 'state_validation'
      if (!stateToken || !code || stateToken !== expectedState) throw new Error('Invalid OAuth state.')
      challenge = consumeOauthChallenge(auth.stateConfig, provider, stateToken)
      failureStage = 'state_lookup'
      if (!challenge) throw new Error('OAuth state expired.')
      if (provider === 'x' && !challenge.connectSessionId) {
        failureStage = 'x_connect_required'
        throw Object.assign(new Error('X is only available as a verification connection.'), {
          code: 'x_connect_required',
        })
      }
      failureStage = 'token_exchange'
      let token = null
      let identity = null
      if (auth.providerConfig[provider]?.oidc) {
        const result = await exchangeRenaissOidcCode(auth.providerConfig[provider], {
          code,
          codeVerifier: challenge.codeVerifier,
          redirectUri: challenge.redirectUri,
          nonce: challenge.nonce,
        })
        token = result.token
        identity = result.identity
      } else {
        token = await exchangeOAuthCode(provider, auth.providerConfig, {
          code,
          codeVerifier: challenge.codeVerifier,
          redirectUri: challenge.redirectUri,
        })
        failureStage = 'userinfo'
        identity = await fetchOAuthIdentity(provider, auth.providerConfig, token.access_token)
      }
      if (!identity.providerUserId) throw new Error('OAuth identity missing stable user id.')
      const currentSession = readAuthSession(auth, request)
      let session = null
      if (provider === 'x' && challenge.connectSessionId) {
        failureStage = 'session_link'
        if (!currentSession || currentSession.id !== challenge.connectSessionId) {
          throw new Error('X connection session expired or changed. Please retry from the verification panel.')
        }
        failureStage = 'twitter_identity_check'
        assertXIdentityMatchesWalletProfile(auth, currentSession, identity)
        session = currentSession
        saveOAuthToken(auth.oauthTokenConfig, session, provider, token, { identity })
        enqueueLoginProfileWrite(auth, session, identity, request)
      } else {
        failureStage = 'session_create'
        const result = await createSessionForIdentity({ auth, request, response, identity })
        session = result.session
        if (provider === 'x' || auth.providerConfig[provider]?.oidc) {
          saveOAuthToken(auth.oauthTokenConfig, session, provider, token, { identity })
        }
        enqueueLoginProfileWrite(auth, session, identity, request)
      }
      const currentSetCookie = response.getHeader('set-cookie')
      const headers = appendSetCookie({ 'set-cookie': currentSetCookie }, clearStateHeader)
      redirect(response, challenge.returnTo || authSuccessRedirect(auth.env), headers)
    } catch (error) {
      const stage = error?.code || failureStage
      logOAuthCallbackFailure(provider, stage, error)
      response.setHeader('set-cookie', clearStateHeader)
      redirect(response, authErrorRedirectForChallenge(auth.env, challenge, 'oauth_failed', {
        provider,
        stage,
        code: error?.code || '',
      }))
    }
    return true
  }

  const isLegacyAuthRoute = routePathname.startsWith('/api/auth/wallet/')
    || routePathname.startsWith('/api/auth/email/')
  if (isLegacyAuthRoute && !auth.legacyProvidersEnabled) {
    sendJsonResponse(sendJson, request, response, 404, { error: 'This login method is disabled. Use Renaiss SSO.' })
    return true
  }

  if (routePathname === '/api/auth/wallet/nonce') {
    if (!auth.sessionConfigured) {
      sendJsonResponse(sendJson, request, response, 503, { error: 'AUTH_SESSION_SECRET is not configured.' })
      return true
    }
    const address = normalizeAddress(url.searchParams.get('address'))
    if (!address) {
      sendJsonResponse(sendJson, request, response, 400, { error: 'address query must be a valid wallet address.' })
      return true
    }

    const origin = auth.env.PUBLIC_APP_ORIGIN || auth.env.AUTH_PUBLIC_ORIGIN || getRequestOrigin(request)
    const domain = auth.env.SIWE_DOMAIN || new URL(origin).host
    const chainId = String(auth.env.SIWE_CHAIN_ID || '56')
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const challenge = createWalletChallenge(auth.stateConfig, address, { domain, origin, chainId, issuedAt, expiresAt })
    const message = buildWalletMessage({
      domain,
      origin,
      address,
      chainId,
      nonce: challenge.nonce,
      issuedAt,
      expiresAt,
    })
    sendJsonResponse(sendJson, request, response, 200, {
      address,
      chainId,
      nonce: challenge.nonce,
      message,
      expiresAt,
    })
    return true
  }

  if (routePathname === '/api/auth/wallet/verify') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { error: 'POST required.' })
      return true
    }
    try {
      const body = await readJsonBody(request)
      const address = normalizeAddress(body.address)
      const signature = String(body.signature || '').trim()
      const message = String(body.message || '')
      const parsed = parseWalletMessage(message)
      if (!address || !signature || !message || !parsed.nonce) {
        throw Object.assign(new Error('Wallet address, message, and signature are required.'), { statusCode: 400 })
      }
      const challenge = consumeWalletChallenge(auth.stateConfig, parsed.nonce)
      if (!challenge || challenge.address !== address || challenge.address !== parsed.address || challenge.domain !== parsed.domain || challenge.chainId !== parsed.chainId || challenge.expiresAt !== parsed.expirationTime) {
        throw Object.assign(new Error('Wallet sign-in challenge expired or does not match.'), { statusCode: 401 })
      }
      if (Date.parse(challenge.expiresAt) <= Date.now()) {
        throw Object.assign(new Error('Wallet sign-in challenge expired.'), { statusCode: 401 })
      }
      const verification = await new SiweMessage(message).verify({
        signature,
        domain: challenge.domain,
        nonce: challenge.nonce,
      })
      if (!verification.success || normalizeAddress(verification.data.address) !== address) {
        throw Object.assign(new Error('Wallet signature does not match the requested address.'), { statusCode: 401 })
      }
      const identity = {
        provider: 'wallet',
        providerUserId: address,
        walletAddress: address,
      }
      const result = await createSessionForIdentity({ auth, request, response, identity })
      enqueueLoginProfileWrite(auth, result.session, identity, request)
      sendJsonResponse(sendJson, request, response, 200, {
        ok: true,
        authenticated: true,
        identity,
        walletAddress: result.session.walletAddress,
        resolver: result.resolver,
      })
    } catch (error) {
      sendJsonResponse(sendJson, request, response, Number(error?.statusCode || 500), {
        ok: false,
        error: error instanceof Error ? error.message : 'Wallet sign-in failed.',
      })
    }
    return true
  }

  if (routePathname === '/api/auth/email/start') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { error: 'POST required.' })
      return true
    }
    try {
      const body = await readJsonBody(request)
      const email = normalizeEmail(body.email)
      if (!email) throw Object.assign(new Error('A valid email is required.'), { statusCode: 400 })
      if (!emailSenderConfigured(auth.emailConfig)) {
        throw Object.assign(new Error('Email OTP sender is not configured.'), { statusCode: 503 })
      }
      const challenge = createEmailOtpChallenge(auth.stateConfig, email)
      await sendOtpEmail(auth.emailConfig, challenge)
      sendJsonResponse(sendJson, request, response, 200, {
        ok: true,
        email,
        expiresInSeconds: challenge.expiresInSeconds,
      })
    } catch (error) {
      sendJsonResponse(sendJson, request, response, Number(error?.statusCode || 500), {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not send email OTP.',
        retryAfterSeconds: error?.retryAfterSeconds,
      })
    }
    return true
  }

  if (routePathname === '/api/auth/email/verify') {
    if (request.method !== 'POST') {
      sendJsonResponse(sendJson, request, response, 405, { error: 'POST required.' })
      return true
    }
    try {
      const body = await readJsonBody(request)
      const email = normalizeEmail(body.email)
      const code = String(body.code || '').trim()
      if (!email || !/^\d{6}$/.test(code)) {
        throw Object.assign(new Error('Email and six-digit OTP are required.'), { statusCode: 400 })
      }
      const verification = consumeEmailOtpChallenge(auth.stateConfig, email, code)
      if (!verification.ok) {
        throw Object.assign(new Error('OTP is invalid or expired.'), { statusCode: 401, reason: verification.reason })
      }
      const identity = {
        provider: 'email',
        providerUserId: email,
        email,
      }
      const result = await createSessionForIdentity({ auth, request, response, identity })
      enqueueLoginProfileWrite(auth, result.session, identity, request)
      sendJsonResponse(sendJson, request, response, 200, {
        ok: true,
        authenticated: true,
        identity,
        walletAddress: result.session.walletAddress,
        resolver: result.resolver,
      })
    } catch (error) {
      sendJsonResponse(sendJson, request, response, Number(error?.statusCode || 500), {
        ok: false,
        error: error instanceof Error ? error.message : 'Email OTP verification failed.',
      })
    }
    return true
  }

  sendJsonResponse(sendJson, request, response, 404, { error: 'Auth route not found.' })
  return true
}
