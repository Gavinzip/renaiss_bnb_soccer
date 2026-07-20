#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonAtomic } from './soccer-match-results.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function resolvePath(value) {
  const path = String(value || '').trim()
  if (!path) return ''
  return path.startsWith('/') ? path : resolve(repoRoot, path)
}

function normalizeBytes32(value) {
  const valueText = String(value || '').trim()
  return /^0x[a-fA-F0-9]{64}$/.test(valueText) ? valueText.toLowerCase() : ''
}

function normalizedRoundId(value) {
  const roundId = String(value || '').trim()
  if (!roundId) throw new Error('A source round id is required.')
  return roundId
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function lockedRoundPath(lockedRoundsDir, roundId) {
  return join(lockedRoundsDir, `${roundId}.json`)
}

function findRound(payload, roundId) {
  const rows = Array.isArray(payload?.roundDraws) ? payload.roundDraws : []
  return rows.find((row) => String(row?.roundId || '').trim() === roundId) || null
}

function drawRowsForRound(payload, roundId) {
  return (Array.isArray(payload?.draws) ? payload.draws : [])
    .filter((row) => String(row?.roundId || '').trim() === roundId)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertLockedRoundSource(payload, roundId, sourcePath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Locked source snapshot is invalid: ${sourcePath}`)
  }
  if (payload.snapshotMode !== 'locked-round-match-draw-ledger' || String(payload.lockedRoundId || '').trim() !== roundId) {
    throw new Error(`Locked source snapshot does not declare ${roundId}: ${sourcePath}`)
  }

  const round = findRound(payload, roundId)
  if (!round) throw new Error(`Locked source snapshot does not include round ${roundId}: ${sourcePath}`)
  if (!normalizeBytes32(round.roundKey)) throw new Error(`Locked source round ${roundId} has an invalid round key.`)
  if (!normalizeBytes32(round.ledgerHash)) throw new Error(`Locked source round ${roundId} has an invalid ledger hash.`)

  const matches = Array.isArray(round.matches) ? round.matches : []
  const draws = drawRowsForRound(payload, roundId)
  if (matches.length === 0 || draws.length !== matches.length) {
    throw new Error(`Locked source round ${roundId} has incomplete per-match draw data.`)
  }

  const drawByMatchId = new Map(draws.map((draw) => [String(draw?.matchId || '').trim(), draw]))
  for (const match of matches) {
    const matchId = String(match?.matchId || '').trim()
    const draw = drawByMatchId.get(matchId)
    if (!matchId || !draw) throw new Error(`Locked source round ${roundId} is missing draw data for a match.`)
    if (!normalizeBytes32(match.matchKey) || !normalizeBytes32(match.ledgerHash)) {
      throw new Error(`Locked source match ${matchId} has invalid on-chain identifiers.`)
    }
    if (String(draw.ledgerHash || '').toLowerCase() !== String(match.ledgerHash).toLowerCase()) {
      throw new Error(`Locked source match ${matchId} ledger hash does not match the round entry.`)
    }
    if (!Array.isArray(draw.entries) || draw.entries.length === 0) {
      throw new Error(`Locked source match ${matchId} has no ticket entries.`)
    }
  }

  return { round, draws }
}

export function readLockedSandboxSource({ sourceLockedRoundsDir, roundId }) {
  const sourceDir = resolvePath(sourceLockedRoundsDir)
  const normalizedId = normalizedRoundId(roundId)
  if (!sourceDir) throw new Error('A locked source ledger directory is required.')

  const sourcePath = lockedRoundPath(sourceDir, normalizedId)
  if (!existsSync(sourcePath)) {
    throw new Error(`Locked source snapshot is missing: ${sourcePath}`)
  }
  const source = readJson(sourcePath)
  const { round, draws } = assertLockedRoundSource(source, normalizedId, sourcePath)
  return { sourceDir, sourcePath, source, round, draws, roundId: normalizedId }
}

export function buildMainnetSandboxLedger({ source, roundId }) {
  const normalizedId = normalizedRoundId(roundId)
  const { round, draws } = assertLockedRoundSource(source, normalizedId, 'provided source snapshot')
  return {
    ...source,
    roundDraws: [round],
    draws,
  }
}

function mergeRoundIntoAggregate(existing, output, roundId) {
  const retainedRounds = (Array.isArray(existing?.roundDraws) ? existing.roundDraws : [])
    .filter((row) => String(row?.roundId || '').trim() !== roundId)
  const retainedDraws = (Array.isArray(existing?.draws) ? existing.draws : [])
    .filter((row) => String(row?.roundId || '').trim() !== roundId)
  return {
    ...output,
    roundDraws: [...retainedRounds, ...output.roundDraws],
    draws: [...retainedDraws, ...output.draws],
  }
}

function existingRoundMatchesSource(existing, sourceOutput, roundId) {
  const existingRound = findRound(existing, roundId)
  const sourceRound = findRound(sourceOutput, roundId)
  return Boolean(
    existingRound
    && sourceRound
    && sameJson(existingRound, sourceRound)
    && sameJson(drawRowsForRound(existing, roundId), drawRowsForRound(sourceOutput, roundId)),
  )
}

export function writeMainnetSandboxLedger({ sourceLockedRoundsDir, out, lockedRoundsDir, roundId }) {
  const outputPath = resolvePath(out)
  const lockedDir = resolvePath(lockedRoundsDir)
  const sourceLedger = readLockedSandboxSource({ sourceLockedRoundsDir, roundId })
  if (!outputPath || !lockedDir) throw new Error('Sandbox output and locked-rounds paths are required.')

  const snapshotPath = lockedRoundPath(lockedDir, sourceLedger.roundId)
  if (resolve(snapshotPath) === resolve(sourceLedger.sourcePath)) {
    throw new Error('Sandbox locked snapshot path must differ from the official source snapshot path.')
  }

  const output = buildMainnetSandboxLedger({ source: sourceLedger.source, roundId: sourceLedger.roundId })
  const existingLocked = existsSync(snapshotPath) ? readJson(snapshotPath) : null
  if (existingLocked && !sameJson(existingLocked, sourceLedger.source)) {
    throw new Error(`Sandbox locked snapshot differs from the immutable source: ${snapshotPath}`)
  }

  const existingAggregate = existsSync(outputPath) ? readJson(outputPath) : null
  const aggregateMatchesSource = existingRoundMatchesSource(existingAggregate, output, sourceLedger.roundId)

  if (!existingLocked) {
    mkdirSync(lockedDir, { recursive: true })
    copyFileSync(sourceLedger.sourcePath, snapshotPath)
  }
  if (!aggregateMatchesSource) {
    writeJsonAtomic(outputPath, mergeRoundIntoAggregate(existingAggregate, output, sourceLedger.roundId))
  }

  return {
    ok: true,
    out: outputPath,
    sourcePath: sourceLedger.sourcePath,
    lockedRoundPath: snapshotPath,
    writeSkipped: aggregateMatchesSource,
    lockedRoundWriteSkipped: Boolean(existingLocked),
    summary: {
      roundId: sourceLedger.roundId,
      roundKey: sourceLedger.round.roundKey,
      ledgerHash: sourceLedger.round.ledgerHash,
      matchIds: sourceLedger.round.matches.map((match) => match.matchId),
      matchCount: sourceLedger.round.matches.length,
      totalTickets: sourceLedger.draws.reduce((total, draw) => total + Number(draw.totalTickets || 0), 0),
      sourceLockedSnapshot: true,
    },
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/build-mainnet-sandbox-ledger.mjs \\
    --source-locked-rounds-dir <official locked ledger dir> \\
    --out <sandbox aggregate path> \\
    --locked-rounds-dir <sandbox locked ledger dir> \\
    --round-id <official round id>

Copies one immutable official locked round into isolated sandbox storage.
It does not rebuild votes, results, tickets, hashes, or round keys.`)
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isCliEntrypoint()) {
  try {
    if (process.argv.includes('--help')) {
      printHelp()
      process.exit(0)
    }
    const result = writeMainnetSandboxLedger({
      sourceLockedRoundsDir: argValue('--source-locked-rounds-dir'),
      out: argValue('--out'),
      lockedRoundsDir: argValue('--locked-rounds-dir'),
      roundId: argValue('--round-id'),
    })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
