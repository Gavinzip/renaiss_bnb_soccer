import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_TASK_REWARD_TICKETS = 1

const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i
const FIREFLY_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function envEnabled(value, defaultValue = true) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return defaultValue
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  return defaultValue
}

function toTicketInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return WALLET_ADDRESS_PATTERN.test(address) ? address : ''
}

function cleanFireflyUid(value) {
  const uid = String(value ?? '').trim()
  return FIREFLY_UID_PATTERN.test(uid) ? uid : ''
}

function entryAddresses(entry) {
  return [
    entry?.userAddress,
    ...(Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : []),
  ].map(normalizeAddress).filter(Boolean)
}

function recordFireflyUid(record) {
  return cleanFireflyUid(record?.fireflyUid ?? record?.ffAccountUid ?? record?.ff_account_uid)
}

function recordCompletedTask(record) {
  return Boolean(record?.eligible && recordFireflyUid(record))
}

export function createTaskRewardTicketConfig(env = process.env) {
  const dataDir = env.SOCCER_DATA_DIR || env.LUCKY_DRAW_DATA_DIR || '/data/soccer'
  const authDir = env.SOCCER_AUTH_DIR || join(dataDir, 'auth')

  return {
    enabled: envEnabled(env.SOCCER_TASK_REWARD_TICKETS_ENABLED, true),
    ticketsPerWallet: toTicketInteger(env.SOCCER_TASK_REWARD_TICKETS || DEFAULT_TASK_REWARD_TICKETS),
    statePath: String(
      env.SOCCER_TASK_REWARD_STATE_PATH
        || env.SOCCER_TASK_REWARD_ELIGIBILITY_PATH
        || env.FIREFLY_X_ACCOUNT_ELIGIBILITY_STATE_PATH
        || join(authDir, 'x-account-eligibility.json'),
    ),
  }
}

export function taskRewardStateMtimeMs(config) {
  if (!config?.enabled || !config.statePath || !existsSync(config.statePath)) return -1
  try {
    return statSync(config.statePath).mtimeMs
  } catch {
    return -1
  }
}

export function readCompletedTaskWallets(config) {
  if (!config?.enabled || config.ticketsPerWallet <= 0 || !config.statePath || !existsSync(config.statePath)) {
    return []
  }

  const payload = JSON.parse(readFileSync(config.statePath, 'utf8'))
  const checks = payload?.checks && typeof payload.checks === 'object' ? payload.checks : {}
  const wallets = new Set()

  for (const record of Object.values(checks)) {
    if (!record || typeof record !== 'object' || !recordCompletedTask(record)) continue
    const walletAddress = normalizeAddress(record.walletAddress)
    if (walletAddress) wallets.add(walletAddress)
  }

  return [...wallets].sort()
}

function createTaskRewardEntry(walletAddress, tickets) {
  return {
    userAddress: walletAddress,
    sourceAddresses: [walletAddress],
    packs: {},
    rawTickets: 0,
    bonusTickets: 0,
    carryoverTickets: 0,
    insiderPracticeTickets: 0,
    insiderGrantTickets: tickets,
    taskRewardTickets: tickets,
    finalTickets: 0,
    totalVotingTickets: tickets,
    eventCount: 0,
    firstBuybackAt: null,
    lastBuybackAt: null,
    ticketStart: null,
    ticketEnd: null,
    ticketIntervals: [],
    taskRewardSource: 'x-account-eligibility',
  }
}

export function applyTaskRewardTickets(ledger, config = createTaskRewardTicketConfig()) {
  const source = {
    enabled: Boolean(config.enabled),
    statePath: config.statePath || null,
    ticketsPerWallet: toTicketInteger(config.ticketsPerWallet),
    completedWallets: 0,
    appliedWallets: 0,
    totalTaskRewardTickets: 0,
  }

  if (!ledger || typeof ledger !== 'object') return ledger
  if (!source.enabled || source.ticketsPerWallet <= 0) {
    return {
      ...ledger,
      taskRewardTicketSource: source,
    }
  }

  const rewardWallets = readCompletedTaskWallets(config)
  source.completedWallets = rewardWallets.length
  if (rewardWallets.length === 0) {
    return {
      ...ledger,
      taskRewardTicketSource: source,
    }
  }

  const entries = Array.isArray(ledger.entries) ? ledger.entries.map((entry) => ({ ...entry })) : []
  const entriesByAddress = new Map()
  for (const entry of entries) {
    for (const address of entryAddresses(entry)) {
      if (!entriesByAddress.has(address)) entriesByAddress.set(address, entry)
    }
  }

  for (const walletAddress of rewardWallets) {
    const tickets = source.ticketsPerWallet
    let entry = entriesByAddress.get(walletAddress)
    if (!entry) {
      entry = createTaskRewardEntry(walletAddress, tickets)
      entries.push(entry)
      entriesByAddress.set(walletAddress, entry)
    } else {
      const previousTaskRewardTickets = toTicketInteger(entry.taskRewardTickets ?? entry.task_reward_tickets)
      const baseInsiderGrantTickets = Math.max(
        0,
        toTicketInteger(entry.insiderGrantTickets ?? entry.insider_grant_tickets) - previousTaskRewardTickets,
      )
      entry.taskRewardTickets = tickets
      entry.insiderGrantTickets = baseInsiderGrantTickets + tickets
      entry.totalVotingTickets =
        toTicketInteger(entry.rawTickets ?? entry.raw_tickets)
        + toTicketInteger(entry.carryoverTickets ?? entry.carryover_tickets)
        + toTicketInteger(entry.insiderPracticeTickets ?? entry.insider_practice_tickets)
        + toTicketInteger(entry.insiderGrantTickets ?? entry.insider_grant_tickets)
      entry.taskRewardSource = 'x-account-eligibility'
    }
    source.appliedWallets += 1
    source.totalTaskRewardTickets += tickets
  }

  return {
    ...ledger,
    entries,
    taskRewardTicketSource: source,
  }
}
