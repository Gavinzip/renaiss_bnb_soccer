export function getMatchCutoffTime(match) {
  const cutoffTime = Date.parse(match?.cutoffAt ?? "");
  return Number.isFinite(cutoffTime) ? cutoffTime : null;
}

export function resolveMatchRuntimeStatus(match, now = Date.now()) {
  const status = match?.status ?? "scheduled";
  if (status === "official_final") return status;

  const cutoffTime = getMatchCutoffTime(match);
  if (cutoffTime !== null && now >= cutoffTime) return "locked";

  return status;
}

export function resolveMatchRuntimeState(match, now = Date.now()) {
  const status = resolveMatchRuntimeStatus(match, now);
  return status === match?.status ? match : { ...match, status };
}
