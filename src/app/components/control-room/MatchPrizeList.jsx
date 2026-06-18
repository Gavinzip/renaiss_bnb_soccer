import {
  Clock3,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { Fragment } from "react";
import { formatNumber } from "../../data/ticketMath";

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

function getMatchPrize(match, activeRound) {
  return {
    amount: match?.matchPrizeAmount ?? activeRound?.matchPrizeAmount,
    currency: match?.prizeCurrency ?? activeRound?.prizeCurrency,
  };
}

function formatPrizeAmount(match, activeRound) {
  const prize = getMatchPrize(match, activeRound);
  if (!Number.isFinite(prize.amount) || !prize.currency) return null;
  const currency = prize.currency === "USDT" ? "U" : ` ${prize.currency}`;
  return `${formatNumber(prize.amount)}${currency}`;
}

function getTeamVoteOutcome(roundVoteOutcomes, matchId, teamId) {
  return roundVoteOutcomes.find((outcome) => outcome.matchId === matchId && outcome.teamId === teamId) ?? null;
}

function getTeamAllocation(roundAllocations, matchId, teamId) {
  return roundAllocations.find((entry) => entry.matchId === matchId && entry.teamId === teamId) ?? null;
}

export function MatchPrizeList({
  activeRound,
  matches,
  teamsById,
  selectedMatchId,
  selectedTeamId,
  roundAllocations,
  roundVoteOutcomes = [],
  remainingRoundTickets,
  onSelectMatch,
  onSelectTeam,
  copy,
}) {
  const { compactVotes, roundLabel, t, teamName } = copy;
  const roundPrizeAmount = formatPrizeAmount(matches[0], activeRound);

  return (
    <section className="match-prize-list-view" aria-label={t("vote.matchPrizeListAria", { round: roundLabel(activeRound) })}>
      <header className="match-prize-list-view__head">
        <span>{t("vote.matchPrizeListTitle", { round: roundLabel(activeRound, "advanceLabel") })}</span>
        <strong>
          {roundPrizeAmount
            ? t("vote.matchPrizePerMatch", { amount: roundPrizeAmount })
            : t("vote.matchPrizeMissing")}
        </strong>
        <p>{t("vote.matchPrizeListBody")}</p>
      </header>

      <ol className="match-prize-list-view__matches">
        {matches.map((match, matchIndex) => {
          const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
          const matchAllocations = roundAllocations.filter((entry) => entry.matchId === match.id);
          const matchTicketTotal = matchAllocations.reduce((total, entry) => total + entry.tickets, 0);
          const allocationIndex = matchAllocations.length > 0
            ? roundAllocations.findIndex((entry) => entry.id === matchAllocations[0].id)
            : -1;
          const canPickMatch = voteableStatuses.has(match.status) && remainingRoundTickets > 0;
          const selected = selectedMatchId === match.id;
          const phase = getMatchPhase(match);
          const statusText = t(phase.labelKey);
          const MatchIcon = phase.icon;
          const matchPrizeAmount = formatPrizeAmount(match, activeRound);

          return (
            <li
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
                <span>{match.id.toUpperCase()}</span>
                <strong>{matchPrizeAmount ?? t("vote.matchPrizeMissing")}</strong>
                <small>
                  <MatchIcon size={14} strokeWidth={2.35} />
                  {statusText}
                </small>
                {matchAllocations.length > 0 ? (
                  <em className="match-prize-lane__vote-mark">
                    {t("vote.votedTicketBadge", {
                      index: formatNumber(allocationIndex + 1),
                      tickets: formatNumber(matchTicketTotal),
                    })}
                  </em>
                ) : null}
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
                  const voteOutcomeText = voteOutcome?.result === "lost"
                    ? t("vote.myLostTickets", {
                      tickets: formatNumber(voteOutcome.tickets),
                      lost: formatNumber(voteOutcome.lostTickets || voteOutcome.tickets),
                    })
                    : voteOutcome
                      ? t("vote.myWonTickets", { tickets: formatNumber(voteOutcome.tickets) })
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
                        <span>
                          <strong>{teamName(team)}</strong>
                          <small>{compactVotes(team.votes)}</small>
                          {voteOutcome ? (
                            <b className={[
                              "match-prize-team__vote-result",
                              `is-${voteOutcome.result}`,
                            ].join(" ")}
                            >
                              {voteOutcomeText}
                            </b>
                          ) : null}
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
