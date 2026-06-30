import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  LockKeyhole,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import trophyImage from "../../assets/championship-trophy-renaiss-mark.webp";
import { formatNumber } from "../../data/ticketMath";
import { preloadImage } from "../../utils/preloadAssets";
import { useBorderGlow } from "../BorderGlow";
import LightRays from "../LightRays/LightRays";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

const voteableStatuses = new Set(["open", "closing_soon"]);
const trophyRouteSocket = {
  minGap: 22,
  maxGap: 34,
  widthRatio: 0.1,
};
const trophyVisibleBounds = {
  left: 327 / 1122,
  right: 321 / 1122,
};
const routeLaneCurve = 0.82;
const pairAccentColors = [
  "239, 191, 102",
  "106, 224, 176",
  "112, 173, 255",
  "233, 134, 166",
  "196, 154, 255",
  "255, 151, 109",
  "145, 219, 255",
  "211, 224, 128",
];

export function preloadTournamentArenaAssets() {
  return preloadImage(trophyImage);
}

function displayPoolForMatch(match, teamsById) {
  const teams = match?.teams?.map((teamId) => teamsById.get(teamId)).filter(Boolean) ?? [];
  const voteSignal = teams.reduce((total, team) => total + (team.votes ?? 0), 0);
  if (match?.realtimePreview) return voteSignal;
  if ((match?.poolEntries ?? 0) > 0) return match.poolEntries;
  return Math.max(4200, Math.round(voteSignal * 0.082));
}

function matchDisplayCode(match) {
  return String(match?.displayCode || match?.id || "").toUpperCase();
}

function matchGmtDateTime(match, locale) {
  const date = new Date(match?.kickoffAt || "");
  if (Number.isNaN(date.getTime())) return "";

  return `${new Intl.DateTimeFormat(locale === "zh-Hant" ? "zh-Hant" : "en-US", {
    timeZone: "GMT",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)} GMT`;
}

function getTeamAllocation(match, team, allocations) {
  return allocations.find((allocation) => allocation.matchId === match?.id && allocation.teamId === team?.id);
}

function getTeamTone(match, team, allocation) {
  if (!match || !team) return "scheduled";
  if (team.liveQualification?.status) return team.liveQualification.status;
  if (allocation?.teamId === team.id) return "allocated";
  if (match.advancingTeamId === team.id) return "winner";
  if (match.advancingTeamId && match.advancingTeamId !== team.id) return "eliminated";
  return match.status;
}

function getTeamLabel({ match, team, allocation, copy }) {
  const { matchStatusCompact, t } = copy;
  if (allocation?.teamId === team?.id) return t("schedule.myPick", { tickets: formatNumber(allocation.tickets) });
  if (match?.advancingTeamId === team?.id) return t("common.advancing");
  if (match?.advancingTeamId && match.advancingTeamId !== team?.id) return t("schedule.eliminated");
  if (match?.awaitingOfficialResult) return t("vote.phasePendingResult");
  return matchStatusCompact(match?.status ?? "scheduled");
}

function formatRoutePoint(value) {
  return Number(value).toFixed(1);
}

function routeLayerEquals(current, next) {
  const currentPaths = current.paths ?? [];
  const currentNodes = current.nodes ?? [];
  const nextPaths = next.paths ?? [];
  const nextNodes = next.nodes ?? [];

  if (
    current.roundId !== next.roundId
    || current.width !== next.width
    || current.height !== next.height
    || currentPaths.length !== nextPaths.length
    || currentNodes.length !== nextNodes.length
  ) {
    return false;
  }

  const pathsMatch = currentPaths.every((route, index) => {
    const nextRoute = nextPaths[index];
    return route.id === nextRoute.id
      && route.d === nextRoute.d
      && route.side === nextRoute.side
      && Boolean(route.trophy) === Boolean(nextRoute.trophy)
      && route.active === nextRoute.active
      && route.delay === nextRoute.delay;
  });

  if (!pathsMatch) return false;

  return currentNodes.every((node, index) => {
    const nextNode = nextNodes[index];
    return node.id === nextNode.id
      && node.cx === nextNode.cx
      && node.cy === nextNode.cy
      && node.side === nextNode.side
      && node.final === nextNode.final
      && node.active === nextNode.active
      && node.delay === nextNode.delay;
  });
}

