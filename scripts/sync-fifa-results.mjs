#!/usr/bin/env node
import { existsSync } from 'node:fs'

import { readEnvFile, toNumber } from './lucky-draw/utils.mjs'
import {
  DEFAULT_FIFA_API_BASE_URL,
  FIFA_SOURCE_LABEL,
  FIFA_WORLD_CUP_SOURCE,
  fetchFifaCalendarMatches,
  fetchFifaMatch,
  finalizeMatchResultsSnapshot,
  normalizeFifaMatchResult,
  readMatchSourceMap,
  summarizeMatchResults,
  writeJsonAtomic,
} from './soccer-match-results.mjs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function parseArgs(argv) {
  const args = {
    envFile: '',
    sourceMapPath: process.env.FIFA_RESULTS_SOURCE_MAP_PATH || process.env.SOCCER_MATCH_SOURCE_MAP_PATH || '',
    out: process.env.SOCCER_MATCH_RESULTS_PATH || 'data/soccer/match-results.json',
    baseUrl: process.env.FIFA_API_BASE_URL || DEFAULT_FIFA_API_BASE_URL,
    from: process.env.FIFA_RESULTS_FROM || '',
    to: process.env.FIFA_RESULTS_TO || '',
    timeoutMs: toNumber(process.env.FIFA_RESULTS_REQUEST_TIMEOUT_MS || 30_000),
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--source-map') args.sourceMapPath = argv[++index] || ''
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--base-url') args.baseUrl = argv[++index] || args.baseUrl
    else if (arg === '--from') args.from = argv[++index] || ''
    else if (arg === '--to') args.to = argv[++index] || ''
    else if (arg === '--timeout-ms') args.timeoutMs = toNumber(argv[++index] || args.timeoutMs)
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  if (args.envFile) {
    const envValues = readEnvFile(args.envFile)
    args.sourceMapPath =
      args.sourceMapPath || envValues.FIFA_RESULTS_SOURCE_MAP_PATH || envValues.SOCCER_MATCH_SOURCE_MAP_PATH || ''
    args.out = envValues.SOCCER_MATCH_RESULTS_PATH || args.out
    args.baseUrl = envValues.FIFA_API_BASE_URL || args.baseUrl
    args.from = envValues.FIFA_RESULTS_FROM || args.from
    args.to = envValues.FIFA_RESULTS_TO || args.to
    if (envValues.FIFA_RESULTS_REQUEST_TIMEOUT_MS) {
      args.timeoutMs = toNumber(envValues.FIFA_RESULTS_REQUEST_TIMEOUT_MS)
    }
  }

  args.timeoutMs = Math.max(1000, args.timeoutMs || 30_000)
  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/sync-fifa-results.mjs --source-map <path> --out <path> [options]

Fetches FIFA public match detail for explicitly mapped local match ids and writes
the backend match-results snapshot consumed by vote settlement and draw ledger
generation. It does not infer local matches from frontend fixture ids.

Options:
  --env-file <path>       Optional env file.
  --source-map <path>     JSON map with matchId plus fifaMatchId or fifaMatchNumber.
  --out <path>            Output JSON path. Default data/soccer/match-results.json.
  --base-url <url>        FIFA API base URL. Default ${DEFAULT_FIFA_API_BASE_URL}.
  --from <YYYY-MM-DD>     Calendar fetch start, required for fifaMatchNumber rows.
  --to <YYYY-MM-DD>       Calendar fetch end, required for fifaMatchNumber rows.
  --timeout-ms <ms>       Per-request timeout. Default 30000.
  --dry-run               Print the snapshot without writing it.
`)
}

function requireSourceMap(path) {
  if (!path) throw new Error('FIFA_RESULTS_SOURCE_MAP_PATH or --source-map is required.')
  if (!existsSync(path)) throw new Error(`FIFA source map does not exist: ${path}`)
  const rows = readMatchSourceMap(path)
  if (rows.length === 0) throw new Error(`FIFA source map has no usable match rows: ${path}`)
  return rows
}

async function resolveCalendarRows(mappings, args) {
  const needsCalendar = mappings.some((mapping) => !mapping.fifaMatchId && mapping.fifaMatchNumber)
  if (!needsCalendar) return new Map()
  if (!args.from || !args.to) {
    throw new Error('Rows with fifaMatchNumber require --from and --to so the FIFA calendar range is explicit.')
  }

  const { sourceUrl, matches } = await fetchFifaCalendarMatches({
    baseUrl: args.baseUrl,
    from: args.from,
    to: args.to,
    timeoutMs: args.timeoutMs,
  })
  const byMatchNumber = new Map()
  for (const row of matches) {
    if (row?.MatchNumber !== undefined && row?.MatchNumber !== null) byMatchNumber.set(Number(row.MatchNumber), { row, sourceUrl })
  }
  return byMatchNumber
}

async function syncResults(args) {
  const mappings = requireSourceMap(args.sourceMapPath)
  const calendarByMatchNumber = await resolveCalendarRows(mappings, args)
  const fetchedAt = new Date().toISOString()
  const results = []
  const errors = []

  for (const mapping of mappings) {
    try {
      let payload = null
      let sourceUrl = ''

      if (mapping.fifaMatchId) {
        const fetched = await fetchFifaMatch(mapping.fifaMatchId, {
          baseUrl: args.baseUrl,
          timeoutMs: args.timeoutMs,
        })
        payload = fetched.payload
        sourceUrl = fetched.sourceUrl
      } else if (mapping.fifaMatchNumber) {
        const calendarMatch = calendarByMatchNumber.get(mapping.fifaMatchNumber)
        if (!calendarMatch) throw new Error(`FIFA calendar did not return MatchNumber ${mapping.fifaMatchNumber}`)
        payload = calendarMatch.row
        sourceUrl = calendarMatch.sourceUrl
      } else {
        throw new Error('match row must include fifaMatchId or fifaMatchNumber')
      }

      results.push(normalizeFifaMatchResult({ mapping, payload, sourceUrl, fetchedAt }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown FIFA sync error'
      errors.push({ matchId: mapping.matchId, message })
      results.push({
        matchId: mapping.matchId,
        resultStatus: 'source_error',
        sourceLabel: FIFA_SOURCE_LABEL,
        sourceStatus: 'source_error',
        sourceUrl: mapping.fifaMatchId ? `${args.baseUrl.replace(/\/$/, '')}/calendar/${mapping.fifaMatchId}` : '',
        fetchedAt,
        issue: message,
        fifa: {
          competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
          seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
          matchId: mapping.fifaMatchId || '',
          matchNumber: mapping.fifaMatchNumber || null,
        },
        teams: {
          home: null,
          away: null,
          expectedLocalTeamIds: mapping.teamIds || [],
          teamMatch: false,
        },
        score: {
          home: null,
          away: null,
          homePenalty: null,
          awayPenalty: null,
        },
        winnerSide: '',
        winnerTeamId: null,
        winnerFifaTeamId: null,
      })
    }
  }

  const snapshot = finalizeMatchResultsSnapshot({
    version: 1,
    mode: 'fifa-official-match-results',
    sourceLabel: FIFA_SOURCE_LABEL,
    sourceStatus: errors.length === 0 ? 'live' : results.some((result) => result.resultStatus === 'confirmed') ? 'partial' : 'error',
    generatedAt: fetchedAt,
    fetchedAt,
    source: {
      competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
      seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
      baseUrl: args.baseUrl,
      sourceMapPath: args.sourceMapPath,
      from: args.from || null,
      to: args.to || null,
    },
    results,
    errors,
  })

  return snapshot
}

const args = parseArgs(process.argv.slice(2))
syncResults(args)
  .then((snapshot) => {
    const summary = summarizeMatchResults(snapshot)
    if (args.dryRun || hasFlag('--dry-run')) {
      console.log(JSON.stringify({ ok: true, dryRun: true, summary, snapshot }, null, 2))
      return
    }
    writeJsonAtomic(args.out, snapshot)
    console.log(JSON.stringify({ ok: true, out: args.out, summary, hash: snapshot.hash }, null, 2))
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
