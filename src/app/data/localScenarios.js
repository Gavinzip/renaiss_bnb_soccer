const LOCAL_ROUND16_US_BELGIUM_MATCH_ID = "M94";
const LOCAL_ROUND16_US_BELGIUM_TEAM_IDS = ["united-states", "belgium"];

export function applyLocalScenarioMatches(matches) {
  return matches.map((match) => {
    if (match.id !== LOCAL_ROUND16_US_BELGIUM_MATCH_ID) return match;

    return {
      ...match,
      teams: LOCAL_ROUND16_US_BELGIUM_TEAM_IDS,
      advancingTeamId: LOCAL_ROUND16_US_BELGIUM_TEAM_IDS.includes(match.advancingTeamId)
        ? match.advancingTeamId
        : null,
    };
  });
}