function mergeRoutePath(start, end) {
  return [
    `M${formatRoutePoint(start.x)} ${formatRoutePoint(start.y)}`,
    `H${formatRoutePoint(end.x)}`,
    `V${formatRoutePoint(end.y)}`,
  ].join(" ");
}

function createRoutePath({ id, side, start, end, active, trophy = false, delay = 0 }) {
  return {
    id,
    side,
    active,
    trophy,
    delay,
    d: mergeRoutePath(start, end),
  };
}

function createTrophySocketPath({ id, side, start, endX, active, delay = 0 }) {
  return {
    id,
    side,
    active,
    trophy: true,
    delay,
    d: [
      `M${formatRoutePoint(start.x)} ${formatRoutePoint(start.y)}`,
      `H${formatRoutePoint(endX)}`,
    ].join(" "),
  };
}

function createRouteColumnXs({ startX, endX, direction, count }) {
  if (count <= 1) return [endX];

  const run = Math.abs(endX - startX);
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) return endX;

    const progress = (index + 1) / count;
    return startX + direction * run * Math.pow(progress, routeLaneCurve);
  });
}

function formatRouteNode(node, delay = 0) {
  return {
    id: node.id,
    side: node.side,
    active: node.active,
    final: Boolean(node.final),
    delay,
    cx: formatRoutePoint(node.x),
    cy: formatRoutePoint(node.y),
  };
}

function hasSelectedTeam(node, selectedDetail) {
  return Boolean(selectedDetail?.teamId && node.teamIds.has(selectedDetail.teamId));
}

function isSelectedCard(card, selectedDetail) {
  return Boolean(
    selectedDetail?.teamId
      && selectedDetail?.matchId
      && card.teamId === selectedDetail.teamId
      && card.matchId === selectedDetail.matchId,
  );
}

function getPairActiveDepth(pair, selectedDetail) {
  if (!selectedDetail?.teamId || pair.id !== selectedDetail.matchId) return -1;
  const hasTeam = pair.cards.some((card) => card.teamId === selectedDetail.teamId);
  if (!hasTeam) return -1;
  return pair.advancingTeamId === selectedDetail.teamId ? 1 : 0;
}

function pushRouteNode(renderNodes, node, delay = 0) {
  if (renderNodes.some((renderNode) => renderNode.id === node.id)) return;
  renderNodes.push(formatRouteNode(node, delay));
}

function collectSidePairs(stage, side, stageRect) {
  const sideElement = stage.querySelector(`.arena-side.is-${side}`);
  if (!sideElement) return [];

  return Array.from(sideElement.querySelectorAll(".arena-pair"))
    .map((pair, pairIndex) => {
      const cards = Array.from(pair.querySelectorAll("[data-route-card='team']"))
        .map((card, cardIndex) => {
          const rect = card.getBoundingClientRect();
          return {
            id: card.dataset.routeId || `${side}-${pairIndex}-${cardIndex}`,
            matchId: card.dataset.routeMatchId || pair.dataset.routeMatchId || `${side}-${pairIndex}`,
            teamId: card.dataset.routeTeamId || "",
            x: side === "left" ? rect.right - stageRect.left : rect.left - stageRect.left,
            y: rect.top - stageRect.top + rect.height / 2,
          };
        });

      if (cards.length === 0) return null;

      return {
        id: pair.dataset.routeMatchId || cards[0]?.matchId || `${side}-${pairIndex}`,
        index: pairIndex,
        advancingTeamId: pair.dataset.routeAdvancingTeamId || "",
        cards,
      };
    })
    .filter(Boolean);
}

function unionSets(nodes, key) {
  return new Set(nodes.flatMap((node) => Array.from(node[key])));
}

