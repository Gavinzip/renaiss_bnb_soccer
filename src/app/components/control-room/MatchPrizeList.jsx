import {
  Clock3,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { estimateMultiPrizeChance, formatNumber } from "../../data/ticketMath";
import { MatchPrizeImageDialog } from "./MatchPrizeImageDialog";

const voteableStatuses = new Set(["open", "closing_soon"]);

function getMatchPhase(match) {
  if (match.status === "official_final") {
    return {
      id: "final",
      icon: ShieldCheck,
      labelKey: "vote.phaseFinal",
    };
  }

  if (voteableStatuses.has(match.status)) {
    return {
      id: "voteable",
      icon: Ticket,
      labelKey: "vote.phaseVoteable",
    };
  }

  return {
    id: "live",
    icon: Clock3,
    labelKey: "vote.phaseInPlay",
  };
}

function getTeamVoteOutcome(roundVoteOutcomes, matchId, teamId) {
  return roundVoteOutcomes.find((outcome) => outcome.matchId === matchId && outcome.teamId === teamId) ?? null;
}

function getTeamAllocation(roundAllocations, matchId, teamId) {
  return roundAllocations.find((entry) => entry.matchId === matchId && entry.teamId === teamId) ?? null;
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
  onSelectMatch,
  onSelectTeam,
  copy,
}) {
  const { compactVotes, roundLabel, t, teamName } = copy;
  const selectedLaneRef = useRef(null);
  const hasSyncedSelectedLaneRef = useRef(false);

  useEffect(() => {
    const selectedLane = selectedLaneRef.current;
    const scrollContainer = selectedLane?.closest(".match-prize-list-view__matches");
    if (!selectedLane || !scrollContainer) return undefined;

    if (!hasSyncedSelectedLaneRef.current) {
      hasSyncedSelectedLaneRef.current = true;
      return undefined;
    }

    let mobileScrollTimeoutId = 0;
    const animationFrameId = window.requestAnimationFrame(() => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const laneRect = selectedLane.getBoundingClientRect();
      const scrollInsetTop = getScrollInsetTop(scrollContainer);
      scrollContainer.scrollTo({
        top: Math.max(0, scrollContainer.scrollTop + laneRect.top - containerRect.top - scrollInsetTop),
        behavior: "smooth",
      });

      if (window.matchMedia("(max-width: 760px)").matches) {
        mobileScrollTimeoutId = window.setTimeout(() => {
          const nextLaneRect = selectedLane.getBoundingClientRect();
          const headerOffset = 16;
          if (nextLaneRect.top < headerOffset || nextLaneRect.bottom > window.innerHeight) {
            window.scrollTo({
              top: Math.max(0, window.scrollY + nextLaneRect.top - headerOffset),
              behavior: "smooth",
            });
          }
        }, 260);
      }
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      if (mobileScrollTimeoutId) window.clearTimeout(mobileScrollTimeoutId);
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
          const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
          const matchAllocations = roundAllocations.filter((entry) => entry.matchId === match.id);
          const canPickMatch = voteableStatuses.has(match.status);
          const selected = selectedMatchId === match.id;
          const phase = getMatchPhase(match);
          const statusText = t(phase.labelKey);
          const MatchIcon = phase.icon;

          return (
            <li
              ref={selected ? selectedLaneRef : null}
              className={[
                "match-prize-lane",
                selected ? "is-selected" : "",
                matchAllocations.length > 0 ? "has-vote-record" : "",
                `is-phase-${phase.id}`,
                voteableStatuses.has(match.status) ? "is-open" : "is-closed",
                `is-${match.status}`,
              ].filter(Boolean).join(" ")}
              key={match.id}
              data-match-id={match.id}
              style={{ "--match-lane-index": matchIndex }}
            >
              <header className="match-prize-lane__head">
                <span className="match-prize-lane__meta">
                  <span className="match-prize-lane__code">{match.id.toUpperCase()}</span>
                  <small className="match-prize-lane__status">
                    <MatchIcon size={13} strokeWidth={2.35} />
                    {statusText}
                  </small>
                </span>
                <MatchPrizeImageDialog copy={copy} matchId={match.id} />
              </header>

              <section className="match-prize-lane__teams" aria-label={t("schedule.teamsAria", { match: match.id.toUpperCase() })}>
                {teams.map((team, teamIndex) => {
                  const allocation = getTeamAllocation(roundAllocations, match.id, team.id);
                  const canPickTeam = canPickMatch;
                  const isSelectedTeam = selected && selectedTeamId === team.id;
                  const isAllocatedTeam = Boolean(allocation);
                  const isWinner = match.advancingTeamId === team.id;
                  const isEliminated = Boolean(match.advancingTeamId && match.advancingTeamId !== team.id);
                  const voteOutcome = getTeamVoteOutcome(roundVoteOutcomes, match.id, team.id);
                  const hitRate = voteOutcome
                    ? formatHitRate(estimateMultiPrizeChance(
                      voteOutcome.tickets,
                      team.votes,
                      activeRound?.matchPrizeSlotCount || 1,
                    ))
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
                          </span>
                          <small>{compactVotes(team.votes)}</small>
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
