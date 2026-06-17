import fs from "node:fs";
import path from "node:path";

export const DEFAULT_TARGET_HANDLE = "renaissxyz";
export const DEFAULT_DATA_DIR = "data/x-followers";
export const DEFAULT_DELTA_MAX_PAGES = 2;
export const DEFAULT_WATCH_INTERVAL_MS = 60_000;

export function getConfig(overrides = {}) {
  loadDotEnv();

  const bearerToken =
    overrides.bearerToken ||
    process.env.X_BEARER_TOKEN ||
    process.env.X_API_BEARER_TOKEN ||
    "";

  const targetHandle =
    normalizeHandle(overrides.handle || process.env.X_TARGET_HANDLE || DEFAULT_TARGET_HANDLE);

  const dataDir = path.resolve(
    process.cwd(),
    overrides.dataDir || process.env.X_FOLLOWER_DATA_DIR || DEFAULT_DATA_DIR,
  );

  return {
    bearerToken,
    targetHandle,
    dataDir,
    apiBaseUrl: overrides.apiBaseUrl || process.env.X_API_BASE_URL || "https://api.x.com/2",
  };
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function normalizeHandle(handle) {
  if (!handle || typeof handle !== "string") {
    throw new Error("X handle is required.");
  }

  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function requireBearerToken(config) {
  if (!config.bearerToken) {
    throw new Error("Missing X_BEARER_TOKEN. Export it or add it to your runtime environment.");
  }
}
