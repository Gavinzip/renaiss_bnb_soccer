import { getAddress } from 'ethers'

import { blockByTimestamp, fetchLogsWindow } from '../lucky-draw/bscscan.mjs'
import {
  BSC_USDT,
  POKEMON30_EVENT_END,
  POKEMON30_EVENT_START,
  VRF_V3_BUYBACK_SUCCESS_TOPIC,
  VRF_V3_CHECKOUT_SUCCESS_TOPIC,
  VRF_V3_CONTRACT,
  VRF_V3_INTERFACE,
} from './rules.mjs'

function normaliseAddress(value) {
  try {
    return getAddress(String(value || '')).toLowerCase()
  } catch {
    return ''
  }
}

function normaliseHash(value) {
  const hash = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{64}$/.test(hash) ? hash : ''
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function decodeCheckoutSuccess(log) {
  try {
    const decoded = VRF_V3_INTERFACE.parseLog({ topics: log.topics, data: log.data })
    const walletAddress = normaliseAddress(decoded.args.user)
    const packId = String(decoded.args.packId || '').toLowerCase()
    const token = normaliseAddress(decoded.args.token)
    const checkoutIds = Array.from(decoded.args.checkoutIds || []).map((value) => String(value).toLowerCase())
    const txHash = normaliseHash(log.transactionHash)
    const blockNumber = numberValue(log.blockNumber)
    const timestamp = numberValue(log.timeStamp)
    const logIndex = numberValue(log.logIndex)
    if (!walletAddress || !/^0x[a-f0-9]{64}$/.test(packId) || !token || checkoutIds.length === 0 || !txHash || !blockNumber || !timestamp || !Number.isSafeInteger(Number(log.logIndex))) {
      return null
    }
    return {
      walletAddress,
      packId,
      token,
      checkoutIds,
      totalAmount: decoded.args.totalAmount.toString(),
      txHash,
      logIndex,
      blockNumber,
      timestamp,
    }
  } catch {
    return null
  }
}

function decodeBuybackSuccess(log) {
  try {
    const decoded = VRF_V3_INTERFACE.parseLog({ topics: log.topics, data: log.data })
    const walletAddress = normaliseAddress(decoded.args.user)
    const token = normaliseAddress(decoded.args.token)
    const buybackIds = Array.from(decoded.args.buybackIds || []).map((value) => String(value).toLowerCase())
    const txHash = normaliseHash(log.transactionHash)
    const blockNumber = numberValue(log.blockNumber)
    const timestamp = numberValue(log.timeStamp)
    const logIndex = numberValue(log.logIndex)
    if (!walletAddress || !token || !txHash || !blockNumber || !timestamp || !Number.isSafeInteger(Number(log.logIndex))) return null
    return {
      walletAddress,
      token,
      amountWei: decoded.args.amount.toString(),
      buybackIds,
      txHash,
      logIndex,
      blockNumber,
      timestamp,
    }
  } catch {
    return null
  }
}

function shouldSplitLogRange(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('timeout')
    || message.includes('rate limit')
    || message.includes('server busy')
    || message.includes('temporarily unavailable')
    || message.includes('query timeout')
    || message.includes('result window')
    || message.includes('http 5')
}

async function fetchRangeAdaptive(config, { eventTopic, fromBlock, toBlock, pageSize }) {
  const rows = []
  let calls = 0
  let splitWindows = 0

  async function visit(rangeStart, rangeEnd) {
    const rangeRows = []
    try {
      for (let page = 1; page <= 100; page += 1) {
        calls += 1
        const current = await fetchLogsWindow(config, {
          address: VRF_V3_CONTRACT,
          topic0: eventTopic,
          fromBlock: rangeStart,
          toBlock: rangeEnd,
          page,
          offset: pageSize,
        })
        rangeRows.push(...current)
        if (current.length < pageSize) break
        if (page === 100) throw new Error(`V3 log pagination exceeded 100 pages for ${rangeStart}-${rangeEnd}.`)
      }
    } catch (error) {
      if (!shouldSplitLogRange(error) || rangeStart >= rangeEnd) throw error
      const middle = Math.floor((rangeStart + rangeEnd) / 2)
      if (middle < rangeStart || middle >= rangeEnd) throw error
      splitWindows += 1
      await visit(rangeStart, middle)
      await visit(middle + 1, rangeEnd)
      return
    }
    rows.push(...rangeRows)
  }

  await visit(fromBlock, toBlock)
  return { rows, calls, splitWindows }
}

export async function scanPokemon30VrfV3Purchases({
  apiKey,
  apiUrl,
  chainId = 56,
  retries = 5,
  backoffMs = 900,
  requestTimeoutMs = 30_000,
  fromBlock = 0,
  toBlock = 0,
  blockChunk = 4_000,
  pageSize = 1_000,
  paymentToken = BSC_USDT,
  packs = [],
}) {
  if (!Array.isArray(packs) || packs.length === 0) throw new Error('Configured Pokémon 30 pack rules are required before scanning V3 purchases.')

  const now = Math.floor(Date.now() / 1000)
  const windowEnd = Math.min(POKEMON30_EVENT_END, now)
  if (windowEnd < POKEMON30_EVENT_START && !fromBlock && !toBlock) {
    return {
      source: {
        contract: VRF_V3_CONTRACT,
        eventTopic: VRF_V3_CHECKOUT_SUCCESS_TOPIC,
        notStarted: true,
        campaignStart: POKEMON30_EVENT_START,
        campaignEnd: POKEMON30_EVENT_END,
        windowEnd,
        calls: 0,
        splitWindows: 0,
      },
      purchases: [],
      allPurchases: [],
      rejected: [],
    }
  }
  if (!String(apiKey || '').trim()) throw new Error('BSCSCAN_API_KEY is required for the read-only V3 purchase scan.')
  const config = { apiKey, apiUrl, chainId, retries, backoffMs, requestTimeoutMs }
  const startBlock = fromBlock || await blockByTimestamp(config, POKEMON30_EVENT_START, 'after')
  const endBlock = toBlock || await blockByTimestamp(config, windowEnd, 'before')
  if (!startBlock || !endBlock || endBlock < startBlock) throw new Error('Could not resolve a valid Pokémon 30 campaign block range.')

  const packIds = new Set(packs.map((pack) => pack.packId))
  const accepted = []
  const allAccepted = []
  const rejected = []
  const seenTransactionLogs = new Set()
  let calls = 0
  let splitWindows = 0

  for (let rangeStart = startBlock; rangeStart <= endBlock; rangeStart += blockChunk) {
    const rangeEnd = Math.min(endBlock, rangeStart + blockChunk - 1)
    const range = await fetchRangeAdaptive(config, {
      eventTopic: VRF_V3_CHECKOUT_SUCCESS_TOPIC,
      fromBlock: rangeStart,
      toBlock: rangeEnd,
      pageSize,
    })
    calls += range.calls
    splitWindows += range.splitWindows
    const logs = range.rows
    for (const log of logs) {
      const decoded = decodeCheckoutSuccess(log)
      const logKey = `${decoded?.txHash || log.transactionHash}:${log.logIndex}`
      if (seenTransactionLogs.has(logKey)) continue
      seenTransactionLogs.add(logKey)
      if (!decoded) {
        rejected.push({ reason: 'checkout_success_decode_failed', txHash: normaliseHash(log.transactionHash) || null })
        continue
      }
      if (decoded.timestamp < POKEMON30_EVENT_START || decoded.timestamp >= POKEMON30_EVENT_END) continue
      if (decoded.token !== normaliseAddress(paymentToken)) {
        rejected.push({ reason: 'unexpected_payment_token', txHash: decoded.txHash })
        continue
      }
      allAccepted.push(decoded)
      if (!packIds.has(decoded.packId)) continue
      accepted.push(decoded)
    }
  }

  return {
    source: { contract: VRF_V3_CONTRACT, eventTopic: VRF_V3_CHECKOUT_SUCCESS_TOPIC, startBlock, endBlock, windowEnd, calls, splitWindows },
    purchases: accepted,
    allPurchases: allAccepted,
    rejected,
  }
}

export async function scanPokemon30VrfV3Buybacks({
  apiKey,
  apiUrl,
  chainId = 56,
  retries = 5,
  backoffMs = 900,
  requestTimeoutMs = 30_000,
  fromBlock = 0,
  toBlock = 0,
  blockChunk = 4_000,
  pageSize = 1_000,
  paymentToken = BSC_USDT,
}) {
  const now = Math.floor(Date.now() / 1000)
  const windowEnd = Math.min(POKEMON30_EVENT_END, now)
  if (windowEnd < POKEMON30_EVENT_START && !fromBlock && !toBlock) {
    return {
      source: {
        contract: VRF_V3_CONTRACT,
        eventTopic: VRF_V3_BUYBACK_SUCCESS_TOPIC,
        notStarted: true,
        campaignStart: POKEMON30_EVENT_START,
        campaignEnd: POKEMON30_EVENT_END,
        windowEnd,
        calls: 0,
        splitWindows: 0,
      },
      buybacks: [],
      rejected: [],
    }
  }
  if (!String(apiKey || '').trim()) throw new Error('BSCSCAN_API_KEY is required for the read-only V3 buyback scan.')
  const config = { apiKey, apiUrl, chainId, retries, backoffMs, requestTimeoutMs }
  const startBlock = fromBlock || await blockByTimestamp(config, POKEMON30_EVENT_START, 'after')
  const endBlock = toBlock || await blockByTimestamp(config, windowEnd, 'before')
  if (!startBlock || !endBlock || endBlock < startBlock) throw new Error('Could not resolve a valid Pokémon 30 campaign block range.')

  const accepted = []
  const rejected = []
  const seenTransactionLogs = new Set()
  let calls = 0
  let splitWindows = 0

  for (let rangeStart = startBlock; rangeStart <= endBlock; rangeStart += blockChunk) {
    const rangeEnd = Math.min(endBlock, rangeStart + blockChunk - 1)
    const range = await fetchRangeAdaptive(config, {
      eventTopic: VRF_V3_BUYBACK_SUCCESS_TOPIC,
      fromBlock: rangeStart,
      toBlock: rangeEnd,
      pageSize,
    })
    calls += range.calls
    splitWindows += range.splitWindows
    for (const log of range.rows) {
      const decoded = decodeBuybackSuccess(log)
      const logKey = `${decoded?.txHash || log.transactionHash}:${log.logIndex}`
      if (seenTransactionLogs.has(logKey)) continue
      seenTransactionLogs.add(logKey)
      if (!decoded) {
        rejected.push({ reason: 'buyback_success_decode_failed', txHash: normaliseHash(log.transactionHash) || null })
        continue
      }
      if (decoded.timestamp < POKEMON30_EVENT_START || decoded.timestamp >= POKEMON30_EVENT_END) continue
      if (decoded.token !== normaliseAddress(paymentToken)) {
        rejected.push({ reason: 'unexpected_buyback_token', txHash: decoded.txHash })
        continue
      }
      if (decoded.buybackIds.length !== 1) {
        rejected.push({ reason: 'buyback_id_count_not_one', txHash: decoded.txHash, buybackIdCount: decoded.buybackIds.length })
        continue
      }
      accepted.push({
        walletAddress: decoded.walletAddress,
        buybackId: decoded.buybackIds[0],
        amountWei: decoded.amountWei,
        txHash: decoded.txHash,
        logIndex: decoded.logIndex,
        blockNumber: decoded.blockNumber,
        timestamp: decoded.timestamp,
      })
    }
  }

  return {
    source: { contract: VRF_V3_CONTRACT, eventTopic: VRF_V3_BUYBACK_SUCCESS_TOPIC, startBlock, endBlock, windowEnd, calls, splitWindows },
    buybacks: accepted,
    rejected,
  }
}
