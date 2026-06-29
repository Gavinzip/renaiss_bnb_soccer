export const FIFA_WORLD_CUP_SOURCE = {
  competitionId: "17",
  seasonId: "285023",
  groupStageId: "289273",
};

export const FIFA_STANDINGS_SOURCE_URL = `https://api.fifa.com/api/v3/standings/season/${FIFA_WORLD_CUP_SOURCE.seasonId}/stage/${FIFA_WORLD_CUP_SOURCE.groupStageId}`;

const ROUND32_ID = "round32";
const ROUND32_SLOT_COUNT = 32;
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

export async function fetchFifaQualificationSnapshot(fetcher = fetch) {
  const response = await fetcher(FIFA_STANDINGS_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeFifaStandingsSnapshot(payload, new Date().toISOString());
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

export function buildRealtimeRound32Preview({ matches, teams, snapshot }) {
  const sourceSnapshot = snapshot?.round32Slots?.length
    ? snapshot
    : createPendingFifaQualificationSnapshot();
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
  const liveRound32Matches = new Map(round32Matches.map((match, index) => {
    const leftSlot = resolvedSlots[index * 2] ?? createUnrevealedSlot(index * 2 + 1);
    const rightSlot = resolvedSlots[index * 2 + 1] ?? createUnrevealedSlot(index * 2 + 2);
    const awaitingOfficialResult = match.status === "official_final";

    return [match.id, {
      ...match,
      status: awaitingOfficialResult ? "locked" : match.status,
      teams: [leftSlot.teamId, rightSlot.teamId],
      advancingTeamId: null,
      awaitingOfficialResult,
      poolEntries: 0,
      resultSnapshotId: null,
      realtimePreview: true,
      source: "fifa-standings-preview",
      sourceUrl: sourceSnapshot.sourceUrl,
      fetchedAt: sourceSnapshot.fetchedAt,
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
