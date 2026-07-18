import {
  Clock3,
  LockKeyhole,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { isUnrevealedPrizePreviewMatch } from "../../data/matchReveal";
import { getMatchPrizeImage } from "../../data/matchPrizeImages";
import { sameMatchId } from "../../data/matchIds.js";
import { getMatchTeamVotes } from "../../data/matchVotes.js";
import { estimateMultiPrizeChance, formatNumber } from "../../data/ticketMath";
import { MatchPrizeImageDialog } from "./MatchPrizeImageDialog";

const voteableStatuses = new Set(["open", "closing_soon"]);

function isMatchVoteable(match) {
  return !isUnrevealedPrizePreviewMatch(match) && voteableStatuses.has(match?.status);
}

function getMatchPhase(match) {
  if (isUnrevealedPrizePreviewMatch(match)) {
    return {
      id: "scheduled",
      icon: Clock3,
      labelKey: "vote.phaseUnrevealed",
    };
  }

  if (match.awaitingOfficialResult) {
    return {
      id: "locked",
      icon: Clock3,
      labelKey: "vote.phasePendingResult",
    };
  }

  if (match.status === "official_final") {
    return {
      id: "final",
      icon: ShieldCheck,
      labelKey: "vote.phaseFinal",
    };
  }

  if (isMatchVoteable(match)) {
    return {
      id: "voteable",
      icon: Ticket,
      labelKey: "vote.phaseVoteable",
    };
  }

  if (match.status === "locked") {
    return {
      id: "locked",
      icon: LockKeyhole,
      labelKey: "vote.phaseLocked",
    };
  }

  if (match.status === "in_play") {
    return {
      id: "live",
      icon: Clock3,
      labelKey: "vote.phaseInPlay",
    };
  }

  return {
    id: "scheduled",
    icon: Clock3,
    labelKey: "vote.phaseScheduled",
  };
}

function getTeamVoteOutcome(roundVoteOutcomes, matchId, teamId) {
  return roundVoteOutcomes.find((outcome) => (
    sameMatchId(outcome.matchId, matchId)
    && outcome.teamId === teamId
  )) ?? null;
}

function getTeamAllocation(roundAllocations, matchId, teamId) {
  return roundAllocations.find((entry) => (
    sameMatchId(entry.matchId, matchId)
    && entry.teamId === teamId
  )) ?? null;
}

function matchDisplayCode(match) {
  return String(match?.displayCode || match?.id || "").toUpperCase();
}

function formatHitRate(value) {
  const percent = Math.max(0, Number(value) || 0) * 100;
  if (percent > 0 && percent < 0.0001) return "<0.0001%";
  if (percent < 0.01) return `${percent.toFixed(4)}%`;
  return `${percent.toFixed(2)}%`;
}

function getScrollInsetTop(element) {
  const value = window.getComputedStyle(element).scrollPaddingTop;
  const inset = Number.parseFloat(value);
  return Number.isFinite(inset) ? inset : 0;
}

export function MatchPrizeList({
  activeRound,
  matches,
  teamsById,
  selectedMatchId,
  selectedTeamId,
  roundAllocations,
  roundVoteOutcomes = [],
  votePoolReady = true,
  onSelectMatch,
  onSelectTeam,
  copy,
}) {
  const { compactVotes, matchStatusCompact, roundLabel, t, teamName } = copy;
  const selectedLaneRef = useRef(null);

  useEffect(() => {
    const selectedLane = selectedLaneRef.current;
    const scrollContainer = selectedLane?.closest(".match-prize-list-view__matches");
    if (!selectedLane || !scrollContainer) return undefined;

    const animationFrameId = window.requestAnimationFrame(() => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const laneRect = selectedLane.getBoundingClientRect();
      const scrollInsetTop = getScrollInsetTop(scrollContainer);
      scrollContainer.scrollTo({
        top: Math.max(0, scrollContainer.scrollTop + laneRect.top - containerRect.top - scrollInsetTop),
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [selectedMatchId]);

  return (
    <section className="match-prize-list-view" aria-label={t("vote.matchPrizeListAria", { round: roundLabel(activeRound) })}>
      <header className="match-prize-list-view__head">
        <span>{t("vote.matchPrizeListTitle", { round: roundLabel(activeRound, "advanceLabel") })}</span>
        <p>{t("vote.matchPrizeListBody")}</p>
      </header>

      <ol className="match-prize-list-view__matches">
        {matches.map((match, matchIndex) => {
          const teamsHidden = isUnrevealedPrizePreviewMatch(match);
          const teams = teamsHidden ? [] : match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
          const matchAllocations = roundAllocations.filter((entry) => sameMatchId(entry.matchId, match.id));
          const canPickMatch = isMatchVoteable(match);
          const selected = sameMatchId(selectedMatchId, match.id);
          const phase = getMatchPhase(match);
          const statusText = t(phase.labelKey);
          const statusTextCompact = phase.id === "voteable"
            ? matchStatusCompact(match.status)
            : statusText;
          const MatchIcon = phase.icon;
          const prizeImage = getMatchPrizeImage(match, matchIndex);

          return (
            <li
              ref={selected ? selectedLaneRef : null}
              className={[
                "match-prize-lane",
                selected ? "is-selected" : "",
                matchAllocations.length > 0 ? "has-vote-record" : "",
                `is-phase-${phase.id}`,
                canPickMatch ? "is-open" : "is-closed",
                `is-${match.status}`,
              ].filter(Boolean).join(" ")}
              key={match.id}
              data-match-id={match.id}
              style={{ "--match-lane-index": matchIndex }}
            >
              <header className="match-prize-lane__head">
                <span className="match-prize-lane__meta">
                  <span className="match-prize-lane__code">{matchDisplayCode(match)}</span>
                  <small className="match-prize-lane__status">
                    <MatchIcon size={13} strokeWidth={2.35} />
                    <span data-short={statusTextCompact}>{statusText}</span>
                  </small>
                </span>
                <MatchPrizeImageDialog
                  copy={copy}
                  matchId={match.id}
                  matchLabel={matchDisplayCode(match)}
                  prizeImage={prizeImage}
                />
              </header>

              <section className="match-prize-lane__teams" aria-label={t("schedule.teamsAria", { match: matchDisplayCode(match) })}>
                {teamsHidden ? [0, 1].map((slotIndex) => (
                  <Fragment key={`${match.id}-unrevealed-${slotIndex}`}>
                    <button
                      className={[
                        "match-prize-team",
                        "is-unrevealed",
                        slotIndex === 0 ? "is-left-team" : "is-right-team",
                      ].join(" ")}
                      type="button"
                      onClick={() => onSelectMatch(match.id)}
                      aria-pressed={false}
                      aria-label={`${matchDisplayCode(match)} ${t("vote.unrevealedTeam")}`}
                    >
                      <span className="match-prize-team__unknown-flag" aria-hidden="true">?</span>
                      <span className="match-prize-team__copy">
                        <span className="match-prize-team__title-row">
                          <strong>{t("vote.unrevealedTeam")}</strong>
                        </span>
                        <small>{t("vote.unrevealedTeamHint")}</small>
                      </span>
                    </button>
                    {slotIndex === 0 ? (
                      <span className="match-prize-versus" aria-hidden="true" key={`${match.id}-versus`}>
                        {t("vote.versusShort")}
                      </span>
                    ) : null}
                  </Fragment>
                )) : teams.map((team, teamIndex) => {
                  const allocation = getTeamAllocation(roundAllocations, match.id, team.id);
                  const canPickTeam = canPickMatch;
                  const isSelectedTeam = selected && selectedTeamId === team.id;
                  const isAllocatedTeam = Boolean(allocation);
                  const isWinner = match.advancingTeamId === team.id;
                  const isEliminated = Boolean(match.advancingTeamId && match.advancingTeamId !== team.id);
                  const voteOutcome = getTeamVoteOutcome(roundVoteOutcomes, match.id, team.id);
                  const matchTeamVotes = votePoolReady ? getMatchTeamVotes(match, team) : null;
                  const hasValidVotePool = votePoolReady
                    && Number.isFinite(matchTeamVotes)
                    && (!voteOutcome || matchTeamVotes >= voteOutcome.tickets);
                  const hitRate = voteOutcome
                    ? hasValidVotePool ? formatHitRate(estimateMultiPrizeChance(
                      voteOutcome.tickets,
                      matchTeamVotes,
                      activeRound?.matchPrizeSlotCount || 1,
                    )) : "—"
                    : "";

                  return (
                    <Fragment key={team.id}>
                      <button
                        className={[
                          "match-prize-team",
                          teamIndex === 0 ? "is-left-team" : "is-right-team",
                          isSelectedTeam ? "is-current" : "",
                          isAllocatedTeam ? "is-allocated" : "",
                          voteOutcome ? "has-vote-outcome" : "",
                          voteOutcome ? `is-outcome-${voteOutcome.result}` : "",
                          isWinner ? "is-winner" : "",
                          isEliminated ? "is-eliminated" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        onClick={() => {
                          onSelectMatch(match.id);
                          if (canPickTeam) onSelectTeam(team.id);
                        }}
                        aria-pressed={isSelectedTeam}
                      >
                        <img src={team.flagSrc} alt="" aria-hidden="true" />
                        <span className="match-prize-team__copy">
                          <span className="match-prize-team__title-row">
                            <strong>{teamName(team)}</strong>
                            {isWinner ? (
                              <b className="match-prize-team__winner-label">
                                {t("common.advancing")}
                              </b>
                            ) : null}
                          </span>
                          {voteOutcome ? (
                            <b className={[
                              "match-prize-team__vote-result",
                              `is-${voteOutcome.result}`,
                            ].join(" ")}
                            >
                              <span>
                                <small>{t("vote.voteOutcomeTicketsLabel")}</small>
                                <strong>{formatNumber(voteOutcome.tickets)}</strong>
                              </span>
                              <span>
                                <small>{t("vote.voteOutcomeHitRateLabel")}</small>
                                <strong>{hitRate}</strong>
                              </span>
                            </b>
                          ) : null}
                          <small>{hasValidVotePool ? compactVotes(matchTeamVotes) : "—"}</small>
                        </span>
                      </button>
                      {teamIndex === 0 ? (
                        <span className="match-prize-versus" aria-hidden="true" key={`${match.id}-versus`}>
                          {t("vote.versusShort")}
                        </span>
                      ) : null}
                    </Fragment>
                  );
                })}
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