function measureSideBracketRoutes({ side, pairs, stageRect, trophyRect, trophyCenterRect, selectedDetail }) {
  if (pairs.length === 0 || !trophyRect.width || !trophyRect.height) {
    return { paths: [], nodes: [] };
  }

  const direction = side === "left" ? 1 : -1;
  const allCards = pairs.flatMap((pair) => pair.cards);
  const startBoundary = side === "left"
    ? Math.max(...allCards.map((card) => card.x))
    : Math.min(...allCards.map((card) => card.x));
  const trophyLeft = trophyRect.left - stageRect.left;
  const trophyVisibleLeft = trophyLeft + trophyRect.width * trophyVisibleBounds.left;
  const trophyVisibleRight = trophyLeft + trophyRect.width * (1 - trophyVisibleBounds.right);
  const trophyCenterTop = (trophyCenterRect ?? trophyRect).top - stageRect.top;
  const trophyPointY = trophyCenterTop + (trophyCenterRect ?? trophyRect).height / 2;
  const trophyEntryGap = Math.max(
    trophyRouteSocket.minGap,
    Math.min(trophyRouteSocket.maxGap, trophyRect.width * trophyRouteSocket.widthRatio),
  );
  const trophySocketX = side === "left"
    ? trophyVisibleLeft
    : trophyVisibleRight;
  const finalNodeX = side === "left"
    ? trophyVisibleLeft - trophyEntryGap
    : trophyVisibleRight + trophyEntryGap;
  const finalEntryPoint = {
    id: `${side}-trophy-entry-node`,
    side,
    x: finalNodeX,
    y: trophyPointY,
    teamIds: new Set(),
    matchIds: new Set(),
    final: true,
  };
  const nodeColumnCount = Math.max(1, Math.ceil(Math.log2(Math.max(2, pairs.length))) + 1);
  const routeColumnXs = createRouteColumnXs({
    startX: startBoundary,
    endX: finalNodeX,
    direction,
    count: nodeColumnCount,
  });
  const pairNodeX = pairs.length <= 1 ? finalNodeX : routeColumnXs[0];
  const paths = [];
  const renderNodes = [];

  let frontier = pairs.map((pair) => {
    const pairDelay = Math.round(pair.index * 42);
    const activeDepth = getPairActiveDepth(pair, selectedDetail);
    const node = {
      id: `${side}-${pair.id}-match-node`,
      side,
      x: pairNodeX,
      y: pair.cards.reduce((total, card) => total + card.y, 0) / pair.cards.length,
      teamIds: new Set(pair.cards.map((card) => card.teamId).filter(Boolean)),
      matchIds: new Set([pair.id]),
      final: pairs.length <= 1,
      activeDepth,
    };
    node.active = activeDepth >= 0;

    pair.cards.forEach((card, cardIndex) => {
      const active = isSelectedCard(card, selectedDetail);
      paths.push(createRoutePath({
        id: `${side}-${pair.id}-${card.teamId}-leaf`,
        side,
        start: card,
        end: node,
        active,
        delay: pairDelay + cardIndex * 24,
      }));
    });
    if (node.final || node.active) {
      pushRouteNode(renderNodes, node, pairDelay + 210);
    }
    return node;
  });

  let level = 1;
  while (frontier.length > 1) {
    const nextFrontier = [];
    for (let index = 0; index < frontier.length; index += 2) {
      const children = frontier.slice(index, index + 2);
      if (children.length === 1) {
        nextFrontier.push(children[0]);
        continue;
      }

      const isFinalMerge = children.length === frontier.length && frontier.length <= 2;
      const parent = {
        id: isFinalMerge ? finalEntryPoint.id : `${side}-round-${level}-node-${index / 2}`,
        side,
        x: isFinalMerge ? finalEntryPoint.x : routeColumnXs[Math.min(level, routeColumnXs.length - 1)],
        y: isFinalMerge ? finalEntryPoint.y : children.reduce((total, child) => total + child.y, 0) / children.length,
        teamIds: unionSets(children, "teamIds"),
        matchIds: unionSets(children, "matchIds"),
        final: isFinalMerge,
      };
      const activeChildDepth = Math.max(...children.map((child) => child.activeDepth ?? -1));
      parent.activeDepth = activeChildDepth > 0 ? activeChildDepth - 1 : -1;
      parent.active = activeChildDepth > 0;

      children.forEach((child, childIndex) => {
        paths.push(createRoutePath({
          id: `${side}-round-${level}-${index / 2}-${childIndex}`,
          side,
          start: child,
          end: parent,
          trophy: false,
          active: (child.activeDepth ?? -1) > 0,
          delay: 190 + level * 170 + (index / 2) * 46 + childIndex * 26,
        }));
      });
      if (parent.final || parent.active) {
        pushRouteNode(renderNodes, parent, 360 + level * 170 + (index / 2) * 46);
      }
      nextFrontier.push(parent);
    }

    frontier = nextFrontier;
    level += 1;
  }

  const championNode = frontier[0];
  if (championNode?.final) {
    paths.push(createTrophySocketPath({
      id: `${side}-champion-to-trophy-socket`,
      side,
      start: championNode,
      endX: trophySocketX,
      active: (championNode.activeDepth ?? -1) > 0,
      delay: 420 + level * 190,
    }));
    pushRouteNode(renderNodes, championNode, 460 + level * 190);
  }

  return { paths, nodes: renderNodes };
}

