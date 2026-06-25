import { blockByTimestamp, fetchLogsWindow } from './bscscan.mjs'
import { readJsonCache, writeJsonCache } from './cache.mjs'
import {
  BUYBACK_SUCCESS_V3_EVENT_TOPIC,
  describePackEventSources,
  getCampaignWindow,
  getPackEventSources,
} from './rules.mjs'
import {
  hexToBigIntText,
  normalizeAddress,
  normalizeHash,
  toNumber,
  topicToAddress,
} from './utils.mjs'

function sourceCacheKey(source, campaignStart, campaignEnd) {
  return [
    source.cacheKind || source.eventKind || 'logs',
    source.contract,
    source.eventTopic,
    source.topic1 || '',
    source.topic2 || '',
    source.topic3 || '',
    source.pack || '',
    source.ticketWeight || '',
    source.buybackContract || '',
    campaignStart,
    campaignEnd,
  ].join('|')
}

function eventKey(event) {
  return `${event.contractAddress}:${event.txHash}:${event.logIndex}`
}

function sortEvents(events) {
  return events.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex
    if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp
    if (left.txHash !== right.txHash) return left.txHash.localeCompare(right.txHash)
    return String(left.id).localeCompare(String(right.id))
  })
}

function dedupeEvents(events) {
  const byKey = new Map()
  for (const event of events) byKey.set(eventKey(event), event)
  return sortEvents([...byKey.values()])
}

function decodeBuybackEventLog(log, contractConfig) {
  const topics = Array.isArray(log.topics) ? log.topics : []
  const userAddress = topicToAddress(topics[1])
  const txHash = normalizeHash(log.transactionHash)
  if (!userAddress || !txHash) return null

  const data = String(log.data || '').replace(/^0x/, '')
  const words = data.match(/.{1,64}/g) || []
  const paymentToken = words[0] ? normalizeAddress(`0x${words[0].slice(-40)}`) : ''
  const priceInUsdt = words[1] ? BigInt(`0x${words[1]}`).toString() : null
  const fmvPriceInUsd = words[2] ? BigInt(`0x${words[2]}`).toString() : null

  return {
    id: `${txHash}-${toNumber(log.logIndex)}`,
    canonicalAddress: userAddress,
    sourceAddress: userAddress,
    txHash,
    timestamp: toNumber(log.timeStamp),
    blockNumber: toNumber(log.blockNumber),
    transactionIndex: toNumber(log.transactionIndex),
    logIndex: toNumber(log.logIndex),
    ordinal: toNumber(log.logIndex),
    contractAddress: normalizeAddress(log.address),
    pack: contractConfig.pack,
    ticketWeight: contractConfig.ticketWeight,
    itemName: contractConfig.label,
    eventKind: contractConfig.eventKind,
    checkoutId: String(topics[2] || '').toLowerCase() || null,
    tokenId: hexToBigIntText(topics[3]) || null,
    priceInUsdt,
    fmvPriceInUsd,
    paymentToken,
  }
}

function decodeLegacyPackOpenLog(log, contractConfig) {
  const topics = Array.isArray(log.topics) ? log.topics : []
  const userAddress = topicToAddress(topics[1])
  const checkoutId = normalizeHash(topics[3])
  const txHash = normalizeHash(log.transactionHash)
  if (!userAddress || !checkoutId || !txHash) return null

  const data = String(log.data || '').replace(/^0x/, '')
  const words = data.match(/.{1,64}/g) || []
  const priceInUsdt = words[0] ? BigInt(`0x${words[0]}`).toString() : null

  return {
    id: `${txHash}-${toNumber(log.logIndex)}`,
    canonicalAddress: userAddress,
    sourceAddress: userAddress,
    txHash,
    timestamp: toNumber(log.timeStamp),
    blockNumber: toNumber(log.blockNumber),
    transactionIndex: toNumber(log.transactionIndex),
    logIndex: toNumber(log.logIndex),
    ordinal: toNumber(log.logIndex),
    contractAddress: normalizeAddress(log.address),
    pack: contractConfig.pack,
    ticketWeight: contractConfig.ticketWeight,
    itemName: contractConfig.label,
    eventKind: contractConfig.eventKind,
    checkoutId,
    tokenId: null,
    priceInUsdt,
    fmvPriceInUsd: null,
    paymentToken: '',
  }
}

