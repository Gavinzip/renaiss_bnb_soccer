import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { stableStringify } from './lucky-draw/utils.mjs'
import { buildMatchResultIndex } from './soccer-match-results.mjs'
import {
  SHARED_INSIDER_GRANT_ROUND_IDS,
  getSharedInsiderGrantTicketsUsed,
  roundAllowsSharedInsiderGrantTickets,
} from '../src/app/data/ticketEligibility.js'
import {
  STATE_VERSION,
  allocationId,
  assertVoteInput,
  buildVotePreview,
  findRoundLedgerTickets,
  normalizeAllocation,
  normalizeAddress,
  normalizeId,
  nowIso,
  toPositiveInteger,
  unixNow,
  writeVotePreview,
  writeVoteState,
} from './soccer-vote-store.mjs'

const SQLITE_SCHEMA_VERSION = 1

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

function openDatabase(dbPath, options = {}) {
  if (!dbPath) throw new Error('SOCCER_VOTE_DB_PATH is required when SOCCER_VOTE_STORE=sqlite.')
  ensureParent(dbPath)
  const db = new Database(dbPath, options)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  return db
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vote_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vote_allocations (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      round_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      tickets INTEGER NOT NULL CHECK (tickets > 0),
      source TEXT NOT NULL,
      official INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (wallet_address, round_id, match_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS vote_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_unix INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      round_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      tickets INTEGER NOT NULL CHECK (tickets > 0),
      previous_team_tickets INTEGER NOT NULL,
      next_team_tickets INTEGER NOT NULL,
      final_round_tickets INTEGER NOT NULL,
      request_id TEXT UNIQUE,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS vote_allocations_wallet_round_idx
      ON vote_allocations (wallet_address, round_id);

    CREATE INDEX IF NOT EXISTS vote_allocations_match_team_idx
      ON vote_allocations (match_id, team_id);

    CREATE INDEX IF NOT EXISTS vote_events_wallet_round_idx
      ON vote_events (wallet_address, round_id, created_at_unix);
  `)
  addColumnIfMissing(db, 'vote_events', 'previous_hash TEXT')
  addColumnIfMissing(db, 'vote_events', 'event_hash TEXT')
  backfillVoteEventHashes(db)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS vote_events_event_hash_idx
      ON vote_events (event_hash)
      WHERE event_hash IS NOT NULL;
  `)
  db.prepare(`
    INSERT INTO vote_meta (key, value)
    VALUES ('schemaVersion', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SQLITE_SCHEMA_VERSION))
}

function addColumnIfMissing(db, tableName, definition) {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error
  }
}

function eventPayloadForHash(event) {
  const payload = event && typeof event === 'object' ? { ...event } : { value: event }
  delete payload.previousEventHash
  delete payload.eventHash
  return payload
}

function voteEventHash(previousHash, event) {
  return `sha256:${createHash('sha256')
    .update(stableStringify({
      previousHash: previousHash || null,
      event: eventPayloadForHash(event),
    }))
    .digest('hex')}`
}

function parseEventPayload(value) {
  try {
    const payload = JSON.parse(String(value || '{}'))
    return payload && typeof payload === 'object' ? payload : { value: payload }
  } catch {
    return { rawPayload: String(value || '') }
  }
}

function latestVoteEventHash(db) {
  return db.prepare(`
    SELECT event_hash
    FROM vote_events
    WHERE event_hash IS NOT NULL
    ORDER BY rowid DESC
    LIMIT 1
  `).get()?.event_hash || ''
}

function attachVoteEventHash(db, event) {
  const previousHash = latestVoteEventHash(db)
  const eventHash = voteEventHash(previousHash, event)
  return {
    ...event,
    previousEventHash: previousHash || null,
    eventHash,
  }
}

function backfillVoteEventHashes(db) {
  const rows = db.prepare(`
    SELECT rowid, payload_json, previous_hash, event_hash
    FROM vote_events
    ORDER BY rowid ASC
  `).all()
  if (!rows.length) return

  runImmediateTransaction(db, () => {
    let previousHash = ''
    const update = db.prepare(`
      UPDATE vote_events
      SET payload_json = ?, previous_hash = ?, event_hash = ?
      WHERE rowid = ?
    `)
    for (const row of rows) {
      const payload = parseEventPayload(row.payload_json)
      const hashedPayload = eventPayloadForHash(payload)
      const eventHash = voteEventHash(previousHash, hashedPayload)
      const previousEventHash = previousHash || null
      if (
        row.previous_hash !== previousEventHash
        || row.event_hash !== eventHash
        || payload.previousEventHash !== previousEventHash
        || payload.eventHash !== eventHash
      ) {
        update.run(
          JSON.stringify({
            ...hashedPayload,
            previousEventHash,
            eventHash,
          }),
          previousEventHash,
          eventHash,
          row.rowid,
        )
      }
      previousHash = eventHash
    }
  })
}

function rowToAllocation(row) {
  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    roundId: String(row.round_id),
    matchId: String(row.match_id),
    teamId: String(row.team_id),
    tickets: toPositiveInteger(row.tickets),
    source: String(row.source || 'server-vote-store-sqlite'),
    official: Boolean(row.official),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

function readMeta(db) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM vote_meta').all().map((row) => [String(row.key), String(row.value)]),
  )
}

function readVoteStateFromDatabase(db) {
  const meta = readMeta(db)
  const allocations = db.prepare(`
    SELECT id, wallet_address, round_id, match_id, team_id, tickets, source, official, created_at, updated_at
    FROM vote_allocations
    ORDER BY created_at ASC, wallet_address ASC, round_id ASC, match_id ASC, team_id ASC
  `).all().map(rowToAllocation)

  const eventCount = toPositiveInteger(db.prepare('SELECT COUNT(*) AS count FROM vote_events').get()?.count)
  const hashRow = db.prepare(`
    SELECT event_hash
    FROM vote_events
    WHERE event_hash IS NOT NULL
    ORDER BY rowid DESC
    LIMIT 1
  `).get()
  const timeRow = db.prepare(`
    SELECT MIN(created_at) AS generated_at, MAX(created_at) AS updated_at
    FROM vote_events
  `).get()

  return {
    version: STATE_VERSION,
    generatedAt: timeRow?.generated_at || null,
    updatedAt: timeRow?.updated_at || null,
    allocations,
    eventCount,
    sourceLabel: meta.sourceLabel || 'server-vote-store-sqlite',
    sourceStatus: meta.sourceStatus || 'live',
    syncedFromProductionAt: meta.syncedFromProductionAt || null,
    productionOrigin: meta.productionOrigin || null,
    eventHashHead: hashRow?.event_hash || null,
  }
}

function writeJsonSnapshots({ statePath, previewPath, state, matchResults }) {
  const snapshot = { stateWritten: false, previewWritten: false, error: null }
  try {
    if (statePath) {
      writeVoteState(statePath, state)
      snapshot.stateWritten = true
    }
    if (previewPath) {
      writeVotePreview(previewPath, state, { matchResults })
      snapshot.previewWritten = true
    }
  } catch (error) {
    snapshot.error = error instanceof Error ? error.message : 'Could not write vote JSON snapshot.'
    console.error('[vote-store-sqlite] snapshot write failed', error)
  }
  return snapshot
}

function runImmediateTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError) {
      console.error('[vote-store-sqlite] rollback failed', rollbackError)
    }
    throw error
  }
}

function submitVoteInDatabase({ db, ledger, input, matchResults }) {
  const resultIndex = buildMatchResultIndex(matchResults)
  const normalizedInput = assertVoteInput(input, { resultIndex })
  const { walletAddress, roundId, matchId, teamId, tickets } = normalizedInput
  const requestId = normalizeId(input?.requestId) || null
  const ledgerTickets = findRoundLedgerTickets(ledger, walletAddress, roundId)

  if (!ledgerTickets.entry) {
    throw Object.assign(new Error('Wallet is not in the ticket ledger.'), { statusCode: 403 })
  }

  return runImmediateTransaction(db, () => {
    if (requestId) {
      const duplicate = db.prepare('SELECT payload_json FROM vote_events WHERE request_id = ?').get(requestId)
      if (duplicate) {
        throw Object.assign(new Error('Duplicate vote requestId.'), { statusCode: 409 })
      }
    }

    const existing = db.prepare(`
      SELECT id, tickets, created_at
      FROM vote_allocations
      WHERE wallet_address = ? AND round_id = ? AND match_id = ? AND team_id = ?
    `).get(walletAddress, roundId, matchId, teamId)

    const usedOutsideCurrentTeam = toPositiveInteger(db.prepare(`
      SELECT COALESCE(SUM(tickets), 0) AS tickets
      FROM vote_allocations
      WHERE wallet_address = ?
        AND round_id = ?
        AND NOT (match_id = ? AND team_id = ?)
    `).get(walletAddress, roundId, matchId, teamId)?.tickets)

    const currentTeamTickets = toPositiveInteger(existing?.tickets)
    const nextTeamTickets = currentTeamTickets + tickets
    const nextRoundTickets = usedOutsideCurrentTeam + nextTeamTickets

    if (nextRoundTickets > ledgerTickets.usableTickets) {
      throw Object.assign(new Error('Vote amount exceeds available tickets for this round.'), {
        statusCode: 409,
        availableTickets: Math.max(0, ledgerTickets.usableTickets - usedOutsideCurrentTeam - currentTeamTickets),
        lockedRawTickets: ledgerTickets.lockedRawTickets,
        lockedCarryoverTickets: ledgerTickets.lockedCarryoverTickets,
        lockedInsiderPracticeTickets: ledgerTickets.lockedInsiderPracticeTickets,
        lockedInsiderGrantTickets: ledgerTickets.lockedInsiderGrantTickets,
      })
    }

    const sharedRoundRows = roundAllowsSharedInsiderGrantTickets(roundId)
      ? db.prepare(`
        SELECT round_id, SUM(tickets) AS tickets
        FROM vote_allocations
        WHERE wallet_address = ?
          AND round_id IN (${SHARED_INSIDER_GRANT_ROUND_IDS.map(() => '?').join(', ')})
        GROUP BY round_id
      `).all(walletAddress, ...SHARED_INSIDER_GRANT_ROUND_IDS)
      : []
    const sharedRoundAllocations = sharedRoundRows.map((row) => ({
      walletAddress,
      roundId: String(row.round_id || ''),
      matchId: '',
      teamId: '',
      tickets: toPositiveInteger(row.tickets),
    }))
    const sharedInsiderGrantTicketsUsed = roundAllowsSharedInsiderGrantTickets(roundId)
      ? getSharedInsiderGrantTicketsUsed(sharedRoundAllocations, walletAddress, ledgerTickets.entry, {
        overrideRoundId: roundId,
        overrideRoundTickets: nextRoundTickets,
      })
      : 0

    if (sharedInsiderGrantTicketsUsed > ledgerTickets.insiderGrantTickets) {
      const usedOutsideThisRound = getSharedInsiderGrantTicketsUsed(sharedRoundAllocations, walletAddress, ledgerTickets.entry, {
        excludeRoundId: roundId,
      })
      throw Object.assign(new Error('Vote amount exceeds shared insider reward tickets.'), {
        statusCode: 409,
        availableTickets: Math.max(
          0,
          ledgerTickets.baseTickets
            + Math.max(0, ledgerTickets.insiderGrantTickets - usedOutsideThisRound)
            - usedOutsideCurrentTeam
            - currentTeamTickets,
        ),
        sharedInsiderGrantTickets: ledgerTickets.insiderGrantTickets,
        sharedInsiderGrantTicketsUsed: usedOutsideThisRound,
      })
    }

    const event = attachVoteEventHash(db, {
      id: randomUUID(),
      type: 'vote-submitted',
      status: 'accepted',
      createdAt: nowIso(),
      createdAtUnix: unixNow(),
      walletAddress,
      roundId,
      matchId,
      teamId,
      tickets,
      previousTeamTickets: currentTeamTickets,
      nextTeamTickets,
      previousMatchTickets: currentTeamTickets,
      nextMatchTickets: nextTeamTickets,
      finalRoundTickets: ledgerTickets.usableTickets,
      rawRoundTickets: ledgerTickets.rawTickets,
      lockedRawTickets: ledgerTickets.lockedRawTickets,
      carryoverRoundTickets: ledgerTickets.carryoverUnlocked ? ledgerTickets.carryoverTickets : 0,
      lockedCarryoverTickets: ledgerTickets.lockedCarryoverTickets,
      insiderPracticeRoundTickets: ledgerTickets.usableInsiderPracticeTickets,
      insiderGrantRoundTickets: ledgerTickets.usableInsiderGrantTickets,
      lockedInsiderPracticeTickets: ledgerTickets.lockedInsiderPracticeTickets,
      lockedInsiderGrantTickets: ledgerTickets.lockedInsiderGrantTickets,
      sharedInsiderGrantTickets: ledgerTickets.insiderGrantTickets,
      sharedInsiderGrantTicketsUsed,
      sharedInsiderGrantTicketsRemaining: Math.max(0, ledgerTickets.insiderGrantTickets - sharedInsiderGrantTicketsUsed),
      requestId,
    })
    const id = existing?.id || allocationId({ walletAddress, matchId, teamId })

    db.prepare(`
      INSERT INTO vote_events (
        id, type, status, created_at, created_at_unix, wallet_address, round_id, match_id, team_id,
        tickets, previous_team_tickets, next_team_tickets, final_round_tickets, request_id, payload_json,
        previous_hash, event_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.type,
      event.status,
      event.createdAt,
      event.createdAtUnix,
      walletAddress,
      roundId,
      matchId,
      teamId,
      tickets,
      currentTeamTickets,
      nextTeamTickets,
      ledgerTickets.usableTickets,
      requestId,
      JSON.stringify(event),
      event.previousEventHash,
      event.eventHash,
    )

    db.prepare(`
      INSERT INTO vote_allocations (
        id, wallet_address, round_id, match_id, team_id, tickets, source, official, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'server-vote-store-sqlite', 0, ?, ?)
      ON CONFLICT(wallet_address, round_id, match_id, team_id)
      DO UPDATE SET
        tickets = excluded.tickets,
        source = excluded.source,
        official = excluded.official,
        updated_at = excluded.updated_at
    `).run(
      id,
      walletAddress,
      roundId,
      matchId,
      teamId,
      nextTeamTickets,
      existing?.created_at || event.createdAt,
      event.createdAt,
    )

    return { event, allocationId: id }
  })
}