function measureBracketRoutes(stage, selectedDetail, roundId) {
  const stageRect = stage.getBoundingClientRect();
  const trophy = stage.querySelector("[data-route-target='trophy']");
  const trophyCenter = stage.querySelector(".arena-center");

  if (!stageRect.width || !stageRect.height || !trophy) {
    return {
      roundId,
      width: Math.round(stageRect.width),
      height: Math.round(stageRect.height),
      paths: [],
      nodes: [],
    };
  }

  const trophyRect = trophy.getBoundingClientRect();
  const trophyCenterRect = trophyCenter?.getBoundingClientRect();
  const leftRoutes = measureSideBracketRoutes({
    side: "left",
    pairs: collectSidePairs(stage, "left", stageRect),
    stageRect,
    trophyRect,
    trophyCenterRect,
    selectedDetail,
  });
  const rightRoutes = measureSideBracketRoutes({
    side: "right",
    pairs: collectSidePairs(stage, "right", stageRect),
    stageRect,
    trophyRect,
    trophyCenterRect,
    selectedDetail,
  });

  return {
    roundId,
    width: Math.round(stageRect.width),
    height: Math.round(stageRect.height),
    paths: [...leftRoutes.paths, ...rightRoutes.paths],
    nodes: [...leftRoutes.nodes, ...rightRoutes.nodes],
  };
}

function ArenaTeamCard({ match, team, side, allocation, selected, onPickTeam, copy }) {
  const { compactVotes, teamName, t } = copy;
  if (!match || !team) return null;

  const tone = getTeamTone(match, team, allocation);
  const liveQualification = team.liveQualification;
  const isWinner = match.advancingTeamId === team.id;
  const isEliminated = Boolean(match.advancingTeamId && match.advancingTeamId !== team.id);
  const label = getTeamLabel({ match, team, allocation, copy });
  const Icon = tone === "allocated" || tone === "winner" || tone === "confirmed"
    ? CheckCircle2
    : tone === "provisional"
      ? Clock3
      : voteableStatuses.has(match.status)
        ? Plus
        : LockKeyhole;
  const teamMetric = liveQualification ? "" : compactVotes(team.votes);
  const borderGlowHandlers = useBorderGlow({ edgeSensitivity: 30 });

  return (
    <Magnet
      as="button"
      type="button"
      strength={54}
      className={[
        "arena-team-card",
        "border-glow",
        `is-${side}`,
        `is-${tone}`,
        liveQualification ? "is-realtime-team" : "",
        isWinner ? "is-winner" : "",
        isEliminated ? "is-eliminated" : "",
        selected ? "is-selected" : "",
      ].filter(Boolean).join(" ")}
      data-route-card="team"
      data-route-id={`${match.id}-${team.id}`}
      data-route-match-id={match.id}
      data-route-side={side}
      data-route-team-id={team.id}
      style={{ viewTransitionName: `arena-team-${team.id}` }}
      onClick={() => onPickTeam(match, team)}
      onPointerMove={borderGlowHandlers.onPointerMove}
      onPointerLeave={borderGlowHandlers.onPointerLeave}
      aria-label={`${teamName(team)} ${label}`}
    >
      <span className="edge-light" aria-hidden="true" />
      <img src={team.flagSrc} alt="" aria-hidden="true" />
      <span className="arena-team-card__copy">
        <strong>{teamName(team)}</strong>
        <small>{label}</small>
      </span>
      <em>{teamMetric}</em>
      <span className="arena-team-card__state" aria-hidden="true">
        <Icon size={17} strokeWidth={2.35} />
      </span>
    </Magnet>
  );
}

