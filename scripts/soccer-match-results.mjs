import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { campaignMatches } from '../src/app/data/worldCupCampaign.js'
import { canonicalMatchId } from './official-match-identity.mjs'

export const MATCH_RESULTS_VERSION = 1
export const FIFA_WORLD_CUP_SOURCE = {
  competitionId: '17',
  seasonId: '285023',
  groupStageId: '289273',
}
export const DEFAULT_FIFA_API_BASE_URL = 'https://api.fifa.com/api/v3'
export const FIFA_SOURCE_LABEL = 'fifa-public-api'

const FIFA_CODE_TO_LOCAL_TEAM_ID = {
  ARG: 'argentina',
  ALG: 'algeria',
  AUS: 'australia',
  AUT: 'austria',
  BEL: 'belgium',
  BIH: 'bosnia-and-herzegovina',
  BRA: 'brazil',
  CAN: 'canada',
  CIV: 'cote-d-ivoire',
  COD: 'congo-dr',
  COL: 'colombia',
  CRC: 'costa-rica',
  CRO: 'croatia',
  CPV: 'cabo-verde',
  CZE: 'czechia',
  DEN: 'denmark',
  ECU: 'ecuador',
  EGY: 'egypt',
  ENG: 'england',
  ESP: 'spain',
  FRA: 'france',
  GER: 'germany',
  GHA: 'ghana',
  GRE: 'greece',
  IRN: 'iran',
  ITA: 'italy',
  JPN: 'japan',
  KOR: 'south-korea',
  KSA: 'saudi-arabia',
  MAR: 'morocco',
  MEX: 'mexico',
  NED: 'netherlands',
  NGA: 'nigeria',
  NOR: 'norway',
  PAR: 'paraguay',
  POL: 'poland',
  POR: 'portugal',
  QAT: 'qatar',
  RSA: 'south-africa',
  SEN: 'senegal',
  SRB: 'serbia',
  SUI: 'switzerland',
  SWE: 'sweden',
  TUN: 'tunisia',
  TUR: 'turkey',
  URU: 'uruguay',
  USA: 'united-states',
  ZAF: 'south-africa',
}

const NAME_TO_LOCAL_TEAM_ID = {
  algeria: 'algeria',
  'bosnia and herzegovina': 'bosnia-and-herzegovina',
  'cabo verde': 'cabo-verde',
  'congo dr': 'congo-dr',
  'cote d ivoire': 'cote-d-ivoire',
  'czech republic': 'czechia',
  egypt: 'egypt',
  'ir iran': 'iran',
  'korea republic': 'south-korea',
  paraguay: 'paraguay',
  'saudi arabia': 'saudi-arabia',
  'south africa': 'south-africa',
  'south korea': 'south-korea',
  turkiye: 'turkey',
  usa: 'united-states',
  'united states': 'united-states',
}

const matchesById = new Map(campaignMatches.map((match) => [match.id, match]))

function normalizeLookup(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function readDescription(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return (
    value.find((entry) => entry?.Locale === 'en-GB')?.Description ||
    value.find((entry) => entry?.Description)?.Description ||
    ''
  )
}

function readInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : fallback
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

export function writeJsonAtomic(path, payload) {
  ensureParent(path)
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmpPath, path)
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

export function snapshotHash(payload) {
  return `0x${sha256Hex(stableStringify(payload))}`
}

function teamName(team) {
  return (
    team?.ShortClubName ||
    readDescription(team?.Name) ||
    readDescription(team?.DisplayName) ||
    team?.Abbreviation ||
    ''
  )
}

export function normalizeFifaTeam(team) {
  if (!team || typeof team !== 'object') {
    return {
      fifaTeamId: '',
      abbreviation: '',
      name: '',
      localTeamId: '',
    }
  }

  const abbreviation = String(team.Abbreviation || team.IdAssociation || '').toUpperCase()
  const name = teamName(team)
  const normalizedName = normalizeLookup(name)
  return {
    fifaTeamId: String(team.IdTeam || ''),
    abbreviation,
    name,
    localTeamId: FIFA_CODE_TO_LOCAL_TEAM_ID[abbreviation] || NAME_TO_LOCAL_TEAM_ID[normalizedName] || '',
  }
}

function normalizeMatchSourceRow(row) {
  if (!row || typeof row !== 'object') return null
  const matchId = canonicalMatchId(row.matchId || row.match_id || row.localMatchId || row.local_match_id || row.id)
  if (!matchId) return null

  const teamIds = Array.isArray(row.teamIds)
    ? row.teamIds
    : Array.isArray(row.team_ids)
      ? row.team_ids
      : Array.isArray(row.expectedTeamIds)
        ? row.expectedTeamIds
        : Array.isArray(row.expected_team_ids)
          ? row.expected_team_ids
          : null

  return {
    matchId,
    fifaMatchId: String(row.fifaMatchId || row.fifa_match_id || row.idMatch || row.IdMatch || '').trim(),
    fifaMatchNumber:
      row.fifaMatchNumber || row.fifa_match_number || row.matchNumber || row.MatchNumber
        ? readInteger(row.fifaMatchNumber || row.fifa_match_number || row.matchNumber || row.MatchNumber)
        : null,
    teamIds: teamIds ? teamIds.map((teamId) => String(teamId).trim()).filter(Boolean) : null,
    enforceTeamMatch: row.enforceTeamMatch !== false && row.enforce_team_match !== false,
    note: row.note ? String(row.note) : '',
  }
}

export function normalizeMatchSourceMap(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.matches)
      ? payload.matches
      : payload && typeof payload === 'object'
        ? Object.entries(payload).map(([matchId, value]) => ({ matchId, ...(value || {}) }))
        : []

  const rows = source.map(normalizeMatchSourceRow).filter(Boolean)
  const seen = new Set()
  return rows.filter((row) => {
    if (seen.has(row.matchId)) return false
    seen.add(row.matchId)
    return true
  })
}

