import { readFileSync } from 'node:fs'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(text) ? text : ''
}

export function normalizeHash(value) {
  const text = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{64}$/.test(text) ? text : ''
}

export function toNumber(value) {
  if (typeof value === 'string' && value.startsWith('0x')) {
    const parsed = Number.parseInt(value, 16)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

export function hexToBigIntText(value) {
  const text = String(value || '').trim()
  if (!/^0x[a-fA-F0-9]+$/.test(text)) return ''
  return BigInt(text).toString()
}

export function topicToAddress(topic) {
  const text = String(topic || '').trim().toLowerCase()
  if (!/^0x[a-f0-9]{64}$/.test(text)) return ''
  return normalizeAddress(`0x${text.slice(-40)}`)
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const safeConcurrency = Math.min(items.length || 1, Math.max(1, toNumber(concurrency) || 1))
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, worker))
  return results
}

export function readEnvFile(path) {
  if (!path) return {}
  const text = readFileSync(path, 'utf8')
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) values[key] = value
  }
  return values
}

export function readWalletMigrationMap(path) {
  if (!path) return new Map()
  const text = readFileSync(path, 'utf8')
  const payload = JSON.parse(text)
  return extractWalletMigrationPairs(payload)
}

export function extractWalletMigrationPairs(payload) {
  const pairs = new Map()

  function putPair(oldAddress, newAddress) {
    const oldNorm = normalizeAddress(oldAddress)
    const newNorm = normalizeAddress(newAddress)
    if (!oldNorm || !newNorm || oldNorm === newNorm) return
    pairs.set(oldNorm, newNorm)
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') putPair(key, value)
    }

    if (payload.old_to_new && typeof payload.old_to_new === 'object') {
      for (const [oldAddress, newAddress] of Object.entries(payload.old_to_new)) {
        putPair(oldAddress, newAddress)
      }
    }

    for (const key of ['mappings', 'pairs', 'items']) {
      const rows = Array.isArray(payload[key]) ? payload[key] : []
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        putPair(
          row.old || row.old_wallet || row.oldWallet || row.from,
          row.new || row.new_wallet || row.newWallet || row.to,
        )
      }
    }
  }

  return pairs
}