function ArenaSide({ side, matches, teamsById, allocations, detail, onPickTeam, copy }) {
  const { locale } = copy;

  return (
    <section className={`arena-side is-${side}`} aria-label={copy.t(side === "left" ? "schedule.leftBracket" : "schedule.rightBracket")}>
      {matches.map((match, index) => {
        const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
        const pairAccent = pairAccentColors[index % pairAccentColors.length];
        const gmtDateTime = matchGmtDateTime(match, locale);
        return (
          <article
            className={[
              "arena-pair",
              match.advancingTeamId ? "has-winner" : "",
              voteableStatuses.has(match.status) ? "is-voteable" : "",
            ].filter(Boolean).join(" ")}
            key={match.id}
            data-route-match-id={match.id}
            data-route-advancing-team-id={match.advancingTeamId || ""}
            style={{ "--pair-index": index, "--pair-rgb": pairAccent }}
          >
            <span className="arena-pair__meta" aria-label={gmtDateTime ? `${matchDisplayCode(match)} ${gmtDateTime}` : matchDisplayCode(match)}>
              <span className="arena-pair__match">{matchDisplayCode(match)}</span>
              {gmtDateTime ? (
                <time className="arena-pair__time" dateTime={match.kickoffAt}>
                  {gmtDateTime}
                </time>
              ) : null}
            </span>
            {teams.map((team) => (
              <ArenaTeamCard
                key={team.id}
                match={match}
                team={team}
                side={side}
                allocation={getTeamAllocation(match, team, allocations)}
                selected={detail?.matchId === match.id && detail?.teamId === team.id}
                onPickTeam={onPickTeam}
                copy={copy}
              />
            ))}
            <span className="arena-pair__connector" aria-hidden="true" />
            <span className="arena-pair__route" aria-hidden="true" />
          </article>
        );
      })}
    </section>
  );
}

function ArenaCenter({ copy }) {
  const { t } = copy;

  return (
    <figure className="arena-center" aria-label={t("schedule.bracketCenterAria")}>
      <span className="arena-center__route is-left" aria-hidden="true" />
      <span className="arena-center__route is-right" aria-hidden="true" />
      <img src={trophyImage} alt="" aria-hidden="true" data-route-target="trophy" />
    </figure>
  );
}

function BracketRouteLayer({ routeLayer }) {
  const { width, height, paths = [], nodes = [] } = routeLayer;
  let activeFlowOrder = 0;
  const renderedPaths = paths.map((route) => {
    if (!route.active) return { ...route, flowOrder: -1 };
    const flowOrder = activeFlowOrder;
    activeFlowOrder += 1;
    return { ...route, flowOrder };
  });

  return (
    <svg
      className="arena-route-layer"
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="arena-metal-flow-left" x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="#c7b6ff" />
          <stop offset="25%" stopColor="#e79ac2" />
          <stop offset="50%" stopColor="#a9d6ee" />
          <stop offset="75%" stopColor="#d8bd76" />
          <stop offset="100%" stopColor="#f4efe3" />
          <animate attributeName="x1" values="-120%;0%;-120%" dur="2.1s" repeatCount="indefinite" />
          <animate attributeName="x2" values="0%;120%;0%" dur="2.1s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id="arena-metal-flow-right" x1="100%" x2="0%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="#f4efe3" />
          <stop offset="25%" stopColor="#d8bd76" />
          <stop offset="50%" stopColor="#a9d6ee" />
          <stop offset="75%" stopColor="#e79ac2" />
          <stop offset="100%" stopColor="#c7b6ff" />
          <animate attributeName="x1" values="120%;0%;120%" dur="2.1s" repeatCount="indefinite" />
          <animate attributeName="x2" values="0%;-120%;0%" dur="2.1s" repeatCount="indefinite" />
        </linearGradient>
        <filter id="arena-route-metal-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="1.75" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {renderedPaths.map((route, index) => (
        <path
          className={[
            "arena-route-layer__path",
            `is-${route.side}`,
            route.trophy ? "is-trophy" : "",
            route.active ? "is-active" : "is-muted",
          ].filter(Boolean).join(" ")}
          d={route.d}
          key={route.id}
          pathLength="1"
          style={{ "--route-delay": `${route.delay ?? index * 24}ms` }}
        />
      ))}
      {renderedPaths.map((route) => route.active ? (
        <path
          className={[
            "arena-route-layer__path-flow",
            `is-${route.side}`,
            route.trophy ? "is-trophy" : "",
          ].filter(Boolean).join(" ")}
          d={route.d}
          key={`${route.id}-flow`}
          pathLength="1"
          style={{ "--flow-delay": `${route.flowOrder * 135}ms` }}
        />
      ) : null)}
      {nodes.map((node) => (
        <circle
          className={[
            "arena-route-layer__node",
            `is-${node.side}`,
            node.final ? "is-final" : "",
            node.active ? "is-active" : "is-muted",
          ].filter(Boolean).join(" ")}
          cx={node.cx}
          cy={node.cy}
          key={node.id}
          r="3.2"
          style={{ "--node-delay": `${node.delay ?? 0}ms` }}
        />
      ))}
    </svg>
  );
}