export function readMatchSourceMap(path) {
  if (!path || !existsSync(path)) return []
  return normalizeMatchSourceMap(JSON.parse(readFileSync(path, 'utf8')))
}

export function fifaMatchUrl(fifaMatchId, baseUrl = DEFAULT_FIFA_API_BASE_URL) {
  return `${String(baseUrl).replace(/\/$/, '')}/calendar/${encodeURIComponent(fifaMatchId)}?language=en`
}

export function fifaCalendarUrl({ baseUrl = DEFAULT_FIFA_API_BASE_URL, from = '', to = '', count = 200 } = {}) {
  const url = new URL(`${String(baseUrl).replace(/\/$/, '')}/calendar/matches`)
  url.searchParams.set('idCompetition', FIFA_WORLD_CUP_SOURCE.competitionId)
  url.searchParams.set('idSeason', FIFA_WORLD_CUP_SOURCE.seasonId)
  url.searchParams.set('count', String(count))
  url.searchParams.set('language', 'en')
  if (from) url.searchParams.set('from', from)
  if (to) url.searchParams.set('to', to)
  return url.toString()
}

async function fetchJson(url, { fetcher = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchFifaMatch(fifaMatchId, options = {}) {
  const sourceUrl = fifaMatchUrl(fifaMatchId, options.baseUrl)
  return {
    sourceUrl,
    payload: await fetchJson(sourceUrl, options),
  }
}

export async function fetchFifaCalendarMatches(options = {}) {
  const sourceUrl = fifaCalendarUrl(options)
  const payload = await fetchJson(sourceUrl, options)
  return {
    sourceUrl,
    matches: Array.isArray(payload?.Results) ? payload.Results : [],
  }
}

function expectedTeamIdsFor(mapping) {
  const campaignMatch = matchesById.get(mapping.matchId)
  return mapping.teamIds || (Array.isArray(campaignMatch?.teams) ? campaignMatch.teams : [])
}

function teamsMatchExpected(expectedTeamIds, home, away) {
  const actual = [home.localTeamId, away.localTeamId].filter(Boolean)
  if (expectedTeamIds.length === 0 || actual.length < 2) return true
  return (
    expectedTeamIds.length === actual.length &&
    expectedTeamIds.every((teamId) => actual.includes(teamId))
  )
}

function resolveWinnerTeam({ winnerFifaTeamId, home, away }) {
  if (!winnerFifaTeamId) return { side: '', team: null }
  if (winnerFifaTeamId === home.fifaTeamId) return { side: 'home', team: home }
  if (winnerFifaTeamId === away.fifaTeamId) return { side: 'away', team: away }
  return { side: '', team: null }
}

export function normalizeFifaMatchResult({ mapping, payload, sourceUrl, fetchedAt }) {
  const home = normalizeFifaTeam(payload?.Home)
  const away = normalizeFifaTeam(payload?.Away)
  const expectedTeamIds = expectedTeamIdsFor(mapping)
  const teamMatch = teamsMatchExpected(expectedTeamIds, home, away)
  const winnerFifaTeamId = String(payload?.Winner || '')
  const winner = resolveWinnerTeam({ winnerFifaTeamId, home, away })
  const matchStatus = readInteger(payload?.MatchStatus, -1)
  const officialityStatus = readInteger(payload?.OfficialityStatus, -1)
  const hasOfficialWinner = Boolean(winner.team?.localTeamId && matchStatus === 0 && officialityStatus === 1)
  const resultStatus = !teamMatch && mapping.enforceTeamMatch
    ? 'mismatch'
    : hasOfficialWinner
      ? 'confirmed'
      : 'pending'
  const issue = resultStatus === 'mismatch'
    ? `FIFA teams ${home.localTeamId || home.name || 'unknown'} / ${away.localTeamId || away.name || 'unknown'} do not match configured local teams ${expectedTeamIds.join(' / ')}.`
    : resultStatus === 'pending'
      ? 'FIFA has not published an official winner for this mapped match yet.'
      : ''

  return {
    matchId: mapping.matchId,
    resultStatus,
    sourceLabel: FIFA_SOURCE_LABEL,
    sourceStatus: resultStatus === 'confirmed' ? 'official' : resultStatus,
    sourceUrl,
    fetchedAt,
    issue,
    fifa: {
      competitionId: String(payload?.IdCompetition || FIFA_WORLD_CUP_SOURCE.competitionId),
      seasonId: String(payload?.IdSeason || FIFA_WORLD_CUP_SOURCE.seasonId),
      stageId: String(payload?.IdStage || ''),
      matchId: String(payload?.IdMatch || mapping.fifaMatchId || ''),
      matchNumber: payload?.MatchNumber ?? mapping.fifaMatchNumber ?? null,
      matchStatus,
      officialityStatus,
      resultType: readInteger(payload?.ResultType, -1),
      winnerTeamId: winnerFifaTeamId,
    },
    teams: {
      home,
      away,
      expectedLocalTeamIds: expectedTeamIds,
      teamMatch,
    },
    score: {
      home: payload?.HomeTeamScore ?? null,
      away: payload?.AwayTeamScore ?? null,
      homePenalty: payload?.HomeTeamPenaltyScore ?? null,
      awayPenalty: payload?.AwayTeamPenaltyScore ?? null,
    },
    winnerSide: winner.side,
    winnerTeamId: resultStatus === 'confirmed' ? winner.team.localTeamId : null,
    winnerFifaTeamId: resultStatus === 'confirmed' ? winnerFifaTeamId : null,
  }
}

export function createEmptyMatchResultsSnapshot(issue = '') {
  return {
    version: MATCH_RESULTS_VERSION,
    mode: 'fifa-official-match-results',
    sourceLabel: FIFA_SOURCE_LABEL,
    sourceStatus: issue ? 'missing' : 'empty',
    generatedAt: null,
    fetchedAt: null,
    source: {
      competitionId: FIFA_WORLD_CUP_SOURCE.competitionId,
      seasonId: FIFA_WORLD_CUP_SOURCE.seasonId,
    },
    results: [],
    errors: issue ? [{ message: issue }] : [],
    hash: null,
  }
}

export function finalizeMatchResultsSnapshot(snapshot) {
  const hashPayload = {
    version: snapshot.version,
    mode: snapshot.mode,
    source: snapshot.source,
    results: snapshot.results.map((result) => ({
      matchId: result.matchId,
      resultStatus: result.resultStatus,
      sourceUrl: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      fifa: result.fifa,
      teams: result.teams,
      score: result.score,
      winnerSide: result.winnerSide,
      winnerTeamId: result.winnerTeamId,
      winnerFifaTeamId: result.winnerFifaTeamId,
    })),
  }

  return {
    ...snapshot,
    hash: snapshotHash(hashPayload),
  }
}

export function readMatchResultsSnapshot(path) {
  if (!path || !existsSync(path)) return createEmptyMatchResultsSnapshot('match results snapshot does not exist')
  const payload = JSON.parse(readFileSync(path, 'utf8'))
  return {
    ...createEmptyMatchResultsSnapshot(),
    ...payload,
    results: Array.isArray(payload.results)
      ? payload.results.map((result) => ({
        ...result,
        matchId: canonicalMatchId(result?.matchId),
      }))
      : [],
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  }
}

export function buildMatchResultIndex(snapshot) {
  return new Map((Array.isArray(snapshot?.results) ? snapshot.results : []).map((result) => [
    canonicalMatchId(result?.matchId),
    {
      ...result,
      matchId: canonicalMatchId(result?.matchId),
    },
  ]))
}

export function confirmedMatchResultFor(indexOrSnapshot, matchId) {
  const index = indexOrSnapshot instanceof Map ? indexOrSnapshot : buildMatchResultIndex(indexOrSnapshot)
  const result = index.get(canonicalMatchId(matchId))
  return result?.resultStatus === 'confirmed' && result.winnerTeamId ? result : null
}

export function summarizeMatchResults(snapshot) {
  const results = Array.isArray(snapshot?.results) ? snapshot.results : []
  const counts = results.reduce(
    (summary, result) => {
      summary[result.resultStatus] = (summary[result.resultStatus] || 0) + 1
      return summary
    },
    { confirmed: 0, pending: 0, mismatch: 0, source_error: 0, unmapped: 0 },
  )
  return {
    total: results.length,
    ...counts,
  }
}
