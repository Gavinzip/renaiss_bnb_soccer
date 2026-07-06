import { canonicalMatchId } from "./matchIds.js";

export const FIFA_WORLD_CUP_SOURCE = {
  competitionId: "17",
  seasonId: "285023",
  groupStageId: "289273",
  round32StageId: "289287",
  round16StageId: "289288",
  quarterFinalStageId: "289289",
  semiFinalStageId: "289290",
  thirdPlaceStageId: "289291",
  finalStageId: "289292",
};

export const FIFA_STANDINGS_SOURCE_URL = `https://api.fifa.com/api/v3/standings/season/${FIFA_WORLD_CUP_SOURCE.seasonId}/stage/${FIFA_WORLD_CUP_SOURCE.groupStageId}`;
export const FIFA_ROUND32_MATCHES_SOURCE_URL = `https://api.fifa.com/api/v3/calendar/matches?idCompetition=${FIFA_WORLD_CUP_SOURCE.competitionId}&idSeason=${FIFA_WORLD_CUP_SOURCE.seasonId}&count=200&language=en&from=2026-06-27&to=2026-07-05`;
export const FIFA_ROUND16_MATCHES_SOURCE_URL = `https://api.fifa.com/api/v3/calendar/matches?idCompetition=${FIFA_WORLD_CUP_SOURCE.competitionId}&idSeason=${FIFA_WORLD_CUP_SOURCE.seasonId}&count=200&language=en&from=2026-07-04&to=2026-07-10`;
export const FIFA_FUTURE_KNOCKOUT_MATCHES_SOURCE_URL = `https://api.fifa.com/api/v3/calendar/matches?idCompetition=${FIFA_WORLD_CUP_SOURCE.competitionId}&idSeason=${FIFA_WORLD_CUP_SOURCE.seasonId}&count=200&language=en&from=2026-07-08&to=2026-07-20`;

const ROUND32_ID = "round32";
const ROUND16_ID = "round16";
const QUARTER_FINAL_ID = "quarterFinal";
const SEMI_FINAL_ID = "semiFinal";
const FINAL_ID = "final";
const ROUND32_SLOT_COUNT = 32;
const ROUND32_MATCH_COUNT = 16;
const ROUND16_MATCH_COUNT = 8;
const FUTURE_KNOCKOUT_MATCH_COUNT = 7;
const ROUND32_MATCH_START_NUMBER = 73;
const ROUND32_MATCH_END_NUMBER = 88;
const ROUND16_MATCH_START_NUMBER = 89;
const ROUND16_MATCH_END_NUMBER = 96;
const FUTURE_KNOCKOUT_ROUND_CONFIGS = [
  {
    roundId: QUARTER_FINAL_ID,
    stageId: FIFA_WORLD_CUP_SOURCE.quarterFinalStageId,
    matchStartNumber: 97,
    matchEndNumber: 100,
    matchCount: 4,
    sourceKey: "quarter-final",
  },
  {
    roundId: SEMI_FINAL_ID,
    stageId: FIFA_WORLD_CUP_SOURCE.semiFinalStageId,
    matchStartNumber: 101,
    matchEndNumber: 102,
    matchCount: 2,
    sourceKey: "semi-final",
  },
  {
    roundId: FINAL_ID,
    stageId: FIFA_WORLD_CUP_SOURCE.finalStageId,
    matchStartNumber: 104,
    matchEndNumber: 104,
    matchCount: 1,
    sourceKey: "final",
  },
];
const DIRECT_GROUP_QUALIFIER_COUNT = 2;
const BEST_THIRD_QUALIFIER_COUNT = 8;
const UNREVEALED_FLAG_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 44'%3E%3Crect width='64' height='44' rx='4' fill='%23131515'/%3E%3Cpath d='M10 22h44M32 7v30' stroke='%23f5f6f1' stroke-opacity='.16' stroke-width='2'/%3E%3Ccircle cx='32' cy='22' r='12' fill='none' stroke='%23f0d18b' stroke-opacity='.28' stroke-width='2'/%3E%3C/svg%3E";

const FIFA_CODE_TO_LOCAL_TEAM_ID = {
  ARG: "argentina",
  ALG: "algeria",
  AUS: "australia",
  AUT: "austria",
  BEL: "belgium",
  BIH: "bosnia-and-herzegovina",
  BRA: "brazil",
  CIV: "cote-d-ivoire",
  CAN: "canada",
  COD: "congo-dr",
  COL: "colombia",
  CRC: "costa-rica",
  CRO: "croatia",
  CPV: "cabo-verde",
  CZE: "czechia",
  DEN: "denmark",
  ECU: "ecuador",
  EGY: "egypt",
  ENG: "england",
  ESP: "spain",
  FRA: "france",
  GER: "germany",
  GHA: "ghana",
  GRE: "greece",
  IRN: "iran",
  ITA: "italy",
  JPN: "japan",
  KOR: "south-korea",
  KSA: "saudi-arabia",
  MAR: "morocco",
  MEX: "mexico",
  NED: "netherlands",
  NGA: "nigeria",
  NOR: "norway",
  PAR: "paraguay",
  POL: "poland",
  POR: "portugal",
  QAT: "qatar",
  RSA: "south-africa",
  SEN: "senegal",
  SRB: "serbia",
  SUI: "switzerland",
  SWE: "sweden",
  TUN: "tunisia",
  TUR: "turkey",
  URU: "uruguay",
  USA: "united-states",
  ZAF: "south-africa",
};

