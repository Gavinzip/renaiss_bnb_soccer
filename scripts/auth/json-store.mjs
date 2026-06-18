import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

export function readJsonFile(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback)
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'))
    return payload && typeof payload === 'object' ? payload : structuredClone(fallback)
  } catch {
    return structuredClone(fallback)
  }
}

export function writeJsonFileAtomic(path, payload) {
  ensureParent(path)
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmpPath, path)
}

export function pruneRecordMap(records, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(records || {}).filter(([, record]) => {
      if (!record || typeof record !== 'object') return false
      const expiresAt = Date.parse(record.expiresAt || '')
      return Number.isFinite(expiresAt) && expiresAt > now
    }),
  )
}
