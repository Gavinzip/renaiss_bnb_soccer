import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { POKEMON30_EVENT_ID } from './rules.mjs'

const CACHE_VERSION = 1
const HASH_PATTERN = /^0x[a-f0-9]{64}$/i

function positiveInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function cacheError(message, code = 'pokemon30_event_cache_invalid') {
  return Object.assign(new Error(message), { code })
}

function eventKey(event) {
  const txHash = String(event?.txHash || '').trim().toLowerCase()
  const logIndex = Number(event?.logIndex)
  if (!HASH_PATTERN.test(txHash) || !Number.isSafeInteger(logIndex) || logIndex < 0) {
    throw cacheError('Pokémon 30 event cache contains an event without a valid transaction hash and log index.')
  }
  return `${txHash}:${logIndex}`
}

function normaliseSource(source, kind) {
  if (!source || typeof source !== 'object') return null
  const fromBlock = positiveInteger(source.fromBlock)
  const toBlock = positiveInteger(source.toBlock)
  const events = Array.isArray(source.events) ? source.events : null
  if (!fromBlock || !toBlock || toBlock < fromBlock || !events) {
    throw cacheError(`Pokémon 30 ${kind} event cache has an invalid block range or events list.`)
  }
  for (const event of events) {
    if (!positiveInteger(event?.blockNumber)) {
      throw cacheError(`Pokémon 30 ${kind} event cache contains an event without a valid block number.`)
    }
    eventKey(event)
  }
  return {
    fromBlock,
    toBlock,
    updatedAt: positiveInteger(source.updatedAt),
    events: [...events],
  }
}

function normaliseCheckpoints(value) {
  if (!Array.isArray(value)) return []
  const checkpoints = new Map()
  for (const checkpoint of value) {
    const block = positiveInteger(checkpoint?.block)
    const updatedAt = positiveInteger(checkpoint?.updatedAt)
    if (!block || !updatedAt) {
      throw cacheError('Pokémon 30 event cache contains an invalid block checkpoint.')
    }
    const previous = checkpoints.get(block)
    if (!previous || updatedAt > previous.updatedAt) checkpoints.set(block, { block, updatedAt })
  }
  return [...checkpoints.values()].sort((left, right) => left.block - right.block)
}

function emptyCache() {
  return {
    version: CACHE_VERSION,
    eventId: POKEMON30_EVENT_ID,
    blockCheckpoints: [],
    sources: {},
  }
}

export function readPokemon30EventCache(path) {
  if (!path || !existsSync(path)) return emptyCache()
  let payload
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw cacheError(`Pokémon 30 event cache could not be read: ${error.message}`)
  }
  if (payload?.version !== CACHE_VERSION || payload?.eventId !== POKEMON30_EVENT_ID || !payload?.sources || typeof payload.sources !== 'object') {
    throw cacheError('Pokémon 30 event cache belongs to a different schema or campaign.')
  }
  const cache = emptyCache()
  cache.blockCheckpoints = normaliseCheckpoints(payload.blockCheckpoints)
  for (const kind of ['checkout', 'buyback']) {
    const source = normaliseSource(payload.sources[kind], kind)
    if (source) cache.sources[kind] = source
  }
  return cache
}

function dedupeEvents(events) {
  const byKey = new Map()
  for (const event of events) byKey.set(eventKey(event), event)
  return [...byKey.values()].sort((left, right) => {
    const leftBlock = positiveInteger(left.blockNumber)
    const rightBlock = positiveInteger(right.blockNumber)
    if (leftBlock !== rightBlock) return leftBlock - rightBlock
    return eventKey(left).localeCompare(eventKey(right))
  })
}

function mergeSource(previous, fetched, fromBlock, toBlock, updatedAt) {
  const retained = previous?.events?.filter((event) => {
    const blockNumber = positiveInteger(event.blockNumber)
    return blockNumber < fromBlock || blockNumber > toBlock
  }) || []
  return {
    fromBlock: previous ? Math.min(previous.fromBlock, fromBlock) : fromBlock,
    toBlock: previous ? Math.max(previous.toBlock, toBlock) : toBlock,
    updatedAt,
    events: dedupeEvents([...retained, ...fetched]),
  }
}

export function resolvePokemon30ScanWindow({ cache, campaignStartBlock, toBlock, lookbackRounds }) {
  const startBlock = positiveInteger(campaignStartBlock)
  const endBlock = positiveInteger(toBlock)
  const rounds = Math.max(1, positiveInteger(lookbackRounds) || 1)
  if (!startBlock || !endBlock || endBlock < startBlock) {
    throw cacheError('Pokémon 30 incremental scan requires a valid campaign block window.', 'pokemon30_scan_window_invalid')
  }
  const checkpoints = normaliseCheckpoints(cache?.blockCheckpoints)
    .filter((checkpoint) => checkpoint.block >= startBlock && checkpoint.block <= endBlock)
  const selected = checkpoints.slice(-rounds)
  const scanStartBlock = selected.length ? Math.max(startBlock, selected[0].block) : startBlock
  return {
    campaignStartBlock: startBlock,
    scanStartBlock,
    toBlock: endBlock,
    lookbackRounds: rounds,
    selectedCheckpoints: selected,
    mode: selected.length ? 'checkpoint-lookback' : 'initial-full-scan',
  }
}

export function mergePokemon30EventCache({ cache, window, purchases, buybacks, updatedAt = Date.now() }) {
  const timestamp = positiveInteger(updatedAt) || Date.now()
  const next = emptyCache()
  const startBlock = positiveInteger(window?.scanStartBlock)
  const toBlock = positiveInteger(window?.toBlock)
  if (!startBlock || !toBlock || toBlock < startBlock) {
    throw cacheError('Pokémon 30 event cache cannot be updated without a valid scanned block range.', 'pokemon30_scan_window_invalid')
  }
  const previous = cache || emptyCache()
  next.sources.checkout = mergeSource(previous.sources?.checkout, purchases || [], startBlock, toBlock, timestamp)
  next.sources.buyback = mergeSource(previous.sources?.buyback, buybacks || [], startBlock, toBlock, timestamp)
  const checkpoints = new Map(normaliseCheckpoints(previous.blockCheckpoints).map((checkpoint) => [checkpoint.block, checkpoint]))
  checkpoints.set(toBlock, { block: toBlock, updatedAt: timestamp })
  next.blockCheckpoints = [...checkpoints.values()]
    .sort((left, right) => left.block - right.block)
    .slice(-240)
  return next
}

export function writePokemon30EventCache(path, cache) {
  if (!path) throw cacheError('Pokémon 30 event cache path is required.', 'pokemon30_event_cache_path_missing')
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`)
  renameSync(temporaryPath, path)
}