function ArenaDetailPanel({
  mode,
  detailMatch,
  detailTeam,
  opponentTeam,
  allocation,
  remainingRoundTickets,
  ticketAmount,
  teamsById,
  onClose,
  onSubmitVote,
  onOpenVote,
  copy,
}) {
  const { compactVotes, matchStatus, t, teamName } = copy;
  if (!detailMatch || !detailTeam || !opponentTeam) return null;

  const leftTeam = teamsById.get(detailMatch.teams?.[0]) ?? detailTeam;
  const rightTeam = teamsById.get(detailMatch.teams?.[1]) ?? opponentTeam;
  if (!leftTeam || !rightTeam) return null;

  const leftVotes = leftTeam.votes ?? 0;
  const rightVotes = rightTeam.votes ?? 0;
  const displayPool = displayPoolForMatch(detailMatch, teamsById);
  const totalVotes = leftVotes + rightVotes;
  const leftShare = totalVotes > 0 ? Math.round((leftVotes / totalVotes) * 100) : 0;
  const rightShare = totalVotes > 0 ? 100 - leftShare : 0;
  const isRealtimePreview = Boolean(detailMatch.realtimePreview || leftTeam.liveQualification || rightTeam.liveQualification);
  const hasVoteShare = totalVotes > 0;
  const sharePosition = hasVoteShare ? leftShare : 50;
  const matchVoterCount = Math.max(0, Math.floor(Number(detailMatch.voterCount) || 0));
  const displayedVoters = matchVoterCount || (isRealtimePreview ? 0 : Math.max(4, Math.round(displayPool / 45)));
  const displayedTotalVotes = Math.max(displayPool, allocation?.tickets ?? 0, totalVotes);
  const detailTitle = t("schedule.teamVoteDetails");
  const detailStatus = detailMatch.awaitingOfficialResult
    ? t("vote.phasePendingResult")
    : matchStatus(detailMatch.status);
  const detailDescription = t("schedule.panelState", {
    round: detailStatus,
    match: matchDisplayCode(detailMatch),
  });
  const detailAria = t("schedule.voteShare");
  const canSubmit = mode === "vote" && voteableStatuses.has(detailMatch.status) && remainingRoundTickets > 0;
  const canOpenVote = mode === "schedule" && voteableStatuses.has(detailMatch.status) && Boolean(onOpenVote);
  const resolvedTicketAmount = Math.max(1, Math.min(ticketAmount ?? 1, Math.max(1, remainingRoundTickets ?? 1)));
  const buttonDisabled = mode === "vote" ? !canSubmit : !canOpenVote;
  const buttonLabel = mode === "vote"
    ? t("schedule.sendPreviewVote")
    : canOpenVote
      ? t("schedule.openVoteStage")
      : t("schedule.inspectOnly");

  return (
    <aside className={`arena-detail-panel is-${mode}`} aria-label={detailTitle}>
      <button className="arena-detail-panel__close" type="button" onClick={onClose} aria-label={t("common.close")}>
        <X size={17} strokeWidth={2.3} />
      </button>
      <header>
        <span>{detailTitle}</span>
        <strong>{matchDisplayCode(detailMatch)} · {detailStatus}</strong>
      </header>
      <p>{detailDescription}</p>
      <dl>
        <div>
          <dt>{t("schedule.totalVotes")}</dt>
          <dd>{formatNumber(displayedTotalVotes)}</dd>
        </div>
        <div>
          <dt>{t("schedule.independentVoters")}</dt>
          <dd>{formatNumber(displayedVoters)}</dd>
        </div>
      </dl>
      <section
        className={[
          "arena-vs-breakdown",
          hasVoteShare ? "has-vote-share" : "is-empty-share",
        ].filter(Boolean).join(" ")}
        aria-label={detailAria}
        style={{ "--focused-share": `${sharePosition}%`, "--opponent-share": `${rightShare}%` }}
      >
        <article className="is-focused">
          <img src={leftTeam.flagSrc} alt="" aria-hidden="true" />
          <span>{teamName(leftTeam)}</span>
          <strong>{hasVoteShare ? compactVotes(leftVotes) : ""}</strong>
          <small>{hasVoteShare ? `${leftShare}%` : ""}</small>
        </article>
        <div className="arena-vs-share" aria-hidden="true">
          <span className="arena-vs-share__label">{t("vote.versusShort")}</span>
          <span className="arena-vs-share__track">
            <i />
          </span>
        </div>
        <article>
          <img src={rightTeam.flagSrc} alt="" aria-hidden="true" />
          <span>{teamName(rightTeam)}</span>
          <strong>{hasVoteShare ? compactVotes(rightVotes) : ""}</strong>
          <small>{hasVoteShare ? `${rightShare}%` : ""}</small>
        </article>
      </section>
      <section className="arena-detail-actions">
        <Magnet
          as="button"
          type="button"
          strength={36}
          disabled={buttonDisabled}
          onClick={() => (mode === "vote" ? onSubmitVote(resolvedTicketAmount) : onOpenVote?.(detailMatch.id, detailTeam.id))}
        >
          {buttonDisabled ? <LockKeyhole size={16} strokeWidth={2.25} /> : <Send size={16} strokeWidth={2.25} />}
          {buttonLabel}
        </Magnet>
      </section>
    </aside>
  );
}

