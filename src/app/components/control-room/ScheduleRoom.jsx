import { TournamentArena, preloadTournamentArenaAssets } from "./TournamentArena";

export function preloadRoomAssets() {
  return preloadTournamentArenaAssets();
}

export function ScheduleRoom({
  activeRound,
  activeRoundId,
  simulatedRound,
  simulatedRoundId,
  rounds,
  matches,
  teamsById,
  selectedMatch,
  roundAllocations,
  onSelectRound,
  onSelectMatch,
  onSelectTeam,
  onSelectView,
}) {
  function handleOpenVote(matchId, teamId) {
    const match = matches.find((entry) => entry.id === matchId);
    if (match?.roundId) onSelectRound?.(match.roundId);
    onSelectMatch?.(matchId);
    onSelectTeam?.(teamId);
    onSelectView?.("vote");
  }

  return (
    <TournamentArena
      mode="schedule"
      activeRound={activeRound}
      activeRoundId={activeRoundId}
      simulatedRound={simulatedRound}
      simulatedRoundId={simulatedRoundId}
      rounds={rounds}
      matches={matches}
      teamsById={teamsById}
      selectedMatch={selectedMatch}
      roundAllocations={roundAllocations}
      onSelectMatch={onSelectMatch}
      onOpenVote={handleOpenVote}
    />
  );
}
