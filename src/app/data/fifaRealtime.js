export const FIFA_WORLD_CUP_SOURCE = {
  competitionId: "17",
  seasonId: "285023",
  groupStageId: "289273",
  round32StageId: "289287",
};

export const FIFA_STANDINGS_SOURCE_URL = `https://api.fifa.com/api/v3/standings/season/${FIFA_WORLD_CUP_SOURCE.seasonId}/stage/${FIFA_WORLD_CUP_SOURCE.groupStageId}`;
export const FIFA_ROUND32_MATCHES_SOURCE_URL = `https://api.fifa.com/api/v3/calendar/matches?idCompetition=${FIFA_WORLD_CUP_SOURCE.competitionId}&idSeason=${FIFA_WORLD_CUP_SOURCE.seasonId}&count=200&language=en&from=2026-06-27&to=2026-07-05`;

const ROUND32_ID = "round32";
const ROUND32_SLOT_COUNT = 32;
const ROUND32_MATCH_COUNT = 16;
const ROUND32_MATCH_START_NUMBER = 73;
const ROUND32_MATCH_END_NUMBER = 88;
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
  return {
    fifaTeamId: String(team?.IdTeam || ""),
    abbreviation,
    name: getFixtureTeamName(team),
  };
}

function normalizeFifaRound32Fixture(row) {
  const stageId = String(row?.IdStage || "");
  const matchNumber = readNumber(row?.MatchNumber, 0);
  if (stageId !== FIFA_WORLD_CUP_SOURCE.round32StageId) return null;
  if (matchNumber < ROUND32_MATCH_START_NUMBER || matchNumber > ROUND32_MATCH_END_NUMBER) return null;

  const home = normalizeFifaFixtureTeam(row?.Home);
  const away = normalizeFifaFixtureTeam(row?.Away);
  if (!home.fifaTeamId && !away.fifaTeamId && home.name === "Unknown" && away.name === "Unknown") return null;

  const kickoffMs = Date.parse(row?.Date ?? "");
  const kickoffAt = Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null;
  const cutoffAt = kickoffAt ? new Date(kickoffMs - 60 * 60 * 1000).toISOString() : null;
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
    matchStatus,
    officialityStatus,
    source: "fifa-calendar",
    home,
    away,
  };
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
  if (byCode && teamsById.has(byCode)) return byCode;
  const byName = teamsByName.get(normalizeLookup(slot.teamName));
  return byName && teamsById.has(byName) ? byName : "";
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
  const teamId = baseTeam?.id ?? `fifa-${slugify(slot.abbreviation || slot.teamName)}`;
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

function getVoteTotal(voteTotalsByMatchTeam, matchId, teamId) {
  const key = `${matchId}:${teamId}`;
  const value = typeof voteTotalsByMatchTeam?.get === "function"
    ? voteTotalsByMatchTeam.get(key)
    : voteTotalsByMatchTeam?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function getVoterCount(voterCountsByMatch, matchId) {
  const value = typeof voterCountsByMatch?.get === "function"
    ? voterCountsByMatch.get(matchId)
    : voterCountsByMatch?.[matchId];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
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
  const localTeamId = resolveLocalTeamId({
    abbreviation: fixtureTeam.abbreviation,
    teamName: fixtureTeam.name,
  }, teamsById, teamsByName);
  const baseTeam = teamsById.get(localTeamId);
  const teamId = baseTeam?.id ?? `fifa-${slugify(fixtureTeam.abbreviation || fixtureTeam.name)}`;

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

function findWinnerTeamId(fixture, homeTeamId, awayTeamId) {
  if (!fixture?.winnerFifaTeamId) return null;
  if (fixture.winnerFifaTeamId === fixture.home.fifaTeamId) return homeTeamId;
  if (fixture.winnerFifaTeamId === fixture.away.fifaTeamId) return awayTeamId;
  return null;
}

export function buildRealtimeRound32Preview({ matches, teams, snapshot, fixtures, voteTotalsByMatchTeam, voterCountsByMatch }) {
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
      const homeTeam = createTeamForFixtureTeam(
        fixture.home,
        "left",
        teamsById,
        teamsByName,
        getVoteTotal(voteTotalsByMatchTeam, match.id, resolveLocalTeamId({
          abbreviation: fixture.home.abbreviation,
          teamName: fixture.home.name,
        }, teamsById, teamsByName)),
      );
      const awayTeam = createTeamForFixtureTeam(
        fixture.away,
        "right",
        teamsById,
        teamsByName,
        getVoteTotal(voteTotalsByMatchTeam, match.id, resolveLocalTeamId({
          abbreviation: fixture.away.abbreviation,
          teamName: fixture.away.name,
        }, teamsById, teamsByName)),
      );
      liveTeamsById.set(homeTeam.id, homeTeam);
      liveTeamsById.set(awayTeam.id, awayTeam);
      const advancingTeamId = fixture.status === "official_final"
        ? findWinnerTeamId(fixture, homeTeam.id, awayTeam.id)
        : null;

      return [match.id, {
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
        voterCount: getVoterCount(voterCountsByMatch, match.id),
        resultSnapshotId: advancingTeamId ? `fifa-r32-${fixture.matchCode.toLowerCase()}` : null,
        realtimePreview: true,
        source: "fifa-calendar-fixture",
        sourceUrl: sourceFixtures.sourceUrl,
        fetchedAt: sourceFixtures.fetchedAt,
        liveFixture: fixture,
      }];
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
      voterCount: getVoterCount(voterCountsByMatch, match.id),
      resultSnapshotId: null,
      realtimePreview: true,
      source: "fifa-calendar-pending",
      sourceUrl: sourceFixtures.sourceUrl,
      fetchedAt: sourceFixtures.fetchedAt,
      liveSlots: [leftSlot, rightSlot],
    }];
  }));

  const displayTeamsById = new Map(teams.map((team) => [team.id, team]));
  liveTeamsById.forEach((team, id) => displayTeamsById.set(id, team));

  return {
    matches: matches.map((match) => liveRound32Matches.get(match.id) ?? match),
    teams: Array.from(displayTeamsById.values()),
    teamsById: displayTeamsById,
    snapshot: {
      ...sourceSnapshot,
      round32Slots: resolvedSlots,
      counts: countSlots(resolvedSlots),
    },
  };
}
