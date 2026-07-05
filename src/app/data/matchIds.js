export function canonicalMatchId(matchId) {
  return String(matchId || "").trim().toUpperCase();
}

export function sameMatchId(left, right) {
  const canonicalLeft = canonicalMatchId(left);
  return Boolean(canonicalLeft) && canonicalLeft === canonicalMatchId(right);
}
