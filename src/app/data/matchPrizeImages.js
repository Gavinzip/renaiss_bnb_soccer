import defaultPrizeImage from "../assets/match-prize-card.webp";
import final01 from "../assets/match-prizes/final/final-01.webp";
import qf01 from "../assets/match-prizes/quarter-final/quarter-01.webp";
import qf02 from "../assets/match-prizes/quarter-final/quarter-02.webp";
import qf03 from "../assets/match-prizes/quarter-final/quarter-03.webp";
import qf04 from "../assets/match-prizes/quarter-final/quarter-04.webp";
import round16Eevee01 from "../assets/match-prizes/round16/eevee-01.webp";
import round16Eevee02 from "../assets/match-prizes/round16/eevee-02.webp";
import round16Eevee03 from "../assets/match-prizes/round16/eevee-03.webp";
import round16Eevee04 from "../assets/match-prizes/round16/eevee-04.webp";
import round16Eevee05 from "../assets/match-prizes/round16/eevee-05.webp";
import round16Eevee06 from "../assets/match-prizes/round16/eevee-06.webp";
import round16Eevee07 from "../assets/match-prizes/round16/eevee-07.webp";
import round16SobbleUsBelgium from "../assets/match-prizes/round16/sobble-us-belgium.webp";
import sf01 from "../assets/match-prizes/semi-final/semi-01.webp";
import sf02 from "../assets/match-prizes/semi-final/semi-02.webp";

const ROUND_PRIZE_IMAGES = {
  round16: [
    round16Eevee01,
    round16Eevee02,
    round16Eevee03,
    round16Eevee04,
    round16Eevee05,
    round16Eevee06,
    round16Eevee07,
    round16Eevee01,
  ],
  quarterFinal: [qf01, qf02, qf03, qf04],
  semiFinal: [sf01, sf02],
  final: [final01],
};

const EXTRA_ROUND_PRIZE_IMAGES = {
  round16: [round16SobbleUsBelgium],
};

const preloadedPrizeImages = new Map();
const completedPrizeImagePreloads = new Set();

function normalizeId(value) {
  return String(value || "").trim();
}

function includesBothTeams(match, leftTeamId, rightTeamId) {
  const teamIds = new Set(Array.isArray(match?.teams) ? match.teams : []);
  return teamIds.has(leftTeamId) && teamIds.has(rightTeamId);
}

function getRoundMatchIndex(match, matches = []) {
  if (!match?.id) return -1;

  return matches
    .filter((candidate) => candidate?.roundId === match.roundId)
    .findIndex((candidate) => candidate?.id === match.id);
}

export function getMatchPrizeImage(match, matchIndex = 0) {
  if (match?.roundId === "round16" && includesBothTeams(match, "united-states", "belgium")) {
    return round16SobbleUsBelgium;
  }

  const roundImages = ROUND_PRIZE_IMAGES[match?.roundId] || [];
  if (roundImages.length === 0) return defaultPrizeImage;

  return roundImages[Math.abs(matchIndex) % roundImages.length] || defaultPrizeImage;
}

export function getRoundPrizeImages(roundId) {
  const normalizedRoundId = normalizeId(roundId);
  const roundImages = ROUND_PRIZE_IMAGES[normalizedRoundId] || [];
  const extraImages = EXTRA_ROUND_PRIZE_IMAGES[normalizedRoundId] || [];
  const images = roundImages.length > 0 ? [...roundImages, ...extraImages] : [defaultPrizeImage];
  return Array.from(new Set(images.filter(Boolean)));
}

export function preloadRoundPrizeImages(roundId) {
  if (typeof window === "undefined" || typeof window.Image !== "function") return Promise.resolve();

  const preloads = getRoundPrizeImages(roundId).map((src) => {
    if (completedPrizeImagePreloads.has(src)) return Promise.resolve();
    if (preloadedPrizeImages.has(src)) return preloadedPrizeImages.get(src);

    const preload = new Promise((resolve) => {
      const image = new window.Image();
      const markComplete = () => {
        completedPrizeImagePreloads.add(src);
        preloadedPrizeImages.delete(src);
        resolve();
      };
      image.decoding = "async";
      image.onload = markComplete;
      image.onerror = markComplete;
      image.src = src;
    });
    preloadedPrizeImages.set(src, preload);
    return preload;
  });

  return Promise.all(preloads).then(() => undefined);
}

export function getMatchPrizeImageFromList(match, matches = []) {
  const roundMatchIndex = getRoundMatchIndex(match, matches);
  return getMatchPrizeImage(match, roundMatchIndex >= 0 ? roundMatchIndex : 0);
}

export function getMatchPrizeImageByMatchId(matchId, matches = [], fallbackRoundId = "") {
  const normalizedMatchId = normalizeId(matchId);
  const match = matches.find((candidate) => normalizeId(candidate?.id) === normalizedMatchId);

  if (match) return getMatchPrizeImageFromList(match, matches);

  const roundImages = ROUND_PRIZE_IMAGES[normalizeId(fallbackRoundId)] || [];
  return roundImages[0] || defaultPrizeImage;
}