function decodeBuybackSuccessV3Log(log, contractConfig) {
  const topics = Array.isArray(log.topics) ? log.topics : []
  const userAddress = topicToAddress(topics[1])
  const checkoutId = normalizeHash(topics[2])
  const txHash = normalizeHash(log.transactionHash)
  if (!userAddress || !checkoutId || !txHash) return null

  const data = String(log.data || '').replace(/^0x/, '')
  const words = data.match(/.{1,64}/g) || []
  const paymentToken = words[0] ? normalizeAddress(`0x${words[0].slice(-40)}`) : ''
  const amount = words[1] ? BigInt(`0x${words[1]}`).toString() : null
  const fmvInUsd = words[2] ? BigInt(`0x${words[2]}`).toString() : null

  return {
    id: `${txHash}-${toNumber(log.logIndex)}`,
    userAddress,
    sourceAddress: userAddress,
    checkoutId,
    txHash,
    timestamp: toNumber(log.timeStamp),
    blockNumber: toNumber(log.blockNumber),
    transactionIndex: toNumber(log.transactionIndex),
    logIndex: toNumber(log.logIndex),
    ordinal: toNumber(log.logIndex),
    contractAddress: normalizeAddress(log.address || contractConfig.contract),
    paymentToken,
    amount,
    fmvInUsd,
    eventKind: 'buyback-success-v3',
  }
}

function decodeTicketEventLog(log, contractConfig) {
  if (contractConfig.eventKind === 'legacy-pack-open') return decodeLegacyPackOpenLog(log, contractConfig)
  return decodeBuybackEventLog(log, contractConfig)
}

function shouldSplitLogWindow(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('server busy') ||
    message.includes('http 5')
  )
}

async function fetchLogsWindowAdaptive(bscscanConfig, contract, fromBlock, toBlock, offset, args) {
  const rows = []
  let calls = 0
  let splitWindows = 0

  async function fetchRange(rangeStart, rangeEnd) {
    const rangeRows = []
    let page = 1

    try {
      while (true) {
        calls += 1
        const pageRows = await fetchLogsWindow(bscscanConfig, {
          address: contract.contract,
          fromBlock: rangeStart,
          toBlock: rangeEnd,
          topic0: contract.eventTopic,
          topic1: contract.topic1,
          topic2: contract.topic2,
          topic3: contract.topic3,
          page,
          offset,
        })
        rangeRows.push(...pageRows)

        if (pageRows.length < offset) break
        page += 1
      }
    } catch (error) {
      if (!shouldSplitLogWindow(error) || rangeStart >= rangeEnd) throw error

      const middleBlock = Math.floor((rangeStart + rangeEnd) / 2)
      if (middleBlock < rangeStart || middleBlock >= rangeEnd) throw error
      splitWindows += 1
      if (args.progress) {
        console.log(`[onchain] ${contract.label}: split block ${rangeStart}-${rangeEnd} after ${error.message}`)
      }
      await fetchRange(rangeStart, middleBlock)
      await fetchRange(middleBlock + 1, rangeEnd)
      return
    }

    rows.push(...rangeRows)
  }

  await fetchRange(fromBlock, toBlock)
  return { rows, calls, splitWindows }
}

