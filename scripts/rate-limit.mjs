function cleanKey(value) {
  return String(value || 'anonymous').trim().replace(/\s+/g, ' ').slice(0, 180) || 'anonymous'
}

function normalizeRule(rule) {
  return {
    ...rule,
    key: `${cleanKey(rule.scope)}:${cleanKey(rule.key)}`,
    limit: Math.max(1, Math.floor(Number(rule.limit || 1))),
    windowMs: Math.max(1000, Math.floor(Number(rule.windowMs || 1000))),
  }
}

export function createMemoryRateLimiter({ maxBuckets = 20000 } = {}) {
  const buckets = new Map()
  let checks = 0

  function pruneBucket(key, nowMs, windowMs) {
    const bucket = buckets.get(key)
    if (!bucket) return []
    const fresh = bucket.filter((timestamp) => timestamp > nowMs - windowMs)
    if (fresh.length) buckets.set(key, fresh)
    else buckets.delete(key)
    return fresh
  }

  function pruneOldBuckets() {
    if (buckets.size <= maxBuckets) return
    const staleCount = buckets.size - maxBuckets
    let deleted = 0
    for (const key of buckets.keys()) {
      buckets.delete(key)
      deleted += 1
      if (deleted >= staleCount) break
    }
  }

  function check(rawRules, { nowMs = Date.now() } = {}) {
    const rules = (Array.isArray(rawRules) ? rawRules : [rawRules]).filter(Boolean).map(normalizeRule)
    if (!rules.length) return { ok: true, retryAfterSeconds: 0 }

    checks += 1
    if (checks % 250 === 0) pruneOldBuckets()

    const windows = rules.map((rule) => ({
      rule,
      bucket: pruneBucket(rule.key, nowMs, rule.windowMs),
    }))

    const failed = windows.find(({ rule, bucket }) => bucket.length >= rule.limit)
    if (failed) {
      const oldest = Math.min(...failed.bucket)
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + failed.rule.windowMs - nowMs) / 1000))
      return {
        ok: false,
        retryAfterSeconds,
        policy: failed.rule.scope,
        limit: failed.rule.limit,
        windowMs: failed.rule.windowMs,
      }
    }

    for (const { rule, bucket } of windows) {
      buckets.set(rule.key, [...bucket, nowMs])
    }

    return { ok: true, retryAfterSeconds: 0 }
  }

  return {
    check,
    size() {
      return buckets.size
    },
  }
}
