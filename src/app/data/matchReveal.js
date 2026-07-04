const prizePreviewRoundIds = new Set(["quarterFinal", "semiFinal", "final"]);

export function isPrizePreviewRound(roundId) {
  return prizePreviewRoundIds.has(String(roundId || ""));
}

export function isUnrevealedPrizePreviewMatch(match) {
  if (!match || !isPrizePreviewRound(match.roundId)) return false;
  return match.teamsConfirmed !== true;
}
