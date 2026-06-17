import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function isFreshCache(row, ttlMs, nowMs = Date.now()) {
  if (!row || !ttlMs || ttlMs <= 0) return false
  const fetchedAt = Number(row.fetchedAt || 0)
  return fetchedAt > 0 && nowMs - fetchedAt <= ttlMs
}

export function readJsonCache(path, fallback = null) {
  if (!path || !existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonCache(path, value) {
  if (!path) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
