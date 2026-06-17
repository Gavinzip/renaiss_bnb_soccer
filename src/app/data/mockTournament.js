const ADVANCING_TEAM_IDS_BY_STAGE = {
  quarterFinal: [
    "brazil",
    "france",
    "argentina",
    "japan",
    "italy",
    "belgium",
    "uruguay",
    "south-korea",
  ],
  semiFinal: ["brazil", "argentina", "italy", "uruguay"],
  final: ["brazil", "italy"],
};

const STAGE_ORDER = ["round16", "quarterFinal", "semiFinal", "final"];

const COMPLETED_MATCHUPS_BY_STAGE = {
  round16: [
    ["england", "brazil", "brazil"],
    ["france", "germany", "france"],
    ["argentina", "portugal", "argentina"],
    ["netherlands", "japan", "japan"],
    ["spain", "italy", "italy"],
    ["belgium", "croatia", "belgium"],
    ["uruguay", "morocco", "uruguay"],
    ["colombia", "south-korea", "south-korea"],
  ],
  quarterFinal: [
    ["brazil", "france", "brazil"],
    ["argentina", "japan", "argentina"],
    ["italy", "belgium", "italy"],
    ["uruguay", "south-korea", "uruguay"],
  ],
  semiFinal: [
    ["brazil", "argentina", "brazil"],
    ["italy", "uruguay", "italy"],
  ],
};

const MATCHUP_STAGE_META = {
  round16: {
    id: "round16",
    label: "16 -> 8",
  },
  quarterFinal: {
    id: "quarterFinal",
    label: "8 -> 4",
  },
  semiFinal: {
    id: "semiFinal",
    label: "4 -> 2",
  },
};

export function createMockStageTeamIds(teams) {
  const allTeamIds = teams.map((team) => team.id);

  return {
    round16: allTeamIds,
    quarterFinal: ADVANCING_TEAM_IDS_BY_STAGE.quarterFinal,
    semiFinal: ADVANCING_TEAM_IDS_BY_STAGE.semiFinal,
    final: ADVANCING_TEAM_IDS_BY_STAGE.final,
  };
}

function getCompletedStageIds(activeStageId) {
  const activeIndex = STAGE_ORDER.indexOf(activeStageId);
  if (activeIndex < 0) return [];

  return STAGE_ORDER.slice(0, activeIndex).filter((stageId) => COMPLETED_MATCHUPS_BY_STAGE[stageId]);
}

function getTeam(teamsById, teamId) {
  return teamsById.get(teamId);
}

function buildCompletedMatchups(activeStageId, teamsById) {
  return getCompletedStageIds(activeStageId).flatMap((stageId) => {
    const meta = MATCHUP_STAGE_META[stageId];

    return COMPLETED_MATCHUPS_BY_STAGE[stageId].map(([teamAId, teamBId, winnerId], matchIndex) => {
      const loserId = winnerId === teamAId ? teamBId : teamAId;

      return {
        id: `${stageId}-${matchIndex}`,
        stageId,
        stageLabel: meta.label,
        winner: getTeam(teamsById, winnerId),
        loser: getTeam(teamsById, loserId),
        teams: [getTeam(teamsById, teamAId), getTeam(teamsById, teamBId)],
      };
    });
  });
}

function buildTeamProgress(teams, completedMatchups) {
  const progress = Object.fromEntries(
    teams.map((team) => [
      team.id,
      {
        wins: 0,
        latestDefeatedTeam: null,
        completedMatchups: [],
      },
    ]),
  );

  completedMatchups.forEach((matchup) => {
    if (!matchup.winner) return;

    progress[matchup.winner.id].wins += 1;
    progress[matchup.winner.id].latestDefeatedTeam = matchup.loser;
    progress[matchup.winner.id].completedMatchups.push(matchup);
  });

  return progress;
}

export function getMockTournamentState(stageId, teams, stageTeamIds) {
  const allTeamIds = teams.map((team) => team.id);
  const activeTeamIds = stageTeamIds[stageId] ?? allTeamIds;
  const activeTeamIdSet = new Set(activeTeamIds);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const completedMatchups = buildCompletedMatchups(stageId, teamsById);

  return {
    activeTeamIds,
    activeTeams: teams.filter((team) => activeTeamIdSet.has(team.id)),
    completedMatchups,
    eliminatedTeamIds: allTeamIds.filter((teamId) => !activeTeamIdSet.has(teamId)),
    teamProgressById: buildTeamProgress(teams, completedMatchups),
  };
}
