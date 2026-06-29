export function getMatchCutoffTime(match) {
  const cutoffTime = Date.parse(match?.cutoffAt ?? "");
  return Number.isFinite(cutoffTime) ? cutoffTime : null;
}

export function getMatchKickoffTime(match) {
  const kickoffTime = Date.parse(match?.kickoffAt ?? "");
  return Number.isFinite(kickoffTime) ? kickoffTime : null;
}

export function resolveMatchRuntimeStatus(match, now = Date.now()) {
  const status = match?.status ?? "scheduled";
  if (status === "official_final") return status;

  const kickoffTime = getMatchKickoffTime(match);
  if (kickoffTime !== null && now >= kickoffTime) return "in_play";

  const cutoffTime = getMatchCutoffTime(match);
  if (cutoffTime !== null && now >= cutoffTime) return "locked";
  if (cutoffTime !== null && now < cutoffTime) {
    return status === "closing_soon" ? "closing_soon" : "open";
  }

  return status;
}

export function resolveMatchRuntimeState(match, now = Date.now()) {
  const status = resolveMatchRuntimeStatus(match, now);
  return status === match?.status ? match : { ...match, status };
}