const NAME_TO_LOCAL_TEAM_ID = {
  "algeria": "algeria",
  "bosnia and herzegovina": "bosnia-and-herzegovina",
  "cabo verde": "cabo-verde",
  "congo dr": "congo-dr",
  "cote d ivoire": "cote-d-ivoire",
  "czech republic": "czechia",
  "egypt": "egypt",
  "ir iran": "iran",
  "korea republic": "south-korea",
  "paraguay": "paraguay",
  "saudi arabia": "saudi-arabia",
  "south africa": "south-africa",
  "south korea": "south-korea",
  "turkiye": "turkey",
  "united states": "united-states",
  "usa": "united-states",
};

function normalizeLookup(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return normalizeLookup(value).replace(/\s+/g, "-") || "team";
}

function readDescription(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return (
    value.find((entry) => entry?.Locale === "en-GB")?.Description
    ?? value.find((entry) => entry?.Description)?.Description
    ?? ""
  );
}

function readNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getTeamName(row) {
  return (
    row?.Team?.ShortClubName
    || readDescription(row?.Team?.Name)
    || readDescription(row?.Team?.DisplayName)
    || row?.Team?.Abbreviation
    || "Unknown"
  );
}

function getFixtureTeamName(team) {
  return (
    team?.ShortClubName
    || readDescription(team?.TeamName)
    || readDescription(team?.Name)
    || readDescription(team?.DisplayName)
    || team?.Abbreviation
    || "Unknown"
  );
}

function getGroupName(row) {
  return readDescription(row?.Group) || row?.IdGroup || "Group";
}

function isConfirmedQualification(value) {
  const normalized = normalizeLookup(value);
  if (!normalized || normalized === "undefined") return false;
  return new Set([
    "confirmedqualified",
    "confirmed qualified",
    "qualified",
    "advanced",
    "promoted",
  ]).has(normalized);
}

function sortRowsByGroupPosition(rows) {
  return rows.slice().sort((left, right) => (
    readNumber(left.position, 99) - readNumber(right.position, 99)
  ) || (
    left.sourceIndex - right.sourceIndex
  ));
}

function sortThirdPlaceRows(left, right) {
  return (
    right.points - left.points
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || left.sourceIndex - right.sourceIndex
  );
}

function normalizeStandingRow(row, sourceIndex) {
  const abbreviation = String(row?.Team?.Abbreviation || row?.Team?.IdAssociation || "").toUpperCase();
  const name = getTeamName(row);
  const groupName = getGroupName(row);
  const position = readNumber(row?.Position, 99);
  const points = readNumber(row?.Points, 0);
  const goalsFor = readNumber(row?.For, 0);
  const goalsAgainst = readNumber(row?.Against, 0);
  const goalDifference = readNumber(row?.GoalsDiference ?? row?.GoalDifference, goalsFor - goalsAgainst);

  return {
    idTeam: String(row?.IdTeam ?? row?.Team?.IdTeam ?? ""),
    abbreviation,
    name,
    groupName,
    idGroup: String(row?.IdGroup ?? groupName),
    position,
    points,
    goalsFor,
    goalsAgainst,
    goalDifference,
    played: readNumber(row?.Played, 0),
    qualificationStatus: String(row?.QualificationStatus ?? "Undefined"),
    isConfirmed: isConfirmedQualification(row?.QualificationStatus),
    sourceIndex,
    raw: row,
  };
}

function createUnrevealedSlot(slotNumber) {
  return {
    slot: slotNumber,
    status: "unrevealed",
    routeLabel: `R32 slot ${slotNumber}`,
    teamId: `unrevealed-r32-slot-${String(slotNumber).padStart(2, "0")}`,
    teamName: "Unrevealed",
    abbreviation: "TBD",
    points: 0,
    goalDifference: 0,
    source: "pending",
  };
}

function createSlotFromRow(row, slotNumber, source) {
  const status = row.isConfirmed ? "confirmed" : "provisional";
  const routeSuffix = source === "best-third"
    ? `#3 / best ${row.bestThirdRank}`
    : `#${row.position}`;

  return {
    slot: slotNumber,
    status,
    source,
    teamId: "",
    fifaTeamId: row.idTeam,
    idGroup: row.idGroup,
    groupName: row.groupName,
    routeLabel: `${row.groupName} ${routeSuffix}`,
    teamName: row.name,
    abbreviation: row.abbreviation,
    points: row.points,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    played: row.played,
    position: row.position,
    qualificationStatus: row.qualificationStatus,
  };
}