export function readVoteStateFromSqlite({ dbPath }) {
  if (!existsSync(dbPath)) throw new Error(`SQLite vote database does not exist: ${dbPath}`)
  const db = openDatabase(dbPath, { fileMustExist: true })
  try {
    ensureSchema(db)
    return readVoteStateFromDatabase(db)
  } finally {
    db.close()
  }
}

export function replaceSqliteVoteState({
  dbPath,
  allocations,
  statePath = '',
  previewPath = '',
  matchResults = null,
  meta = {},
}) {
  const db = openDatabase(dbPath)
  ensureSchema(db)
  try {
    runImmediateTransaction(db, () => {
      db.prepare('DELETE FROM vote_events').run()
      db.prepare('DELETE FROM vote_allocations').run()
      for (const [key, value] of Object.entries(meta || {})) {
        if (value === undefined || value === null || value === '') continue
        db.prepare(`
          INSERT INTO vote_meta (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(String(key), String(value))
      }

      const allocationRows = (Array.isArray(allocations) ? allocations : []).map(normalizeAllocation).filter(Boolean)
      for (const [index, allocation] of allocationRows.entries()) {
        const createdAt = allocation.createdAt || nowIso()
        const updatedAt = allocation.updatedAt || createdAt
        const event = attachVoteEventHash(db, {
          id: randomUUID(),
          type: 'vote-seeded',
          status: 'accepted',
          createdAt,
          createdAtUnix: Math.floor(Date.parse(createdAt) / 1000) || unixNow(),
          walletAddress: allocation.walletAddress,
          roundId: allocation.roundId,
          matchId: allocation.matchId,
          teamId: allocation.teamId,
          tickets: allocation.tickets,
          previousTeamTickets: 0,
          nextTeamTickets: allocation.tickets,
          previousMatchTickets: 0,
          nextMatchTickets: allocation.tickets,
          finalRoundTickets: toPositiveInteger(allocation.finalRoundTickets || allocation.tickets),
          requestId: normalizeId(allocation.requestId) || `seed-${index + 1}-${allocation.id}`,
          source: allocation.source || 'server-vote-store-sqlite-seed',
        })

        db.prepare(`
          INSERT INTO vote_allocations (
            id, wallet_address, round_id, match_id, team_id, tickets, source, official, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          allocation.id,
          allocation.walletAddress,
          allocation.roundId,
          allocation.matchId,
          allocation.teamId,
          allocation.tickets,
          allocation.source || 'server-vote-store-sqlite-seed',
          allocation.official ? 1 : 0,
          createdAt,
          updatedAt,
        )

        db.prepare(`
          INSERT INTO vote_events (
            id, type, status, created_at, created_at_unix, wallet_address, round_id, match_id, team_id,
            tickets, previous_team_tickets, next_team_tickets, final_round_tickets, request_id, payload_json,
            previous_hash, event_hash
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id,
          event.type,
          event.status,
          event.createdAt,
          event.createdAtUnix,
          event.walletAddress,
          event.roundId,
          event.matchId,
          event.teamId,
          event.tickets,
          event.previousTeamTickets,
          event.nextTeamTickets,
          event.finalRoundTickets,
          event.requestId,
          JSON.stringify(event),
          event.previousEventHash,
          event.eventHash,
        )
      }
    })

    const state = readVoteStateFromDatabase(db)
    const snapshot = writeJsonSnapshots({ statePath, previewPath, state, matchResults })
    return { state, snapshot }
  } finally {
    db.close()
  }
}

export function createSqliteVoteStore({ dbPath, statePath = '', previewPath = '' }) {
  const db = openDatabase(dbPath)
  ensureSchema(db)

  function readState() {
    return readVoteStateFromDatabase(db)
  }

  return {
    mode: 'sqlite',
    dbPath,
    statePath,
    previewPath,
    readState,
    readPreview({ walletAddress = '', matchResults = null } = {}) {
      return buildVotePreview(readState(), {
        walletAddress: normalizeAddress(walletAddress),
        matchResults,
      })
    },
    submitVote({ ledger, input, matchResults = null }) {
      const transactionResult = submitVoteInDatabase({ db, ledger, input, matchResults })
      const state = readState()
      const allocation = state.allocations.find((row) => row.id === transactionResult.allocationId) || null
      const preview = buildVotePreview(state, {
        walletAddress: transactionResult.event.walletAddress,
        matchResults,
      })
      const snapshot = writeJsonSnapshots({ statePath, previewPath, state, matchResults })

      return {
        event: transactionResult.event,
        allocation,
        state,
        preview,
        snapshot,
      }
    },
    health() {
      const state = readState()
      return {
        mode: 'sqlite',
        dbPath,
        exists: existsSync(dbPath),
        statePath: statePath || null,
        previewPath: previewPath || null,
        allocationCount: state.allocations.length,
        eventCount: state.eventCount,
        eventHashHead: state.eventHashHead,
        generatedAt: state.generatedAt,
        updatedAt: state.updatedAt,
        schemaVersion: SQLITE_SCHEMA_VERSION,
      }
    },
    close() {
      db.close()
    },
  }
}
