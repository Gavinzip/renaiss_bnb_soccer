const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i

function normalizeAddress(value) {
  const address = String(value || '').trim()
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function readWalletFromResolverPayload(payload) {
  const direct = normalizeAddress(payload?.walletAddress ?? payload?.wallet_address ?? payload?.address)
  if (direct) return direct

  const wallets = Array.isArray(payload?.wallets) ? payload.wallets : []
  for (const wallet of wallets) {
    const address = normalizeAddress(wallet?.walletAddress ?? wallet?.wallet_address ?? wallet?.address ?? wallet)
    if (address) return address
  }

  return ''
}

export function createIdentityResolverConfig(env = process.env) {
  return {
    url: String(env.IDENTITY_RESOLVER_API_URL || '').trim(),
    apiKey: String(env.IDENTITY_RESOLVER_API_KEY || '').trim(),
    timeoutMs: Math.max(1000, Math.floor(Number(env.IDENTITY_RESOLVER_TIMEOUT_MS || 8000) || 8000)),
  }
}

export function identityResolverConfigured(config) {
  return Boolean(config?.url)
}

export async function resolveIdentityToWallet(config, identity) {
  if (identity?.provider === 'wallet') {
    const walletAddress = normalizeAddress(identity.walletAddress)
    return {
      status: walletAddress ? 'resolved' : 'unresolved',
      source: 'wallet-signature',
      walletAddress: walletAddress || null,
      reason: walletAddress ? null : 'invalid-wallet-address',
    }
  }

  if (identity?.provider === 'renaiss') {
    const walletAddress = normalizeAddress(identity.safeWalletAddress)
    if (walletAddress) {
      return {
        status: 'resolved',
        source: 'renaiss-sso',
        walletAddress,
        reason: null,
        resolverId: identity.providerUserId || null,
        legacyWalletAddress: normalizeAddress(identity.legacyWalletAddress) || null,
        chainId: identity.chainId || null,
      }
    }

    return {
      status: identity.userinfoError ? 'error' : 'unresolved',
      source: 'renaiss-sso',
      walletAddress: null,
      reason: identity.userinfoError || (identity.safeWalletInvalid
        ? 'invalid-renaiss-safe-wallet-address'
        : (identity.safeWalletClaimPresent ? 'renaiss-safe-wallet-not-ready' : 'renaiss-safe-wallet-missing')),
      resolverId: identity.providerUserId || null,
      legacyWalletAddress: normalizeAddress(identity.legacyWalletAddress) || null,
      chainId: identity.chainId || null,
    }
  }

  if (!identityResolverConfigured(config)) {
    return {
      status: 'unresolved',
      source: 'identity-resolver',
      walletAddress: null,
      reason: 'identity-resolver-not-configured',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ identity }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        status: 'error',
        source: 'identity-resolver',
        walletAddress: null,
        reason: payload?.error || `identity resolver returned HTTP ${response.status}`,
      }
    }

    const walletAddress = readWalletFromResolverPayload(payload)
    return {
      status: walletAddress ? 'resolved' : 'unresolved',
      source: 'identity-resolver',
      walletAddress: walletAddress || null,
      reason: walletAddress ? null : 'wallet-address-missing',
      resolverId: payload?.id || payload?.resolverId || payload?.resolver_id || null,
    }
  } catch (error) {
    return {
      status: 'error',
      source: 'identity-resolver',
      walletAddress: null,
      reason: error instanceof Error ? error.message : 'identity resolver request failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}