export function TournamentArena({
  mode = "schedule",
  activeRound,
  activeRoundId,
  matches,
  teamsById,
  selectedMatch,
  selectedTeamId,
  ticketAmount,
  remainingRoundTickets = 0,
  roundAllocations = [],
  onSelectMatch,
  onSelectTeam,
  onConfirmPreviewVote,
  onOpenVote,
}) {
  const copy = useCampaignCopy();
  const { dateTime, roundLabel, teamName, t, venueName } = copy;
  const stageRef = useRef(null);
  const [routeLayer, setRouteLayer] = useState({ roundId: "", width: 0, height: 0, paths: [], nodes: [] });
  const roundMatches = useMemo(
    () => matches
      .filter((match) => match.roundId === activeRoundId)
      .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime()),
    [activeRoundId, matches],
  );
  const selectedRoundMatch = roundMatches.some((match) => match.id === selectedMatch?.id)
    ? selectedMatch
    : roundMatches.find((match) => voteableStatuses.has(match.status)) ?? roundMatches[0];
  const fallbackTeamId = selectedTeamId ?? selectedRoundMatch?.teams?.[0] ?? "";
  const externalRouteSelection = useMemo(() => {
    if (!selectedTeamId) return null;
    const selectedTeamMatch = roundMatches.find((match) => match.teams.includes(selectedTeamId));
    if (!selectedTeamMatch) return null;
    return { matchId: selectedTeamMatch.id, teamId: selectedTeamId };
  }, [roundMatches, selectedTeamId]);
  const [detail, setDetail] = useState(null);
  const [routeSelection, setRouteSelection] = useState(externalRouteSelection);
  const visibleDetail = detail ?? routeSelection ?? { matchId: selectedRoundMatch?.id ?? "", teamId: fallbackTeamId };
  const activeDetailMatch = roundMatches.find((match) => match.id === visibleDetail.matchId) ?? selectedRoundMatch;
  const activeDetailTeam = teamsById.get(visibleDetail.teamId) ?? teamsById.get(activeDetailMatch?.teams?.[0]);
  const opponentTeam = teamsById.get(activeDetailMatch?.teams?.find((teamId) => teamId !== activeDetailTeam?.id));
  const activeAllocation = getTeamAllocation(activeDetailMatch, activeDetailTeam, roundAllocations);
  const splitIndex = Math.ceil(roundMatches.length / 2);
  const leftMatches = roundMatches.slice(0, splitIndex);
  const rightMatches = roundMatches.slice(splitIndex);
  const nextCutoff = roundMatches.find((match) => voteableStatuses.has(match.status)) ?? roundMatches[0];

  useEffect(() => {
    setDetail(null);
    setRouteSelection(externalRouteSelection);
  }, [activeRoundId, externalRouteSelection?.matchId, externalRouteSelection?.teamId]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    let frame = 0;
    let trophy = null;
    const timers = [];

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextLayer = measureBracketRoutes(stage, routeSelection, activeRoundId);
        setRouteLayer((current) => (routeLayerEquals(current, nextLayer) ? current : nextLayer));
      });
    };

    const measureAfterPaint = () => {
      measure();
      requestAnimationFrame(measure);
    };
    const scheduleMeasure = (delay) => {
      const timer = window.setTimeout(measureAfterPaint, delay);
      timers.push(timer);
    };

    const resizeObserver = new ResizeObserver(measureAfterPaint);
    resizeObserver.observe(stage);
    stage.querySelectorAll(".arena-pair, .arena-team-card, .arena-center img").forEach((element) => {
      resizeObserver.observe(element);
    });

    trophy = stage.querySelector("[data-route-target='trophy']");
    if (trophy && !trophy.complete) {
      trophy.addEventListener("load", measureAfterPaint, { once: true });
    }
    trophy?.decode?.().then(measureAfterPaint).catch(() => {});
    document.fonts?.ready?.then(measureAfterPaint).catch(() => {});

    window.addEventListener("resize", measureAfterPaint);
    measureAfterPaint();
    [80, 220, 520].forEach(scheduleMeasure);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureAfterPaint);
      trophy?.removeEventListener("load", measureAfterPaint);
    };
  }, [activeRoundId, mode, roundAllocations, roundMatches, routeSelection]);

  function handlePickTeam(match, team) {
    const nextSelection = { matchId: match.id, teamId: team.id };
    setRouteSelection(nextSelection);
    setDetail(nextSelection);
    onSelectMatch?.(match.id);
    if (mode === "vote" && voteableStatuses.has(match.status)) {
      onSelectTeam?.(team.id);
    }
  }

  function handleSubmitVote(amount) {
    if (mode !== "vote") return;
    const target = {
      matchId: activeDetailMatch?.id || "",
      teamId: activeDetailTeam?.id || "",
    };
    if (target.matchId) onSelectMatch?.(target.matchId);
    if (target.teamId) onSelectTeam?.(target.teamId);
    onConfirmPreviewVote?.(amount, target);
  }

  return (
    <section className={`tournament-arena is-${mode}${detail ? " has-detail" : ""}`} aria-label={t("schedule.bracketAria", { round: roundLabel(activeRound) })}>
      {mode === "schedule" ? (
        <div className="arena-light-rays-backdrop" aria-hidden="true">
          <LightRays />
        </div>
      ) : null}
      <header className="tournament-arena__mast">
        <span>{roundLabel(activeRound, "englishLabel")}</span>
        <strong>{mode === "vote" ? t("vote.currentRoundVoteTitle") : t("schedule.roundBracketTitle")}</strong>
        <p>
          <CircleDollarSign size={15} strokeWidth={2.25} />
          {nextCutoff
            ? t("schedule.nextCutoff", { match: matchDisplayCode(nextCutoff), time: dateTime(nextCutoff.cutoffAt) })
            : t("schedule.noOpenMatches")}
        </p>
      </header>
      <section className="tournament-arena__scroll">
        <section className="tournament-arena__stage" key={activeRoundId} ref={stageRef}>
          <BracketRouteLayer
            routeLayer={routeLayer.roundId === activeRoundId ? routeLayer : { width: 0, height: 0, paths: [], nodes: [] }}
          />
          <ArenaSide
            side="left"
            matches={leftMatches}
            teamsById={teamsById}
            allocations={roundAllocations}
            detail={routeSelection}
            onPickTeam={handlePickTeam}
            copy={copy}
          />
          <ArenaCenter
            copy={copy}
          />
          <ArenaSide
            side="right"
            matches={rightMatches}
            teamsById={teamsById}
            allocations={roundAllocations}
            detail={routeSelection}
            onPickTeam={handlePickTeam}
            copy={copy}
          />
        </section>
      </section>
      {mode === "vote" ? (
        <footer className="tournament-arena__footer">
          <span>{activeDetailMatch ? matchDisplayCode(activeDetailMatch) : ""} · {activeDetailMatch ? venueName(activeDetailMatch.venue) : ""}</span>
          <strong>
            {activeDetailMatch?.teams?.map((teamId) => teamName(teamsById.get(teamId))).join(` ${t("vote.versusShort")} `)}
          </strong>
          <em>{t("schedule.tapTeamHint")}</em>
        </footer>
      ) : null}
      {detail ? (
      <ArenaDetailPanel
        mode={mode}
        detailMatch={activeDetailMatch}
        detailTeam={activeDetailTeam}
        opponentTeam={opponentTeam}
        allocation={activeAllocation}
        remainingRoundTickets={remainingRoundTickets}
        ticketAmount={ticketAmount}
        teamsById={teamsById}
        onClose={() => {
          setDetail(null);
          setRouteSelection(null);
        }}
        onSubmitVote={handleSubmitVote}
        onOpenVote={onOpenVote}
        copy={copy}
      />
      ) : null}
    </section>
  );
}