async function scanLogSource({
  bscscanConfig,
  source,
  fromBlock,
  toBlock,
  args,
  eventCache,
  eventCachePath,
  campaignStart,
  campaignEnd,
  decoder,
}) {
  const cacheKey = sourceCacheKey(source, campaignStart, campaignEnd)
  const cachedSource = args.refreshCache ? null : eventCache.sources[cacheKey]
  const cachedEventsAll = Array.isArray(cachedSource?.events) ? cachedSource.events : []
  const cachedFromBlock = toNumber(cachedSource?.fromBlock)
  const cachedToBlock = toNumber(cachedSource?.toBlock)
  const overlapBlocks = Math.max(0, toNumber(args.eventCacheOverlapBlocks) || 0)
  let scanStart = fromBlock
  let cachedEvents = []

  if (cachedSource && cachedFromBlock <= fromBlock && cachedToBlock >= fromBlock) {
    scanStart = Math.max(fromBlock, Math.min(toBlock + 1, cachedToBlock - overlapBlocks + 1))
    cachedEvents = cachedEventsAll.filter((event) => {
      const block = toNumber(event.blockNumber)
      return block >= fromBlock && block < scanStart && block <= toBlock
    })
  }

  const blockChunk = Math.max(100, toNumber(args.blockChunk) || 5000)
  const offset = Math.max(1, Math.min(1000, toNumber(args.pageSize) || 1000))
  const fetchedEvents = []
  let cursor = scanStart
  let calls = 0
  let splitWindows = 0

  while (cursor <= toBlock) {
    const chunkEnd = Math.min(toBlock, cursor + blockChunk - 1)
    const result = await fetchLogsWindowAdaptive(
      bscscanConfig,
      source,
      cursor,
      chunkEnd,
      offset,
      args,
    )
    calls += result.calls
    splitWindows += result.splitWindows

    for (const row of result.rows) {
      const event = decoder(row, source)
      if (!event) continue
      if (event.timestamp < campaignStart || event.timestamp > campaignEnd) continue
      fetchedEvents.push(event)
    }

    if (args.progress && (calls === 1 || calls % 25 === 0)) {
      console.log(
        `[onchain] ${source.label}: block ${cursor}-${chunkEnd}, cached=${cachedEvents.length} fetched=${fetchedEvents.length} split=${splitWindows}`,
      )
    }

    cursor = chunkEnd + 1
  }

  const sourceEvents = dedupeEvents([...cachedEvents, ...fetchedEvents])
  if (eventCachePath) {
    const retainedEvents = args.refreshCache
      ? []
      : cachedEventsAll.filter((event) => {
          const block = toNumber(event.blockNumber)
          return block < scanStart || block > toBlock
        })
    const mergedCacheEvents = dedupeEvents([...retainedEvents, ...sourceEvents])
    eventCache.sources[cacheKey] = {
      contract: source.contract,
      label: source.label,
      pack: source.pack || null,
      eventKind: source.eventKind || source.cacheKind || null,
      fromBlock: cachedFromBlock && !args.refreshCache ? Math.min(cachedFromBlock, fromBlock) : fromBlock,
      toBlock: cachedToBlock && !args.refreshCache ? Math.max(cachedToBlock, toBlock) : toBlock,
      updatedAt: Date.now(),
      events: mergedCacheEvents,
    }
    writeJsonCache(eventCachePath, eventCache)
  }

  return {
    events: sourceEvents,
    stats: {
      calls,
      splitWindows,
      cachedEvents: cachedEvents.length,
      fetchedEvents: fetchedEvents.length,
      cacheToBlock: eventCache.sources[cacheKey]?.toBlock ?? null,
    },
  }
}

function buybackSuccessByCheckout(successEvents) {
  const sorted = sortEvents([...successEvents])
  const byCheckoutId = new Map()
  for (const event of sorted) {
    if (!byCheckoutId.has(event.checkoutId)) byCheckoutId.set(event.checkoutId, event)
  }
  return byCheckoutId
}

function matchLegacyBuybackEvents(openEvents, buybackSuccessEvents, contractConfig) {
  const byCheckoutId = buybackSuccessByCheckout(buybackSuccessEvents)
  const matchedEvents = []
  let unmatchedOpens = 0
  let wrongUser = 0

  for (const openEvent of openEvents) {
    const checkoutId = normalizeHash(openEvent.checkoutId)
    const successEvent = byCheckoutId.get(checkoutId)
    if (!successEvent) {
      unmatchedOpens += 1
      continue
    }

    if (successEvent.userAddress !== openEvent.sourceAddress) {
      wrongUser += 1
      unmatchedOpens += 1
      continue
    }

    matchedEvents.push({
      ...openEvent,
      id: successEvent.id,
      txHash: successEvent.txHash,
      timestamp: successEvent.timestamp,
      blockNumber: successEvent.blockNumber,
      transactionIndex: successEvent.transactionIndex,
      logIndex: successEvent.logIndex,
      ordinal: successEvent.ordinal,
      contractAddress: successEvent.contractAddress || normalizeAddress(contractConfig.buybackContract),
      eventKind: 'legacy-buyback-success-v3',
      tokenId: openEvent.tokenId,
      priceInUsdt: successEvent.amount || openEvent.priceInUsdt,
      fmvPriceInUsd: successEvent.fmvInUsd || openEvent.fmvPriceInUsd,
      paymentToken: successEvent.paymentToken || openEvent.paymentToken,
      legacyOpenTxHash: openEvent.txHash,
      legacyOpenTimestamp: openEvent.timestamp,
      legacyOpenBlockNumber: openEvent.blockNumber,
      legacyOpenLogIndex: openEvent.logIndex,
    })
  }

  return {
    events: matchedEvents,
    matchedBuybacks: matchedEvents.length,
    unmatchedOpens,
    wrongUser,
  }
}

function buybackSuccessSourcesFor(contracts) {
  const byContract = new Map()
  for (const source of contracts) {
    if (source.eventKind !== 'legacy-pack-open') continue
    const buybackContract = normalizeAddress(source.buybackContract || source.contract)
    if (!buybackContract || byContract.has(buybackContract)) continue
    byContract.set(buybackContract, {
      cacheKind: 'buyback-success-v3',
      contract: buybackContract,
      label: `BuybackSuccessV3 ${buybackContract.slice(0, 10)}`,
      eventTopic: BUYBACK_SUCCESS_V3_EVENT_TOPIC,
      eventKind: 'buyback-success-v3',
    })
  }
  return [...byContract.values()]
}

