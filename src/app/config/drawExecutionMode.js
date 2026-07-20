const supportedDrawExecutionModes = Object.freeze([
  "mainnet",
  "sandbox",
  "simulation",
]);

export function isEnabledEnvironmentValue(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

export function drawExecutionModesForOfficialMode(officialMode) {
  return officialMode ? ["mainnet"] : [...supportedDrawExecutionModes];
}

export const isOfficialDrawMode = isEnabledEnvironmentValue(
  import.meta.env?.VITE_DRAW_OFFICIAL_MODE,
);

export const drawExecutionModes = drawExecutionModesForOfficialMode(
  isOfficialDrawMode,
);

export function normalizeDrawExecutionMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return drawExecutionModes.includes(mode) ? mode : "mainnet";
}