function buildRound32Slots(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.idGroup || row.groupName;
    const current = groups.get(key) ?? { id: key, name: row.groupName, rows: [] };
    current.rows.push(row);
    groups.set(key, current);
  });

  const sortedGroups = Array.from(groups.values())
    .map((group) => ({ ...group, rows: sortRowsByGroupPosition(group.rows) }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

  const directQualifiers = sortedGroups.flatMap((group) => (
    group.rows.slice(0, DIRECT_GROUP_QUALIFIER_COUNT)
      .map((row) => ({ row, source: "group-position" }))
  ));

  const bestThirds = sortedGroups
    .map((group) => group.rows[DIRECT_GROUP_QUALIFIER_COUNT])
    .filter(Boolean)
    .sort(sortThirdPlaceRows)
    .slice(0, BEST_THIRD_QUALIFIER_COUNT)
    .map((row, index) => ({ row: { ...row, bestThirdRank: index + 1 }, source: "best-third" }));

  const candidateSlots = [...directQualifiers, ...bestThirds]
    .slice(0, ROUND32_SLOT_COUNT)
    .map((entry, index) => createSlotFromRow(entry.row, index + 1, entry.source));

  while (candidateSlots.length < ROUND32_SLOT_COUNT) {
    candidateSlots.push(createUnrevealedSlot(candidateSlots.length + 1));
  }

  return {
    slots: candidateSlots,
    groups: sortedGroups.map((group) => ({
      id: group.id,
      name: group.name,
      rows: group.rows.map(({ raw, ...row }) => row),
    })),
  };
}

function countSlots(slots) {
  return slots.reduce(
    (counts, slot) => ({
      ...counts,
      [slot.status]: (counts[slot.status] ?? 0) + 1,
    }),
    { confirmed: 0, provisional: 0, unrevealed: 0 },
  );
}

function readNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readFixtureScore(match, team, scoreKey) {
  return readNullableNumber(match?.[scoreKey] ?? team?.Score);
}

function readFixtureVenue(row) {
  return (
    readDescription(row?.Stadium?.Name)
    || readDescription(row?.Stadium?.CityName)
    || readDescription(row?.Place)
    || ""
  );
}

function normalizeFifaFixtureTeam(team) {
  const abbreviation = String(team?.Abbreviation || team?.IdAssociation || team?.IdCountry || "").toUpperCase();
  const fifaTeamId = String(team?.IdTeam || "");
  const name = getFixtureTeamName(team);
  return {
    fifaTeamId,
    abbreviation,
    name: fifaTeamId || abbreviation ? name : "",
  };
}

function normalizeFifaKnockoutFixture(row, {
  stageId: expectedStageId,
  matchStartNumber,
  matchEndNumber,
}) {
  const stageId = String(row?.IdStage || "");
  const matchNumber = readNumber(row?.MatchNumber, 0);
  if (stageId !== expectedStageId) return null;
  if (matchNumber < matchStartNumber || matchNumber > matchEndNumber) return null;

  const home = normalizeFifaFixtureTeam(row?.Home);
  const away = normalizeFifaFixtureTeam(row?.Away);
  const teamsConfirmed = Boolean(home.fifaTeamId && away.fifaTeamId);

  const kickoffMs = Date.parse(row?.Date ?? "");
  const kickoffAt = Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null;
  const cutoffAt = kickoffAt && teamsConfirmed ? new Date(kickoffMs - 60 * 60 * 1000).toISOString() : null;
  const homeScore = readFixtureScore(row, row?.Home, "HomeTeamScore");
  const awayScore = readFixtureScore(row, row?.Away, "AwayTeamScore");
  const hasScore = homeScore !== null && awayScore !== null;
  const matchStatus = readNumber(row?.MatchStatus, -1);
  const officialityStatus = readNumber(row?.OfficialityStatus, -1);
  const winnerFifaTeamId = String(row?.Winner || "");
  const isOfficialFinal = matchStatus === 0 && officialityStatus === 1 && (Boolean(winnerFifaTeamId) || hasScore);

  return {
    matchNumber,
    matchCode: `M${matchNumber}`,
    fifaMatchId: String(row?.IdMatch || ""),
    stageId,
    kickoffAt,
    cutoffAt,
    venue: readFixtureVenue(row),
    status: isOfficialFinal ? "official_final" : "scheduled",
    score: isOfficialFinal && hasScore ? `${homeScore}-${awayScore}` : null,
    winnerFifaTeamId,
    teamsConfirmed,
    matchStatus,
    officialityStatus,
    source: "fifa-calendar",
    home,
    away,
  };
}

function normalizeFifaRound32Fixture(row) {
  return normalizeFifaKnockoutFixture(row, {
    stageId: FIFA_WORLD_CUP_SOURCE.round32StageId,
    matchStartNumber: ROUND32_MATCH_START_NUMBER,
    matchEndNumber: ROUND32_MATCH_END_NUMBER,
  });
}

function normalizeFifaRound16Fixture(row) {
  return normalizeFifaKnockoutFixture(row, {
    stageId: FIFA_WORLD_CUP_SOURCE.round16StageId,
    matchStartNumber: ROUND16_MATCH_START_NUMBER,
    matchEndNumber: ROUND16_MATCH_END_NUMBER,
  });
}

function normalizeFifaFutureKnockoutFixture(row) {
  for (const config of FUTURE_KNOCKOUT_ROUND_CONFIGS) {
    const fixture = normalizeFifaKnockoutFixture(row, config);
    if (fixture) return { ...fixture, roundId: config.roundId, sourceKey: config.sourceKey };
  }
  return null;
}

function countFixtures(fixtures) {
  return fixtures.reduce(
    (counts, fixture) => ({
      ...counts,
      total: counts.total + 1,
      officialFinal: counts.officialFinal + (fixture.status === "official_final" ? 1 : 0),
      pending: counts.pending + (fixture.status === "official_final" ? 0 : 1),
    }),
    { total: 0, officialFinal: 0, pending: 0 },
  );
}

export function createPendingFifaQualificationSnapshot(issue = "") {
  const slots = Array.from({ length: ROUND32_SLOT_COUNT }, (_, index) => createUnrevealedSlot(index + 1));

  return {
    sourceStatus: "pending",
    sourceUrl: FIFA_STANDINGS_SOURCE_URL,
    fetchedAt: null,
    issue,
    groups: [],
    round32Slots: slots,
    counts: countSlots(slots),
  };
}

export function createPendingFifaRound32MatchesSnapshot(issue = "") {
  return {
    sourceStatus: "pending",
    sourceUrl: FIFA_ROUND32_MATCHES_SOURCE_URL,
    fetchedAt: null,
    issue,
    matches: [],
    counts: { total: 0, officialFinal: 0, pending: ROUND32_MATCH_COUNT },
  };
}

export function createPendingFifaRound16MatchesSnapshot(issue = "") {
  return {
    sourceStatus: "pending",
    sourceUrl: FIFA_ROUND16_MATCHES_SOURCE_URL,
    fetchedAt: null,
    issue,
    matches: [],
    counts: { total: 0, officialFinal: 0, pending: ROUND16_MATCH_COUNT },
  };
}

export function createPendingFifaFutureKnockoutMatchesSnapshot(issue = "") {
  return {
    sourceStatus: "pending",
    sourceUrl: FIFA_FUTURE_KNOCKOUT_MATCHES_SOURCE_URL,
    fetchedAt: null,
    issue,
    matches: [],
    counts: { total: 0, officialFinal: 0, pending: FUTURE_KNOCKOUT_MATCH_COUNT },
  };
}

export function normalizeFifaStandingsSnapshot(payload, fetchedAt = new Date().toISOString()) {
  const rows = Array.isArray(payload?.Results)
    ? payload.Results.map(normalizeStandingRow).filter((row) => row.idTeam || row.name)
    : [];

  if (rows.length === 0) {
    throw new Error("FIFA standings payload has no Results rows");
  }

  const { slots, groups } = buildRound32Slots(rows);

  return {
    sourceStatus: "live",
    sourceUrl: FIFA_STANDINGS_SOURCE_URL,
    fetchedAt,
    issue: "",
    groups,
    round32Slots: slots,
    counts: countSlots(slots),
  };
}

export function normalizeFifaRound32MatchesSnapshot(payload, fetchedAt = new Date().toISOString()) {
  const fixtures = Array.isArray(payload?.Results)
    ? payload.Results.map(normalizeFifaRound32Fixture).filter(Boolean)
      .sort((left, right) => left.matchNumber - right.matchNumber)
    : [];

  if (fixtures.length === 0) {
    throw new Error("FIFA round32 calendar payload has no round32 Results rows");
  }

  return {
    sourceStatus: "live",
    sourceUrl: FIFA_ROUND32_MATCHES_SOURCE_URL,
    fetchedAt,
    issue: fixtures.length < ROUND32_MATCH_COUNT
      ? `FIFA round32 calendar returned ${fixtures.length}/${ROUND32_MATCH_COUNT} matches.`
      : "",
    matches: fixtures,
    counts: countFixtures(fixtures),
  };
}

export function normalizeFifaRound16MatchesSnapshot(payload, fetchedAt = new Date().toISOString()) {
  const fixtures = Array.isArray(payload?.Results)
    ? payload.Results.map(normalizeFifaRound16Fixture).filter(Boolean)
      .sort((left, right) => left.matchNumber - right.matchNumber)
    : [];

  if (fixtures.length === 0) {
    throw new Error("FIFA round16 calendar payload has no round16 Results rows");
  }

  return {
    sourceStatus: "live",
    sourceUrl: FIFA_ROUND16_MATCHES_SOURCE_URL,
    fetchedAt,
    issue: fixtures.length < ROUND16_MATCH_COUNT
      ? `FIFA round16 calendar returned ${fixtures.length}/${ROUND16_MATCH_COUNT} matches.`
      : "",
    matches: fixtures,
    counts: countFixtures(fixtures),
  };
}

export function normalizeFifaFutureKnockoutMatchesSnapshot(payload, fetchedAt = new Date().toISOString()) {
  const fixtures = Array.isArray(payload?.Results)
    ? payload.Results.map(normalizeFifaFutureKnockoutFixture).filter(Boolean)
      .sort((left, right) => left.matchNumber - right.matchNumber)
    : [];

  if (fixtures.length === 0) {
    throw new Error("FIFA future knockout calendar payload has no Results rows");
  }

  return {
    sourceStatus: "live",
    sourceUrl: FIFA_FUTURE_KNOCKOUT_MATCHES_SOURCE_URL,
    fetchedAt,
    issue: fixtures.length < FUTURE_KNOCKOUT_MATCH_COUNT
      ? `FIFA future knockout calendar returned ${fixtures.length}/${FUTURE_KNOCKOUT_MATCH_COUNT} matches.`
      : "",
    matches: fixtures,
    counts: countFixtures(fixtures),
  };
}

export async function fetchFifaQualificationSnapshot(fetcher = fetch) {
  const response = await fetcher(FIFA_STANDINGS_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeFifaStandingsSnapshot(payload, new Date().toISOString());
}

export async function fetchFifaRound32MatchesSnapshot(fetcher = fetch) {
  const response = await fetcher(FIFA_ROUND32_MATCHES_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeFifaRound32MatchesSnapshot(payload, new Date().toISOString());
}

export async function fetchFifaRound16MatchesSnapshot(fetcher = fetch) {
  const response = await fetcher(FIFA_ROUND16_MATCHES_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeFifaRound16MatchesSnapshot(payload, new Date().toISOString());
}

export async function fetchFifaFutureKnockoutMatchesSnapshot(fetcher = fetch) {
  const response = await fetcher(FIFA_FUTURE_KNOCKOUT_MATCHES_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeFifaFutureKnockoutMatchesSnapshot(payload, new Date().toISOString());
}

function flagUrlForCode(abbreviation) {
  return abbreviation ? `https://api.fifa.com/api/v3/picture/flags-sq-4/${abbreviation}` : UNREVEALED_FLAG_SRC;
}

function createTeamLookup(teams) {
  const byName = new Map();
  teams.forEach((team) => {
    byName.set(normalizeLookup(team.name), team.id);
  });
  Object.entries(NAME_TO_LOCAL_TEAM_ID).forEach(([name, id]) => byName.set(name, id));
  return byName;
}

function resolveLocalTeamId(slot, teamsById, teamsByName) {
  const byCode = FIFA_CODE_TO_LOCAL_TEAM_ID[slot.abbreviation];
  if (byCode) return byCode;
  const byName = teamsByName.get(normalizeLookup(slot.teamName));
  return byName || "";
}

function createTeamForSlot(slot, teamsById, teamsByName) {
  if (slot.status === "unrevealed") {
    return {
      id: slot.teamId,
      name: "Unrevealed",
      flagSrc: UNREVEALED_FLAG_SRC,
      side: slot.slot % 2 === 0 ? "right" : "left",
      votes: 0,
      revealState: "unrevealed",
      liveQualification: slot,
    };
  }

  const localTeamId = resolveLocalTeamId(slot, teamsById, teamsByName);
  const baseTeam = teamsById.get(localTeamId);
  const teamId = baseTeam?.id ?? (localTeamId || `fifa-${slugify(slot.abbreviation || slot.teamName)}`);
  slot.teamId = teamId;

  return {
    ...(baseTeam ?? {
      id: teamId,
      seed: String(slot.slot).padStart(2, "0"),
      name: slot.teamName,
      flagSrc: flagUrlForCode(slot.abbreviation),
      side: slot.slot % 2 === 0 ? "right" : "left",
    }),
    votes: 0,
    fifaTeamId: slot.fifaTeamId,
    fifaAbbreviation: slot.abbreviation,
    liveQualification: slot,
  };
}

function canonicalVoteMatchIds(matchIds) {
  const values = Array.isArray(matchIds) ? matchIds : [matchIds];
  return Array.from(new Set(values.flatMap((matchId) => {
    const canonical = canonicalMatchId(matchId);
    return canonical ? [canonical] : [];
  })));
}

function readVoteLookupValue(source, key) {
  return typeof source?.get === "function" ? source.get(key) : source?.[key];
}

function getVoteTotal(voteTotalsByMatchTeam, matchIds, teamId) {
  for (const matchId of canonicalVoteMatchIds(matchIds)) {
    const value = readVoteLookupValue(voteTotalsByMatchTeam, `${matchId}:${teamId}`);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  }

  return 0;
}

function getVoterCount(voterCountsByMatch, matchIds) {
  for (const matchId of canonicalVoteMatchIds(matchIds)) {
    const value = readVoteLookupValue(voterCountsByMatch, matchId);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  }

  return 0;
}

function normalizeMatchCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function fixtureMatchCode(fixture) {
  const explicitCode = normalizeMatchCode(fixture?.matchCode);
  if (explicitCode) return explicitCode;
  const matchNumber = Number(fixture?.matchNumber);
  return Number.isFinite(matchNumber) ? `M${matchNumber}` : "";
}

function createTeamForFixtureTeam(fixtureTeam, side, teamsById, teamsByName, votes = 0) {
  if (!fixtureTeam?.fifaTeamId && !fixtureTeam?.abbreviation && !fixtureTeam?.name) {
    return {
      id: `unrevealed-${side}`,
      name: "Unrevealed",
      flagSrc: UNREVEALED_FLAG_SRC,
      side: side.includes("right") || side.includes("away") ? "right" : "left",
      votes: 0,
      revealState: "unrevealed",
      liveFixtureTeam: fixtureTeam,
    };
  }

  const localTeamId = resolveLocalTeamId({
    abbreviation: fixtureTeam.abbreviation,
    teamName: fixtureTeam.name,
  }, teamsById, teamsByName);
  const baseTeam = teamsById.get(localTeamId);
  const teamId = baseTeam?.id ?? (localTeamId || `fifa-${slugify(fixtureTeam.abbreviation || fixtureTeam.name)}`);

  return {
    ...(baseTeam ?? {
      id: teamId,
      seed: "",
      name: fixtureTeam.name,
      flagSrc: flagUrlForCode(fixtureTeam.abbreviation),
    }),
    id: teamId,
    side,
    votes,
    fifaTeamId: fixtureTeam.fifaTeamId,
    fifaAbbreviation: fixtureTeam.abbreviation,
    liveFixtureTeam: fixtureTeam,
  };
}

function createUnrevealedFixtureTeam(match, side) {
  return {
    id: `unrevealed-${match.id}-${side}`,
    name: "Unrevealed",
    flagSrc: UNREVEALED_FLAG_SRC,
    side: side === "away" ? "right" : "left",
    votes: 0,
    revealState: "unrevealed",
    liveFixtureTeam: { fifaTeamId: "", abbreviation: "", name: "" },
  };
}

function findWinnerTeamId(fixture, homeTeamId, awayTeamId) {
  if (!fixture?.winnerFifaTeamId) return null;
  if (fixture.winnerFifaTeamId === fixture.home.fifaTeamId) return homeTeamId;
  if (fixture.winnerFifaTeamId === fixture.away.fifaTeamId) return awayTeamId;
  return null;
}

function withMatchVoteTotals(match, homeTeamId, homeVotes, awayTeamId, awayVotes) {
  return {
    ...match,
    voteTotalsByTeamId: {
      [homeTeamId]: homeVotes,
      [awayTeamId]: awayVotes,
    },
  };
}

export function buildRealtimeRound32Preview({
  matches,
  teams,
  snapshot,
  fixtures,
  round16Fixtures,
  futureKnockoutFixtures,
  voteTotalsByMatchTeam,
  voterCountsByMatch,
}) {
  const sourceSnapshot = snapshot?.round32Slots?.length
    ? snapshot
    : createPendingFifaQualificationSnapshot();
  const sourceFixtures = fixtures?.matches?.length
    ? fixtures
    : createPendingFifaRound32MatchesSnapshot(fixtures?.issue || "");
  const sourceSlots = sourceSnapshot.round32Slots.slice(0, ROUND32_SLOT_COUNT);

  while (sourceSlots.length < ROUND32_SLOT_COUNT) {
    sourceSlots.push(createUnrevealedSlot(sourceSlots.length + 1));
  }

  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const teamsByName = createTeamLookup(teams);
  const liveTeamsById = new Map();
  const resolvedSlots = sourceSlots.map((slot) => {
    const resolvedSlot = { ...slot };
    const team = createTeamForSlot(resolvedSlot, teamsById, teamsByName);
    liveTeamsById.set(team.id, team);
    return { ...resolvedSlot, teamId: team.id };
  });

  const round32Matches = matches
    .filter((match) => match.roundId === ROUND32_ID)
    .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime());
  const sourceFixtureMatches = Array.isArray(sourceFixtures.matches) ? sourceFixtures.matches : [];
  const fixturesByMatchCode = new Map();
  const fixtureIndexes = new Map();
  sourceFixtureMatches.forEach((fixture, index) => {
    const code = fixtureMatchCode(fixture);
    if (code && !fixturesByMatchCode.has(code)) fixturesByMatchCode.set(code, fixture);
    fixtureIndexes.set(fixture, index);
  });
  const usedFixtureIndexes = new Set();
  let fallbackFixtureIndex = 0;
  const resolveFixtureForMatch = (match) => {
    const byCode = fixturesByMatchCode.get(normalizeMatchCode(match.displayCode));
    if (byCode) {
      const index = fixtureIndexes.get(byCode);
      if (index !== undefined) usedFixtureIndexes.add(index);
      return byCode;
    }

    while (usedFixtureIndexes.has(fallbackFixtureIndex)) fallbackFixtureIndex += 1;
    const fallback = sourceFixtureMatches[fallbackFixtureIndex] ?? null;
    if (fallback) {
      usedFixtureIndexes.add(fallbackFixtureIndex);
      fallbackFixtureIndex += 1;
    }
    return fallback;
  };
  const liveRound32Matches = new Map(round32Matches.map((match, index) => {
    const fixture = resolveFixtureForMatch(match, index);
    if (fixture) {
      const homeTeamId = resolveLocalTeamId({
        abbreviation: fixture.home.abbreviation,
        teamName: fixture.home.name,
      }, teamsById, teamsByName);
      const awayTeamId = resolveLocalTeamId({
        abbreviation: fixture.away.abbreviation,
        teamName: fixture.away.name,
      }, teamsById, teamsByName);
      const homeVotes = getVoteTotal(voteTotalsByMatchTeam, [match.id, match.displayCode, fixture.matchCode], homeTeamId);
      const awayVotes = getVoteTotal(voteTotalsByMatchTeam, [match.id, match.displayCode, fixture.matchCode], awayTeamId);
      const homeTeam = createTeamForFixtureTeam(
        fixture.home,
        "left",
        teamsById,
        teamsByName,
        homeVotes,
      );
      const awayTeam = createTeamForFixtureTeam(
        fixture.away,
        "right",
        teamsById,
        teamsByName,
        awayVotes,
      );
      liveTeamsById.set(homeTeam.id, homeTeam);
      liveTeamsById.set(awayTeam.id, awayTeam);
      const advancingTeamId = fixture.status === "official_final"
        ? findWinnerTeamId(fixture, homeTeam.id, awayTeam.id)
        : null;

      return [match.id, withMatchVoteTotals({
        ...match,
        status: fixture.status,
        displayCode: fixture.matchCode,
        fifaMatchNumber: fixture.matchNumber,
        teams: [homeTeam.id, awayTeam.id],
        kickoffAt: fixture.kickoffAt ?? match.kickoffAt,
        cutoffAt: fixture.cutoffAt ?? match.cutoffAt,
        venue: fixture.venue || match.venue,
        score: fixture.score ?? undefined,
        advancingTeamId,
        awaitingOfficialResult: false,
        poolEntries: 0,
        voterCount: getVoterCount(voterCountsByMatch, [match.id, match.displayCode, fixture.matchCode]),
        resultSnapshotId: advancingTeamId ? `fifa-r32-${fixture.matchCode.toLowerCase()}` : null,
        realtimePreview: true,
        source: "fifa-calendar-fixture",
        sourceUrl: sourceFixtures.sourceUrl,
        fetchedAt: sourceFixtures.fetchedAt,
        liveFixture: fixture,
      }, homeTeam.id, homeVotes, awayTeam.id, awayVotes)];
    }

    const leftSlot = createUnrevealedSlot(index * 2 + 1);
    const rightSlot = createUnrevealedSlot(index * 2 + 2);
    const leftTeam = createTeamForSlot(leftSlot, teamsById, teamsByName);
    const rightTeam = createTeamForSlot(rightSlot, teamsById, teamsByName);
    liveTeamsById.set(leftTeam.id, leftTeam);
    liveTeamsById.set(rightTeam.id, rightTeam);

    return [match.id, {
      ...match,
      status: "scheduled",
      teams: [leftTeam.id, rightTeam.id],
      score: undefined,
      advancingTeamId: null,
      awaitingOfficialResult: false,
      poolEntries: 0,
      voterCount: getVoterCount(voterCountsByMatch, [match.id, match.displayCode]),
      resultSnapshotId: null,
      realtimePreview: true,
      source: "fifa-calendar-pending",
      sourceUrl: sourceFixtures.sourceUrl,
      fetchedAt: sourceFixtures.fetchedAt,
      liveSlots: [leftSlot, rightSlot],
    }];
  }));

  const buildLiveKnockoutRoundMatches = ({
    roundId,
    fixtureRows,
    fallbackStartNumber,
    sourceKey,
    sourceUrl,
    fetchedAt,
  }) => {
    const roundMatches = matches
      .filter((match) => match.roundId === roundId)
      .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime());

    return roundMatches.map((match, index) => {
      const fixture = fixtureRows[index] ?? null;
      if (!fixture) {
        const homeTeam = createUnrevealedFixtureTeam(match, "home");
        const awayTeam = createUnrevealedFixtureTeam(match, "away");
        liveTeamsById.set(homeTeam.id, homeTeam);
        liveTeamsById.set(awayTeam.id, awayTeam);
        return [match.id, {
          ...match,
          displayCode: `M${fallbackStartNumber + index}`,
          teams: [homeTeam.id, awayTeam.id],
          teamsConfirmed: false,
          status: "scheduled",
          cutoffAt: null,
          score: undefined,
          advancingTeamId: null,
          poolEntries: 0,
          voterCount: getVoterCount(voterCountsByMatch, [match.id, match.displayCode]),
          resultSnapshotId: null,
          realtimePreview: true,
          source: `fifa-${sourceKey}-pending`,
          sourceUrl,
          fetchedAt,
        }];
      }

      const homeTeamId = resolveLocalTeamId({
        abbreviation: fixture.home.abbreviation,
        teamName: fixture.home.name,
      }, teamsById, teamsByName);
      const awayTeamId = resolveLocalTeamId({
        abbreviation: fixture.away.abbreviation,
        teamName: fixture.away.name,
      }, teamsById, teamsByName);
      const homeVotes = getVoteTotal(voteTotalsByMatchTeam, [match.id, match.displayCode, fixture.matchCode], homeTeamId);
      const awayVotes = getVoteTotal(voteTotalsByMatchTeam, [match.id, match.displayCode, fixture.matchCode], awayTeamId);
      const homeTeam = fixture.home.fifaTeamId
        ? createTeamForFixtureTeam(
          fixture.home,
          "left",
          teamsById,
          teamsByName,
          homeVotes,
        )
        : createUnrevealedFixtureTeam(match, "home");
      const awayTeam = fixture.away.fifaTeamId
        ? createTeamForFixtureTeam(
          fixture.away,
          "right",
          teamsById,
          teamsByName,
          awayVotes,
        )
        : createUnrevealedFixtureTeam(match, "away");
      liveTeamsById.set(homeTeam.id, homeTeam);
      liveTeamsById.set(awayTeam.id, awayTeam);
      const advancingTeamId = fixture.status === "official_final" && fixture.teamsConfirmed
        ? findWinnerTeamId(fixture, homeTeam.id, awayTeam.id)
        : null;

      return [match.id, withMatchVoteTotals({
        ...match,
        status: fixture.status,
        displayCode: fixture.matchCode,
        fifaMatchNumber: fixture.matchNumber,
        teams: [homeTeam.id, awayTeam.id],
        teamsConfirmed: fixture.teamsConfirmed,
        kickoffAt: fixture.kickoffAt ?? match.kickoffAt,
        cutoffAt: fixture.cutoffAt,
        venue: fixture.venue || match.venue,
        score: fixture.score ?? undefined,
        advancingTeamId,
        awaitingOfficialResult: false,
        poolEntries: 0,
        voterCount: getVoterCount(voterCountsByMatch, [match.id, match.displayCode, fixture.matchCode]),
        resultSnapshotId: advancingTeamId ? `fifa-${sourceKey}-${fixture.matchCode.toLowerCase()}` : null,
        realtimePreview: true,
        source: fixture.teamsConfirmed ? `fifa-${sourceKey}-fixture` : `fifa-${sourceKey}-pending-team`,
        sourceUrl,
        fetchedAt,
        liveFixture: fixture,
      }, homeTeam.id, homeVotes, awayTeam.id, awayVotes)];
    });
  };

  const sourceRound16Fixtures = Array.isArray(round16Fixtures?.matches) ? round16Fixtures.matches : [];
  const liveRound16Matches = new Map(buildLiveKnockoutRoundMatches({
    roundId: ROUND16_ID,
    fixtureRows: sourceRound16Fixtures,
    fallbackStartNumber: ROUND16_MATCH_START_NUMBER,
    sourceKey: "round16",
    sourceUrl: round16Fixtures?.sourceUrl || FIFA_ROUND16_MATCHES_SOURCE_URL,
    fetchedAt: round16Fixtures?.fetchedAt || null,
  }));

  const sourceFutureKnockoutFixtures = Array.isArray(futureKnockoutFixtures?.matches)
    ? futureKnockoutFixtures.matches
    : [];
  const liveFutureKnockoutMatches = new Map(FUTURE_KNOCKOUT_ROUND_CONFIGS.flatMap((config) => (
    buildLiveKnockoutRoundMatches({
      roundId: config.roundId,
      fixtureRows: sourceFutureKnockoutFixtures.filter((fixture) => fixture.roundId === config.roundId),
      fallbackStartNumber: config.matchStartNumber,
      sourceKey: config.sourceKey,
      sourceUrl: futureKnockoutFixtures?.sourceUrl || FIFA_FUTURE_KNOCKOUT_MATCHES_SOURCE_URL,
      fetchedAt: futureKnockoutFixtures?.fetchedAt || null,
    })
  )));

  const displayTeamsById = new Map(teams.map((team) => [team.id, team]));
  liveTeamsById.forEach((team, id) => displayTeamsById.set(id, team));

  return {
    matches: matches.map((match) => (
      liveRound32Matches.get(match.id)
      ?? liveRound16Matches.get(match.id)
      ?? liveFutureKnockoutMatches.get(match.id)
      ?? match
    )),
    teams: Array.from(displayTeamsById.values()),
    teamsById: displayTeamsById,
    snapshot: {
      ...sourceSnapshot,
      round32Slots: resolvedSlots,
      counts: countSlots(resolvedSlots),
    },
  };
}
