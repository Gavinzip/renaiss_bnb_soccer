const SIMULATED_STAGE_IDS = ["round16", "quarterFinal", "semiFinal", "final"];

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compactWallet(index) {
  const left = (0x7a3e + index * 9137).toString(16).padStart(4, "0").slice(-4);
  const right = (0x9f21 + index * 3571).toString(16).padStart(4, "0").slice(-4);
  return `0x${left}...${right}`;
}

export const simulatedVoters = Array.from({ length: 100 }, (_, index) => ({
  id: `sim-voter-${String(index + 1).padStart(3, "0")}`,
  name: `Voter ${String(index + 1).padStart(3, "0")}`,
  wallet: compactWallet(index + 1),
  baseTickets: 1 + (index % 4),
}));

function pickWeightedTeam(teams, voter, stage, stageIndex) {
  const weights = teams.map((team, index) => {
    const popularityWeight = Math.max(8, Math.round(team.votes / 18000));
    const bracketBias = Math.max(1, teams.length - index);
    return popularityWeight + bracketBias + stageIndex;
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let pointer = hashString(`${voter.id}:${stage.id}`) % totalWeight;

  for (let index = 0; index < teams.length; index += 1) {
    pointer -= weights[index];
    if (pointer < 0) return teams[index];
  }

  return teams[teams.length - 1];
}

export function createSimulatedVoteProfiles(teams, stageVotePools, stageTeamIds = {}) {
  const stages = stageVotePools.filter((stage) => SIMULATED_STAGE_IDS.includes(stage.id));
  const profiles = Object.fromEntries(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        populationSize: simulatedVoters.length,
        totalVotes: 0,
        uniqueVoters: 0,
        stages: stages.map((stage) => ({
          id: stage.id,
          navLabel: stage.navLabel,
          label: stage.tableLabel,
          shortLabel: stage.shortLabel,
          votesPerBaseTicket: stage.votesPerBaseTicket,
          votes: 0,
          voterCount: 0,
        })),
        votersById: {},
      },
    ]),
  );

  stages.forEach((stage, stageIndex) => {
    const eligibleTeamIds = stageTeamIds[stage.id];
    const eligibleTeams = eligibleTeamIds
      ? teams.filter((team) => eligibleTeamIds.includes(team.id))
      : teams;

    simulatedVoters.forEach((voter) => {
      const team = pickWeightedTeam(eligibleTeams, voter, stage, stageIndex);
      const votes = voter.baseTickets * stage.votesPerBaseTicket;
      const profile = profiles[team.id];
      const stageProfile = profile.stages.find((entry) => entry.id === stage.id);

      profile.totalVotes += votes;
      stageProfile.votes += votes;
      stageProfile.voterCount += 1;

      if (!profile.votersById[voter.id]) {
        profile.votersById[voter.id] = {
          ...voter,
          totalVotes: 0,
          stages: [],
        };
      }

      profile.votersById[voter.id].totalVotes += votes;
      profile.votersById[voter.id].stages.push({
        id: stage.id,
        navLabel: stage.navLabel,
        label: stage.tableLabel,
        shortLabel: stage.shortLabel,
        votes,
      });
    });
  });

  return Object.fromEntries(
    Object.entries(profiles).map(([teamId, profile]) => {
      const voters = Object.values(profile.votersById).sort((a, b) => b.totalVotes - a.totalVotes);

      return [
        teamId,
        {
          teamId,
          populationSize: profile.populationSize,
          totalVotes: profile.totalVotes,
          uniqueVoters: voters.length,
          stages: profile.stages,
          voters,
        },
      ];
    }),
  );
}

export function createVisibleVoteProfile(profile, visibleStageIds) {
  if (!profile) return null;

  const visibleIdSet = new Set(visibleStageIds);
  const stages = profile.stages.filter((stage) => visibleIdSet.has(stage.id));
  const voters = profile.voters
    .map((voter) => {
      const voterStages = voter.stages.filter((stage) => visibleIdSet.has(stage.id));
      const totalVotes = voterStages.reduce((total, stage) => total + stage.votes, 0);

      return {
        ...voter,
        totalVotes,
        stages: voterStages,
      };
    })
    .filter((voter) => voter.totalVotes > 0)
    .sort((a, b) => b.totalVotes - a.totalVotes);

  return {
    ...profile,
    totalVotes: stages.reduce((total, stage) => total + stage.votes, 0),
    uniqueVoters: voters.length,
    stages,
    voters,
  };
}