export async function scanOnchainTicketEvents(args) {
  if (!args.bscscanApiKey) {
    throw new Error(
      'BSCSCAN_API_KEY is required for complete contract log scans. Pass --env-file or set BSCSCAN_API_KEY.',
    )
  }

  const { campaignStart, campaignEnd } = getCampaignWindow(args)
  const bscscanConfig = {
    apiUrl: args.bscscanApiUrl,
    apiKey: args.bscscanApiKey,
    chainId: args.bscscanChainId,
    retries: args.retries,
    backoffMs: args.backoffMs,
    requestTimeoutMs: args.bscscanRequestTimeoutMs,
  }
  const nowTs = Math.floor(Date.now() / 1000)
  const windowEndTs = Math.min(campaignEnd, nowTs)
  const fromBlock = args.fromBlock || (await blockByTimestamp(bscscanConfig, campaignStart, 'after'))
  const toBlock = args.toBlock || (await blockByTimestamp(bscscanConfig, windowEndTs, 'before'))
  const packEventSources = getPackEventSources(args.extraLegacyPacksRaw)
  const contracts = packEventSources.filter(
    (source) => !args.contracts.length || args.contracts.includes(source.contract),
  )

  if (!contracts.length) throw new Error('No eligible ticket event sources configured for scan.')

  const eventCachePath = args.noCache ? '' : args.eventCachePath
  const eventCache = readJsonCache(eventCachePath, { version: 2, sources: {} }) || {
    version: 2,
    sources: {},
  }
  eventCache.sources ||= {}

  const successSources = buybackSuccessSourcesFor(contracts)
  const successByContract = new Map()
  const successStats = []

  for (const successSource of successSources) {
    const result = await scanLogSource({
      bscscanConfig,
      source: successSource,
      fromBlock,
      toBlock,
      args,
      eventCache,
      eventCachePath,
      campaignStart,
      campaignEnd,
      decoder: decodeBuybackSuccessV3Log,
    })
    successByContract.set(successSource.contract, result.events)
    successStats.push({
      contract: successSource.contract,
      label: successSource.label,
      eventKind: successSource.eventKind,
      events: result.events.length,
      ...result.stats,
    })
  }

  const allEvents = []
  const scanStats = []
  for (const contract of contracts) {
    const result = await scanLogSource({
      bscscanConfig,
      source: contract,
      fromBlock,
      toBlock,
      args,
      eventCache,
      eventCachePath,
      campaignStart,
      campaignEnd,
      decoder: decodeTicketEventLog,
    })

    const buybackContract = normalizeAddress(contract.buybackContract || contract.contract)
    const legacyMatch =
      contract.eventKind === 'legacy-pack-open'
        ? matchLegacyBuybackEvents(result.events, successByContract.get(buybackContract) || [], contract)
        : null
    const ledgerEvents = legacyMatch ? legacyMatch.events : result.events
    allEvents.push(...ledgerEvents)

    scanStats.push({
      contract: contract.contract,
      label: contract.label,
      pack: contract.pack,
      eventKind: contract.eventKind,
      packId: contract.packId || contract.topic2 || null,
      buybackContract: contract.buybackContract || null,
      configSource: contract.configSource || 'built-in',
      calls: result.stats.calls,
      events: ledgerEvents.length,
      openEvents: legacyMatch ? result.events.length : undefined,
      matchedBuybacks: legacyMatch?.matchedBuybacks,
      unmatchedOpens: legacyMatch?.unmatchedOpens,
      wrongUser: legacyMatch?.wrongUser,
      cachedEvents: result.stats.cachedEvents,
      fetchedEvents: result.stats.fetchedEvents,
      cacheToBlock: result.stats.cacheToBlock,
      splitWindows: result.stats.splitWindows,
    })
  }

  if (eventCachePath) writeJsonCache(eventCachePath, eventCache)
  sortEvents(allEvents)

  return {
    events: allEvents,
    source: {
      mode: 'contract-events-chain-only',
      fromBlock,
      toBlock,
      campaignStart,
      campaignEnd,
      packEventSources: describePackEventSources(contracts),
      buybackSuccessEventTopic: BUYBACK_SUCCESS_V3_EVENT_TOPIC,
      successContracts: successStats,
      contracts: scanStats,
    },
  }
}
