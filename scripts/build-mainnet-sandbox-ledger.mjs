#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { snapshotHash, writeJsonAtomic } from './soccer-match-results.mjs'

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

function sandboxDrawRoundId(sourceRoundId, value) {
  const drawRoundId = String(value || sourceRoundId).trim()
  if (drawRoundId === sourceRoundId) return drawRoundId

  const redrawPrefix = `${sourceRoundId}-sandbox-redraw-`
  if (!drawRoundId.startsWith(redrawPrefix)) {
    throw new Error(`Sandbox draw round must be ${sourceRoundId} or use the ${redrawPrefix}<number> format.`)
  }

  const redrawIndex = drawRoundId.slice(redrawPrefix.length)
  if (!/^[1-9][0-9]{0,2}$/.test(redrawIndex)) {
    throw new Error(`Sandbox draw round ${drawRoundId} has an invalid redraw version.`)
  }
  return drawRoundId
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

export function buildMainnetSandboxLedger({ source, roundId, sourceRoundId, drawRoundId }) {
  const normalizedSourceRoundId = normalizedRoundId(sourceRoundId || roundId)
  const normalizedDrawRoundId = sandboxDrawRoundId(normalizedSourceRoundId, drawRoundId)
  const { round, draws } = assertLockedRoundSource(
    source,
    normalizedSourceRoundId,
    'provided source snapshot',
  )

  if (normalizedDrawRoundId === normalizedSourceRoundId) {
    return {
      ...source,
      roundDraws: [round],
      draws,
    }
  }

  const sandboxRound = {
    ...round,
    roundId: normalizedDrawRoundId,
    sourceRoundId: normalizedSourceRoundId,
    redrawOf: normalizedSourceRoundId,
    roundKey: snapshotHash({ type: 'round-id', roundId: normalizedDrawRoundId }),
    drawId: normalizedDrawRoundId,
  }
  const sandboxDraws = draws.map((draw) => ({
    ...draw,
    roundId: normalizedDrawRoundId,
    sourceRoundId: normalizedSourceRoundId,
  }))

  return {
    ...source,
    lockedRoundId: normalizedDrawRoundId,
    sourceLockedRoundId: normalizedSourceRoundId,
    roundDraws: [sandboxRound],
    draws: sandboxDraws,
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

export function writeMainnetSandboxLedger({
  sourceLockedRoundsDir,
  out,
  lockedRoundsDir,
  roundId,
  sourceRoundId,
  drawRoundId,
}) {
  const outputPath = resolvePath(out)
  const lockedDir = resolvePath(lockedRoundsDir)
  const normalizedSourceRoundId = normalizedRoundId(sourceRoundId || roundId)
  const normalizedDrawRoundId = sandboxDrawRoundId(normalizedSourceRoundId, drawRoundId)
  const sourceLedger = readLockedSandboxSource({
    sourceLockedRoundsDir,
    roundId: normalizedSourceRoundId,
  })
  if (!outputPath || !lockedDir) throw new Error('Sandbox output and locked-rounds paths are required.')

  const snapshotPath = lockedRoundPath(lockedDir, normalizedDrawRoundId)
  if (resolve(snapshotPath) === resolve(sourceLedger.sourcePath)) {
    throw new Error('Sandbox locked snapshot path must differ from the official source snapshot path.')
  }

  const output = buildMainnetSandboxLedger({
    source: sourceLedger.source,
    sourceRoundId: normalizedSourceRoundId,
    drawRoundId: normalizedDrawRoundId,
  })
  const existingLocked = existsSync(snapshotPath) ? readJson(snapshotPath) : null
  if (existingLocked && !sameJson(existingLocked, output)) {
    throw new Error(`Sandbox locked snapshot differs from its immutable expected ledger: ${snapshotPath}`)
  }

  const existingAggregate = existsSync(outputPath) ? readJson(outputPath) : null
  const aggregateMatchesSource = existingRoundMatchesSource(existingAggregate, output, normalizedDrawRoundId)

  if (!existingLocked) {
    mkdirSync(lockedDir, { recursive: true })
    if (normalizedDrawRoundId === normalizedSourceRoundId) {
      copyFileSync(sourceLedger.sourcePath, snapshotPath)
    } else {
      writeJsonAtomic(snapshotPath, output)
    }
  }
  if (!aggregateMatchesSource) {
    writeJsonAtomic(outputPath, mergeRoundIntoAggregate(existingAggregate, output, normalizedDrawRoundId))
  }

  const outputRound = output.roundDraws[0]
  return {
    ok: true,
    out: outputPath,
    sourcePath: sourceLedger.sourcePath,
    lockedRoundPath: snapshotPath,
    writeSkipped: aggregateMatchesSource,
    lockedRoundWriteSkipped: Boolean(existingLocked),
    summary: {
      roundId: normalizedDrawRoundId,
      sourceRoundId: normalizedSourceRoundId,
      redrawOf: normalizedDrawRoundId === normalizedSourceRoundId ? null : normalizedSourceRoundId,
      roundKey: outputRound.roundKey,
      ledgerHash: outputRound.ledgerHash,
      matchIds: outputRound.matches.map((match) => match.matchId),
      matchCount: outputRound.matches.length,
      totalTickets: output.draws.reduce((total, draw) => total + Number(draw.totalTickets || 0), 0),
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
    --source-round-id <official round id> \\
    --draw-round-id <sandbox on-chain round id>

Copies one immutable official locked round into isolated sandbox storage.
For a sandbox redraw, only the sandbox on-chain round id and round key change.
It never rebuilds votes, results, ticket entries, ledger hashes, or match keys.`)
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
      sourceRoundId: argValue('--source-round-id', argValue('--round-id')),
      drawRoundId: argValue('--draw-round-id'),
    })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
