import { WALLET_RESOLVE_URL } from './rules.mjs'
import { mapWithConcurrency, normalizeAddress, sleep } from './utils.mjs'
import { isFreshCache, readJsonCache, writeJsonCache } from './cache.mjs'

async function fetchJson(url, args) {
  let lastError = null
  const retries = Math.max(1, Number(args.retries || 3))
  const backoffMs = Math.max(100, Number(args.backoffMs || 800))

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`${url} returned ${response.status}: ${text.slice(0, 240)}`)
      }
      return response.json()
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(backoffMs * 2 ** (attempt - 1))
    }
  }

  throw lastError
}

export async function resolveEventWallets(events, args) {
  const addressSet = new Set()
  for (const event of events) {
    const address = normalizeAddress(event.sourceAddress || event.canonicalAddress)
    if (address) addressSet.add(address)
  }

  const addresses = [...addressSet].sort()
  const localMap = args.walletMigrationMap || new Map()
  const resolved = new Map()
  const migrationSourcesByCanonical = new Map()
  const resolveCachePath = args.noCache ? '' : args.walletResolveCachePath
  const resolveCache = readJsonCache(resolveCachePath, { entries: {} }) || { entries: {} }
  const resolveCacheEntries = resolveCache.entries || {}
  const resolveCacheTtlMs = Number(args.walletResolveCacheTtlMs || 0)
  const cacheStats = { hits: 0, fetched: 0, skippedByMigrationMap: 0, cachePath: resolveCachePath || null }

  function canonicalFromMigrationMap(address) {
    let current = normalizeAddress(address)
    const seen = new Set()
    while (current && localMap.has(current) && !seen.has(current)) {
      seen.add(current)
      current = normalizeAddress(localMap.get(current)) || current
    }
    return current
  }

  for (const [oldAddressRaw, newAddressRaw] of localMap.entries()) {
    const oldAddress = normalizeAddress(oldAddressRaw)
    const canonical = canonicalFromMigrationMap(newAddressRaw)
    if (!oldAddress || !canonical) continue
    const sources = migrationSourcesByCanonical.get(canonical) || new Set([canonical])
    sources.add(oldAddress)
    sources.add(canonical)
    migrationSourcesByCanonical.set(canonical, sources)
  }

  for (const address of addresses) {
    const localCanonical = canonicalFromMigrationMap(address)
    const migrationSources = localCanonical ? migrationSourcesByCanonical.get(localCanonical) : null
    if (localCanonical && (localCanonical !== address || migrationSources)) {
      resolved.set(address, {
        canonical: localCanonical,
        sourceAddresses: new Set([address, localCanonical, ...(migrationSources || [])]),
      })
      cacheStats.skippedByMigrationMap += 1
    }
  }

  if (!args.skipWalletResolve) {
    const unresolved = addresses.filter((address) => !resolved.has(address))
    await mapWithConcurrency(unresolved, args.resolveConcurrency, async (address, index) => {
      const cached = resolveCacheEntries[address]
      let data = null
      if (isFreshCache(cached, resolveCacheTtlMs) && cached.data && !args.refreshCache) {
        data = cached.data
        cacheStats.hits += 1
      } else {
        data = await fetchJson(
          `${WALLET_RESOLVE_URL}?address=${encodeURIComponent(address)}`,
          args,
        )
        resolveCacheEntries[address] = {
          fetchedAt: Date.now(),
          data,
        }
        cacheStats.fetched += 1
      }
      const canonical = normalizeAddress(data.canonical) || address
      const sourceAddresses = new Set([address, canonical])
      for (const oldAddress of data.old_addresses || []) {
        const normalized = normalizeAddress(oldAddress)
        if (normalized) sourceAddresses.add(normalized)
      }
      resolved.set(address, { canonical, sourceAddresses })
      if (args.delayMs > 0) await sleep(args.delayMs)
      if (args.progress && (index + 1 === unresolved.length || (index + 1) % 100 === 0)) {
        console.log(
          `[wallet-resolve] ${index + 1}/${unresolved.length} cache_hits=${cacheStats.hits} fetched=${cacheStats.fetched}`,
        )
      }
    })
    writeJsonCache(resolveCachePath, {
      version: 1,
      updatedAt: Date.now(),
      entries: resolveCacheEntries,
    })
  }

  const canonicalSources = new Map()
  const outEvents = events.map((event) => {
    const sourceAddress = normalizeAddress(event.sourceAddress || event.canonicalAddress)
    const row = resolved.get(sourceAddress) || {
      canonical: sourceAddress,
      sourceAddresses: new Set([sourceAddress]),
    }
    const canonical = normalizeAddress(row.canonical) || sourceAddress
    const sources = canonicalSources.get(canonical) || new Set()
    for (const source of row.sourceAddresses || []) {
      const normalized = normalizeAddress(source)
      if (normalized) sources.add(normalized)
    }
    if (sourceAddress) sources.add(sourceAddress)
    if (canonical) sources.add(canonical)
    canonicalSources.set(canonical, sources)

    return {
      ...event,
      canonicalAddress: canonical,
      sourceAddress,
    }
  })

  return {
    events: outEvents,
    canonicalSources,
    cacheStats,
  }
}
