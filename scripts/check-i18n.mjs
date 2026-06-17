import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { milestones, roundDefinitions } from "../src/app/data/worldCupCampaign.js";
import { TEAM_NAMES, VENUE_NAMES } from "../src/app/i18n/entities.js";
import { DEFAULT_LOCALE, LOCALES, TRANSLATIONS } from "../src/app/i18n/translations.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(rootDir, "src/app");

function listSourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listSourceFiles(fullPath);
    return /\.(js|jsx)$/.test(entry) ? [fullPath] : [];
  });
}

function collectLeafPaths(value, prefix = "") {
  if (typeof value === "string") return [prefix];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectLeafPaths(item, `${prefix}.${index}`));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function readPath(value, key) {
  return key.split(".").reduce((current, part) => current?.[part], value);
}

function uniqueMatches(source, regex) {
  const matches = new Set();
  let match;
  while ((match = regex.exec(source))) matches.add(match[1]);
  return [...matches].sort();
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const errors = [];
const localeIds = LOCALES.map((locale) => locale.id);
const defaultLeafPaths = collectLeafPaths(TRANSLATIONS[DEFAULT_LOCALE]).sort();
const roundLocaleFields = ["label", "englishLabel", "advanceLabel", "prize", "windowLabel"];

localeIds.forEach((locale) => {
  const dictionary = TRANSLATIONS[locale];
  assert(Boolean(dictionary), `${locale}: missing translation dictionary`, errors);
  defaultLeafPaths.forEach((key) => {
    assert(typeof readPath(dictionary, key) === "string", `${locale}: missing translation key ${key}`, errors);
  });
});

localeIds.forEach((locale) => {
  roundDefinitions.forEach((round) => {
    roundLocaleFields.forEach((field) => {
      assert(
        typeof readPath(TRANSLATIONS[locale], `rounds.${round.id}.${field}`) === "string",
        `${locale}: round translation is missing ${round.id}.${field}`,
        errors,
      );
    });
  });

  milestones.forEach((milestone) => {
    const value = readPath(TRANSLATIONS[locale], `milestones.${milestone.id}`);
    assert(
      Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string",
      `${locale}: milestone translation is missing ${milestone.id}`,
      errors,
    );
  });
});

const codeFiles = listSourceFiles(appDir).filter((file) => !file.endsWith("translations.js"));
const staticTranslationKeys = new Set();
codeFiles.forEach((file) => {
  const source = readFileSync(file, "utf8");
  const keyPattern = /\bt\(\s*(["'`])([^"'`$]+)\1/g;
  let match;
  while ((match = keyPattern.exec(source))) {
    staticTranslationKeys.add(match[2]);
  }
});

localeIds.forEach((locale) => {
  staticTranslationKeys.forEach((key) => {
    assert(typeof readPath(TRANSLATIONS[locale], key) === "string", `${locale}: static t() key is missing ${key}`, errors);
  });
});

const teamSourcePath = path.join(appDir, "data/teams.js");
if (existsSync(teamSourcePath)) {
  const teamIds = uniqueMatches(readFileSync(teamSourcePath, "utf8"), /\bid:\s*"([^"]+)"/g);
  localeIds.forEach((locale) => {
    teamIds.forEach((id) => {
      assert(typeof TEAM_NAMES[locale]?.[id] === "string", `${locale}: team translation is missing ${id}`, errors);
    });
  });
}

const campaignSourcePath = path.join(appDir, "data/worldCupCampaign.js");
if (existsSync(campaignSourcePath)) {
  const venues = uniqueMatches(readFileSync(campaignSourcePath, "utf8"), /\bvenue:\s*"([^"]+)"/g);
  localeIds.forEach((locale) => {
    venues.forEach((venue) => {
      assert(typeof VENUE_NAMES[locale]?.[venue] === "string", `${locale}: venue translation is missing ${venue}`, errors);
    });
  });
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`i18n check passed: ${localeIds.join(", ")} · ${defaultLeafPaths.length} keys · ${staticTranslationKeys.size} static usages`);
