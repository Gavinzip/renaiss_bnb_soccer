import { ChevronLeft, ChevronRight, Gift } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "../../data/ticketMath";

const swipeThreshold = 42;
const maxDragOffset = 120;
const voteableStatuses = new Set(["open", "closing_soon"]);

function getMatchPhase(match) {
  if (match.awaitingOfficialResult) return { id: "locked", labelKey: "vote.phasePendingResult" };
  if (match.status === "official_final") return { id: "final", labelKey: "vote.phaseFinal" };
  if (voteableStatuses.has(match.status)) return { id: "voteable", labelKey: "vote.phaseVoteable" };
  return { id: "live", labelKey: "vote.phaseInPlay" };
}

function normalizeIndex(index, count) {
  if (!count) return 0;
  return (index + count) % count;
}

function getMatchTeams(match, teamsById) {
  return match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
}

function getTeamAllocation(roundAllocations, matchId, teamId) {
  return roundAllocations.find((entry) => entry.matchId === matchId && entry.teamId === teamId) ?? null;
}

export function PrizeMatchCarousel({
  matches,
  teamsById,
  selectedMatchId,
  selectedTeamId,
  roundAllocations,
  remainingRoundTickets,
  prizeSrc,
  onSelectMatch,
  onSelectTeam,
  copy,
}) {
  const { compactVotes, dateTime, t, teamName, venueName } = copy;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerStartRef = useRef(null);
  const matchCount = matches.length;
  const selectedIndex = useMemo(
    () => matches.findIndex((match) => match.id === selectedMatchId),
    [matches, selectedMatchId],
  );

  useEffect(() => {
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (activeIndex >= matchCount) setActiveIndex(0);
  }, [activeIndex, matchCount]);

  function goTo(index) {
    const nextIndex = normalizeIndex(index, matchCount);
    const nextMatch = matches[nextIndex];
    if (!nextMatch) return;

    setActiveIndex(nextIndex);
    onSelectMatch(nextMatch.id);
  }

  function handlePointerDown(event) {
    if (event.target instanceof Element && event.target.closest(".prize-slide__team")) return;

    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: event.currentTarget.getBoundingClientRect().width,
    };
    setIsDragging(true);
    setDragOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function resetDrag() {
    pointerStartRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  }

  function handlePointerUp(event) {
    const start = pointerStartRef.current;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start || start.pointerId !== event.pointerId) {
      resetDrag();
      return;
    }

    const deltaX = event.clientX - start.x;
    resetDrag();
    if (Math.abs(deltaX) < swipeThreshold) return;
    goTo(activeIndex + (deltaX < 0 ? 1 : -1));
  }

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--prize-glare-x", `${x.toFixed(2)}%`);
    event.currentTarget.style.setProperty("--prize-glare-y", `${y.toFixed(2)}%`);

    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const dragLimit = Math.min(maxDragOffset, Math.max(64, start.width * 0.18));
    setDragOffset(Math.max(-dragLimit, Math.min(deltaX, dragLimit)));
  }

  if (!matchCount) return null;

  const safeIndex = Math.min(activeIndex, matchCount - 1);

  return (
    <section className="prize-carousel" aria-roledescription="carousel" aria-label={t("common.prizes")}>
      <div
        className={[
          "prize-carousel__viewport",
          isDragging ? "is-dragging" : "",
        ].filter(Boolean).join(" ")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetDrag}
      >
        <div
          className="prize-carousel__track"
          data-dragging={isDragging ? "true" : "false"}
          style={{ transform: `translate3d(calc(${-safeIndex * 100}% + ${dragOffset}px), 0, 0)` }}
        >
          {matches.map((match, index) => {
            const teams = getMatchTeams(match, teamsById);
            const matchAllocations = roundAllocations.filter((entry) => entry.matchId === match.id);
            const matchTicketTotal = matchAllocations.reduce((total, entry) => total + entry.tickets, 0);
            const allocationIndex = matchAllocations.length > 0
              ? roundAllocations.findIndex((entry) => entry.id === matchAllocations[0].id)
              : -1;
            const active = index === safeIndex;
            const canPickMatch = voteableStatuses.has(match.status) && remainingRoundTickets > 0;
            const phase = getMatchPhase(match);
            const statusText = t(phase.labelKey);
            const matchTitle = teams.map((team) => teamName(team)).join(` ${t("vote.versusShort")} `);

            return (
              <article
                className={[
                  "prize-slide",
                  matchAllocations.length > 0 ? "has-vote-record" : "",
                  `is-phase-${phase.id}`,
                  voteableStatuses.has(match.status) ? "is-open" : "is-closed",
                  `is-${match.status}`,
                ].filter(Boolean).join(" ")}
                data-active={active ? "true" : "false"}
                key={match.id}
                aria-hidden={active ? "false" : "true"}
              >
                <header className="prize-slide__top">
                  <span>
                    <Gift size={15} strokeWidth={2.25} />
                    {t("common.prizes")} {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong>{match.id.toUpperCase()}</strong>
                  {matchAllocations.length > 0 ? (
                    <em className="prize-slide__vote-mark">
                      {t("vote.votedTicketBadge", {
                        index: formatNumber(allocationIndex + 1),
                        tickets: formatNumber(matchTicketTotal),
                      })}
                    </em>
                  ) : null}
                </header>

                <figure className="prize-slide__media">
                  <img
                    src={prizeSrc}
                    alt={`${match.id.toUpperCase()} ${t("common.prizes")}`}
                    draggable="false"
                  />
                </figure>

                <section className="prize-slide__match" aria-label={matchTitle}>
                  {teams.map((team, teamIndex) => {
                    const allocation = getTeamAllocation(roundAllocations, match.id, team.id);
                    const canPickTeam = canPickMatch;
                    const isCurrentTeam = active && selectedMatchId === match.id && selectedTeamId === team.id;
                    const isAllocatedTeam = Boolean(allocation);
                    const isWinner = match.advancingTeamId === team.id;
                    const isEliminated = Boolean(match.advancingTeamId && match.advancingTeamId !== team.id);

                    return (
                      <Fragment key={team.id}>
                        <button
                          className={[
                            "prize-slide__team",
                            teamIndex === 0 ? "is-left-team" : "is-right-team",
                            isCurrentTeam ? "is-current" : "",
                            isAllocatedTeam ? "is-allocated" : "",
                            isWinner ? "is-winner" : "",
                            isEliminated ? "is-eliminated" : "",
                          ].filter(Boolean).join(" ")}
                          type="button"
                          onClick={() => {
                            onSelectMatch(match.id);
                            if (canPickTeam) onSelectTeam(team.id);
                          }}
                          tabIndex={active ? 0 : -1}
                          aria-pressed={isCurrentTeam}
                        >
                          <img src={team.flagSrc} alt="" aria-hidden="true" />
                          <span>
                            <strong>{teamName(team)}</strong>
                            <small>{compactVotes(team.votes)}</small>
                          </span>
                        </button>
                        {teamIndex === 0 ? (
                          <span className="prize-slide__versus" aria-hidden="true">
                            {t("vote.versusShort")}
                          </span>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </section>

                <footer className="prize-slide__meta">
                  <span>{venueName(match.venue)} · {dateTime(match.cutoffAt)} {t("common.hkt")}</span>
                  <strong>{statusText}</strong>
                  <em>{formatNumber(match.poolEntries)} {t("common.entries")}</em>
                </footer>
              </article>
            );
          })}
        </div>
      </div>

      <nav className="prize-carousel__controls" aria-label={t("common.match")}>
        <button type="button" className="prize-carousel__nav" onClick={() => goTo(safeIndex - 1)} aria-label={t("vote.previousMatch")}>
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
        <div className="prize-carousel__dots" aria-hidden="true">
          {matches.map((match, index) => (
            <button
              type="button"
              key={match.id}
              className={index === safeIndex ? "is-active" : ""}
              onClick={() => goTo(index)}
              tabIndex={-1}
            />
          ))}
        </div>
        <button type="button" className="prize-carousel__nav" onClick={() => goTo(safeIndex + 1)} aria-label={t("vote.nextMatch")}>
          <ChevronRight size={18} strokeWidth={2.4} />
        </button>
      </nav>
    </section>
  );
}
