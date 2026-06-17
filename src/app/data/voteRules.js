export const BASE_TICKET_COUNT = 87;

export const voteStages = [
  {
    id: "round16",
    navLabel: "Round of 16",
    tableLabel: "Before 16",
    actionLabel: "16-team stage",
    votesPerBaseTicket: 18,
  },
  {
    id: "quarterFinal",
    navLabel: "Quarter Finals",
    tableLabel: "Before 8",
    actionLabel: "Quarter finals",
    votesPerBaseTicket: 9,
  },
  {
    id: "semiFinal",
    navLabel: "Semi Finals",
    tableLabel: "Before 4",
    actionLabel: "Semi finals",
    votesPerBaseTicket: 4,
  },
  {
    id: "final",
    navLabel: "Final",
    tableLabel: "Before final",
    actionLabel: "Final",
    votesPerBaseTicket: 2,
  },
];

export function createStageVotePools(baseTicketCount = BASE_TICKET_COUNT) {
  return voteStages.map((stage) => ({
    ...stage,
    baseTicketCount,
    totalVotes: baseTicketCount * stage.votesPerBaseTicket,
  }));
}

export function createStageVoteBalance(stageVotePools) {
  return Object.fromEntries(stageVotePools.map((stage) => [stage.id, stage.totalVotes]));
}

export function sumStageVotes(stageVotePools) {
  return stageVotePools.reduce((total, stage) => total + stage.totalVotes, 0);
}
