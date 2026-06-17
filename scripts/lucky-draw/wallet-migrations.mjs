import { extractWalletMigrationPairs } from './utils.mjs'
import { isFreshCache, readJsonCache, writeJsonCache } from './cache.mjs'

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 240)}`)
  }
  return response.json()
}

export async function fetchWalletMigrationMap(url, args = {}) {
  if (!url) return { pairs: new Map(), meta: null }
  const cachePath = args.noCache ? '' : args.walletMigrationCachePath
  const cached = readJsonCache(cachePath)
  const cacheTtlMs = Number(args.walletMigrationCacheTtlMs || 0)
  let payload = null
  let cacheStatus = 'miss'

  if (
    cached?.url === url &&
    isFreshCache(cached, cacheTtlMs) &&
    cached.payload &&
    !args.refreshCache
  ) {
    payload = cached.payload
    cacheStatus = 'hit'
  } else {
    payload = await fetchJson(url)
    cacheStatus = cached ? 'refresh' : 'miss'
    writeJsonCache(cachePath, {
      url,
      fetchedAt: Date.now(),
      payload,
    })
  }

  return {
    pairs: extractWalletMigrationPairs(payload),
    meta: {
      url,
      cacheStatus,
      cachePath: cachePath || null,
      version: payload?.version ?? null,
      updatedAt: payload?.updated_at ?? null,
      source: payload?.source ?? null,
      summary: payload?.summary ?? null,
      status: payload?.status
        ? {
            updatedAt: payload.status.updated_at ?? null,
            success: payload.status.success ?? null,
            trigger: payload.status.trigger ?? null,
            message: payload.status.message ?? null,
          }
        : null,
    },
  }
}
