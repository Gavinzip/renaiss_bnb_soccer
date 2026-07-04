import { sleep, toNumber } from './utils.mjs'

const DEFAULT_BSCSCAN_API_URL = 'https://api.etherscan.io/v2/api'
const DEFAULT_BSCSCAN_REQUEST_TIMEOUT_MS = 30_000

function sanitizedParams(params) {
  const out = new URLSearchParams(params)
  if (out.has('apikey')) out.set('apikey', '[redacted]')
  return out.toString()
}

export async function bscscanJson(config, params) {
  const query = new URLSearchParams({
    chainid: String(config.chainId || 56),
    ...params,
    apikey: config.apiKey,
  })
  const apiUrl = config.apiUrl || DEFAULT_BSCSCAN_API_URL
  const requestTimeoutMs =
    toNumber(config.requestTimeoutMs) || DEFAULT_BSCSCAN_REQUEST_TIMEOUT_MS
  let lastError = null

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    let timeout = null

    try {
      const data = await Promise.race([
        (async () => {
          const response = await fetch(`${apiUrl}?${query}`, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
          })
          if (response.status >= 500 || response.status === 429) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true
            controller.abort()
            reject(new Error(`BscScan request timed out after ${requestTimeoutMs}ms`))
          }, requestTimeoutMs)
        }),
      ])
      const result = data?.result
      const message = String(data?.message || '').trim()
      const resultText = typeof result === 'string' ? result.toLowerCase() : ''

      if (
        message === 'No records found' ||
        resultText.includes('no records found') ||
        resultText.includes('no transactions found')
      ) {
        return { ...data, result: [] }
      }

      if (data?.status === '1' || Array.isArray(result)) return data
      if (!('status' in data) && typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result)) {
        return data
      }

      if (
        resultText.includes('max rate limit') ||
        resultText.includes('query timeout') ||
        resultText.includes('temporarily unavailable')
      ) {
        throw new Error(String(result || message || 'BscScan rate limited'))
      }

      throw new Error(`BscScan error: ${message || result || sanitizedParams(query)}`)
    } catch (error) {
      lastError = timedOut
        ? new Error(`BscScan request timed out after ${requestTimeoutMs}ms`)
        : error
      if (attempt < config.retries) {
        await sleep(config.backoffMs * 2 ** (attempt - 1))
        continue
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(`BscScan request failed: ${lastError?.message || lastError}`)
}

export async function blockByTimestamp(config, timestamp, closest) {
  const data = await bscscanJson(config, {
    module: 'block',
    action: 'getblocknobytime',
    timestamp: String(timestamp),
    closest,
  })
  const block = toNumber(data.result)
  if (!block) throw new Error(`Could not resolve block for timestamp ${timestamp}`)
  return block
}

export async function latestBlockNumber(config) {
  const data = await bscscanJson(config, {
    module: 'proxy',
    action: 'eth_blockNumber',
  })
  const block = toNumber(data.result)
  if (!block) throw new Error('Could not resolve latest block number')
  return block
}

export async function fetchLogsWindow(config, params) {
  const query = {
    module: 'logs',
    action: 'getLogs',
    address: params.address,
    fromBlock: String(params.fromBlock),
    toBlock: String(params.toBlock),
    topic0: params.topic0,
    page: String(params.page),
    offset: String(params.offset),
  }
  for (const key of ['topic1', 'topic2', 'topic3']) {
    if (params[key]) {
      query[key] = params[key]
      query[`topic0_${key.slice(-1)}_opr`] = 'and'
    }
  }

  const data = await bscscanJson(config, query)
  return Array.isArray(data.result) ? data.result : []
}
