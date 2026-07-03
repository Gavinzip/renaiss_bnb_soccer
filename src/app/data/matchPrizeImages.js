import defaultPrizeImage from "../assets/match-prize-card.webp";
import final01 from "../assets/match-prizes/final/final-01.jpg";
import qf01 from "../assets/match-prizes/quarter-final/quarter-01.jpg";
import qf02 from "../assets/match-prizes/quarter-final/quarter-02.jpg";
import qf03 from "../assets/match-prizes/quarter-final/quarter-03.jpg";
import qf04 from "../assets/match-prizes/quarter-final/quarter-04.jpg";
import round16Eevee01 from "../assets/match-prizes/round16/eevee-01.jpg";
import round16Eevee02 from "../assets/match-prizes/round16/eevee-02.jpg";
import round16Eevee03 from "../assets/match-prizes/round16/eevee-03.jpg";
import round16Eevee04 from "../assets/match-prizes/round16/eevee-04.jpg";
import round16Eevee05 from "../assets/match-prizes/round16/eevee-05.jpg";
import round16Eevee06 from "../assets/match-prizes/round16/eevee-06.jpg";
import round16Eevee07 from "../assets/match-prizes/round16/eevee-07.jpg";
import round16SobbleUsBelgium from "../assets/match-prizes/round16/sobble-us-belgium.jpg";
import sf01 from "../assets/match-prizes/semi-final/semi-01.jpg";
import sf02 from "../assets/match-prizes/semi-final/semi-02.jpg";

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
