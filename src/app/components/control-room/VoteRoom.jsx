import {
  AlertTriangle,
  Clock3,
  Coins,
  LockKeyhole,
  Minus,
  Plus,
  Send,
  ShieldCheck,
  Ticket,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { compactAddress, formatNumber, formatPrizeMoney } from "../../data/ticketMath";
import { getPreviewNotice } from "../../data/campaignRuntime";
import prizeBonneySlab from "../../assets/prize-bonney-slab.webp";
import { preloadImage } from "../../utils/preloadAssets";
import ElasticSlider from "../ElasticSlider/ElasticSlider";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { MatchPrizeList } from "./MatchPrizeList";
import { PrizeMatchCarousel } from "./PrizeMatchCarousel";

const voteableStatuses = new Set(["open", "closing_soon"]);
const prizePresentationModes = ["showcase", "matchList"];
const matchPhaseOrder = {
  official_final: 0,
  locked: 1,
  scheduled: 1,
  closing_soon: 2,
  open: 2,
};

export function preloadRoomAssets() {
  return preloadImage(prizeBonneySlab);
}

function clampTicketAmount(value, maxTickets) {
  return Math.max(1, Math.min(Math.floor(Number(value) || 1), Math.max(1, maxTickets)));
}

function getMatchIcon(match, allocation) {
  if (match.status === "open") return Ticket;
  if (match.status === "closing_soon") return Clock3;
  if (match.status === "official_final") return ShieldCheck;
  return LockKeyhole;
}

function getMatchPhase(match) {
  if (match.status === "official_final") {
    return {
      id: "final",
      labelKey: "vote.phaseFinal",
    };
  }

  if (voteableStatuses.has(match.status)) {
    return {
      id: "voteable",
      labelKey: "vote.phaseVoteable",
    };
  }

  return {
    id: "live",
    labelKey: "vote.phaseInPlay",
  };
}

function getMatchTone(match) {
  return getMatchPhase(match).id;
}

function sortMatchesByDisplayPhase(left, right) {
  return (
    (matchPhaseOrder[left.status] ?? 1) - (matchPhaseOrder[right.status] ?? 1)
  ) || (
    new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime()
  ) || left.id.localeCompare(right.id, undefined, { numeric: true });
}

function getTeamTone(match, team, allocation, selectedTeamId) {
  if (allocation) return "allocated";
  if (selectedTeamId === team.id) return "selected";
  if (match.advancingTeamId === team.id) return "winner";
  if (match.advancingTeamId && match.advancingTeamId !== team.id) return "eliminated";
  return "idle";
}

function getTeamAllocation(roundAllocations, matchId, teamId) {
  return roundAllocations.find((allocation) => allocation.matchId === matchId && allocation.teamId === teamId) ?? null;
}

function allocationOrderTimestamp(allocation) {
  return allocation?.createdAt || allocation?.updatedAt || allocation?.submittedAt || "";
}

function compareVoteTicketOrder(left, right) {
  const leftTime = allocationOrderTimestamp(left);
  const rightTime = allocationOrderTimestamp(right);
  if (leftTime || rightTime) {
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
  } else {
    return 0;
  }
  if (left.walletAddress !== right.walletAddress) return String(left.walletAddress || "").localeCompare(String(right.walletAddress || ""));
  if (left.matchId !== right.matchId) return String(left.matchId || "").localeCompare(String(right.matchId || ""));
  if (left.teamId !== right.teamId) return String(left.teamId || "").localeCompare(String(right.teamId || ""));
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function ticketRangeFromBounds(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return "";
  return start === end ? `#${formatNumber(start)}` : `#${formatNumber(start)}-${formatNumber(end)}`;
}

function ticketsForAllocation(allocation) {
  return Math.max(0, Math.floor(Number(allocation?.tickets) || 0));
}

function getMatchTeamAllocations(allocations, matchId, teamId) {
  return allocations
    .filter((allocation) => allocation.matchId === matchId && allocation.teamId === teamId)
    .map((allocation, index) => ({ allocation, index }))
    .sort((left, right) => compareVoteTicketOrder(left.allocation, right.allocation) || left.index - right.index);
}

function getAllocationMatchTeamTicketRange(allocation, allocations) {
  const explicitStart = Math.floor(Number(allocation?.ticketStart) || 0);
  const explicitEnd = Math.floor(Number(allocation?.ticketEnd) || 0);
  if (explicitStart > 0 && explicitEnd >= explicitStart) return ticketRangeFromBounds(explicitStart, explicitEnd);

  const orderedAllocations = getMatchTeamAllocations(allocations, allocation?.matchId, allocation?.teamId);
  let cursor = 0;
  for (const row of orderedAllocations) {
    const allocationTickets = ticketsForAllocation(row.allocation);
    const start = cursor + 1;
    const end = cursor + allocationTickets;
    cursor = end;
    if (row.allocation === allocation || row.allocation.id === allocation?.id) return ticketRangeFromBounds(start, end);
  }
  return "";
}

function getProjectedMatchTeamTicketRange(allocations, matchId, teamId, ticketAmount) {
  const currentTotal = getMatchTeamAllocations(allocations, matchId, teamId)
    .reduce((total, row) => total + ticketsForAllocation(row.allocation), 0);
  const tickets = Math.max(0, Math.floor(Number(ticketAmount) || 0));
  if (!matchId || !teamId || tickets <= 0) return "";
  return ticketRangeFromBounds(currentTotal + 1, currentTotal + tickets);
}

function getMatchPrize(match, round, locale) {
  const amount = Number(match?.matchPrizeAmount ?? round?.matchPrizeAmount ?? 0);
  const currency = String(match?.prizeCurrency ?? round?.prizeCurrency ?? "USDT");
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const approximate = Boolean(match?.matchPrizeApproximate ?? round?.matchPrizeApproximate);
  const roundedAmount = Math.round(amount);
  return {
    amount,
    amountLabel: formatPrizeMoney(amount, currency, locale),
    currency,
    approximate,
    roundedLabel: approximate && Math.abs(roundedAmount - amount) > Number.EPSILON
      ? formatPrizeMoney(roundedAmount, currency, locale)
      : "",
    roundPoolLabel: round?.roundPrizePool ? formatPrizeMoney(round.roundPrizePool, currency, locale) : "",
    drawCount: Number(match?.drawCount ?? round?.drawCount ?? 0),
    prizeSlotCount: Number(match?.matchPrizeSlotCount ?? round?.matchPrizeSlotCount ?? 1),
    alternateCount: Number(match?.alternateCount ?? round?.alternateCount ?? 0),
  };
}

function PrizePresentationSwitch({ mode, onChange, copy }) {
  const { t } = copy;

  return (
    <nav className="vote-prize-mode-switch" aria-label={t("vote.prizeViewAria")}>
      {prizePresentationModes.map((modeId) => (
        <button
          type="button"
          className={mode === modeId ? "is-active" : ""}
          key={modeId}
          onClick={() => onChange(modeId)}
          aria-pressed={mode === modeId}
        >
          {t(`vote.prizeView.${modeId}`)}
        </button>
      ))}
    </nav>
  );
}

function MatchVoteGroup({
  match,
  allocations = [],
  selectedMatchId,
  selectedTeamId,
  teamsById,
  remainingRoundTickets,
  onSelectMatch,
  onSelectTeam,
  copy,
}) {
  const { compactVotes, dateTime, t, teamName, venueName } = copy;
  const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
  const matchAllocations = allocations.filter((entry) => entry.matchId === match.id);
  const matchTicketTotal = matchAllocations.reduce((total, entry) => total + entry.tickets, 0);
  const matchAllocationIndex = matchAllocations.length > 0
    ? allocations.findIndex((entry) => entry.id === matchAllocations[0].id)
    : -1;
  const canVote = voteableStatuses.has(match.status) && remainingRoundTickets > 0;
  const selected = selectedMatchId === match.id;
  const MatchIcon = getMatchIcon(match, matchAllocations[0]);
  const phase = getMatchPhase(match);
  const tone = getMatchTone(match);

  function handlePickTeam(team) {
    onSelectMatch(match.id);
    if (canVote) onSelectTeam(team.id);
  }

  return (
    <article className={[
      "vote-match-group",
      `is-${tone}`,
      selected ? "is-selected" : "",
    ].filter(Boolean).join(" ")}
    >
      <header className="vote-match-group__header">
        <span className="vote-match-group__code">{match.id.toUpperCase()}</span>
        <strong>
          <MatchIcon size={15} strokeWidth={2.35} />
          {t(phase.labelKey)}
        </strong>
        {matchAllocations.length > 0 ? (
          <em className="vote-match-group__vote-mark">
            {t("vote.votedTicketBadge", {
              index: formatNumber(matchAllocationIndex + 1),
              tickets: formatNumber(matchTicketTotal),
            })}
          </em>
        ) : null}
        <small>{venueName(match.venue)} · {dateTime(match.cutoffAt)} {t("common.hkt")}</small>
      </header>

      <section className="vote-match-group__teams" aria-label={t("schedule.teamsAria", { match: match.id.toUpperCase() })}>
        {teams.map((team, index) => {
          const allocation = getTeamAllocation(allocations, match.id, team.id);
          const teamTone = getTeamTone(match, team, allocation, selected && selectedTeamId);
          const isSelected = selected && selectedTeamId === team.id;
          const disabled = !canVote;
          const stateText = allocation
            ? t("vote.allocationForMatch", { team: teamName(team), tickets: formatNumber(allocation.tickets) })
            : isSelected
              ? t("vote.selectedForPreview")
              : canVote
                ? t("vote.chooseThisTeam")
                : t("vote.voteWindowClosed");

          return (
            <Magnet
              as="button"
              type="button"
              strength={48}
              key={team.id}
              className={[
                "vote-team-choice",
                `is-${teamTone}`,
                isSelected ? "is-current" : "",
              ].filter(Boolean).join(" ")}
              disabled={disabled}
              onClick={() => handlePickTeam(team)}
              aria-label={`${teamName(team)} ${stateText}`}
            >
              <img src={team.flagSrc} alt="" aria-hidden="true" />
              <span>
                <strong>{teamName(team)}</strong>
                <small>{stateText}</small>
              </span>
              <em>{compactVotes(team.votes)}</em>
              {index === 0 ? <i className="vote-team-choice__join" aria-hidden="true" /> : null}
            </Magnet>
          );
        })}
        <span className="vote-match-group__versus" aria-hidden="true">{t("vote.versusShort")}</span>
      </section>
      <p>{t("vote.matchGroupHint")}</p>
    </article>
  );
}

function TicketAllocationPanel({
  selectedMatch,
  selectedTeam,
  activeRound,
  ticketAmount,
  remainingRoundTickets,
  usedRoundTickets,
  activeAllocation,
  matchPrize,
  roundAllocations = [],
  onSetTicketAmount,
  onConfirmPreviewVote,
  copy,
}) {
  const { number, roundLabel, t, teamName } = copy;
  const maxTickets = Math.max(1, remainingRoundTickets);
  const boundedTicketAmount = clampTicketAmount(ticketAmount, maxTickets);
  const selectedTeamName = selectedTeam ? teamName(selectedTeam) : null;
  const selectedMatchLabel = selectedMatch ? selectedMatch.id.toUpperCase() : null;
  const selectedPhase = selectedMatch ? getMatchPhase(selectedMatch) : null;
  const canSubmit = Boolean(
    selectedTeam
    && selectedMatch
    && voteableStatuses.has(selectedMatch.status)
    && remainingRoundTickets > 0,
  );
  const projectedTicketRange = canSubmit
    ? getProjectedMatchTeamTicketRange(roundAllocations, selectedMatch.id, selectedTeam.id, boundedTicketAmount)
    : "";

  function handleSetTicketAmount(value) {
    onSetTicketAmount(clampTicketAmount(value, maxTickets));
  }

  return (
    <aside className="vote-allocation-panel" aria-label={t("vote.votePanelTitle")}>
      <header>
        <span>{roundLabel(activeRound, "advanceLabel")}</span>
        <h2>{t("vote.votePanelTitle")}</h2>
        <p>
          {canSubmit
            ? t("vote.votePanelReady", { team: selectedTeamName, match: selectedMatchLabel })
            : t("vote.votePanelIdle")}
        </p>
      </header>

      <section className={["vote-selected-target", selectedTeam ? "has-team" : ""].filter(Boolean).join(" ")} aria-live="polite">
        <span>{t("vote.selectedTargetLabel")}</span>
        {selectedTeam ? (
          <strong>
            <img src={selectedTeam.flagSrc} alt="" aria-hidden="true" />
            <b>{selectedTeamName}</b>
          </strong>
        ) : (
          <strong>{t("vote.selectedTargetEmpty")}</strong>
        )}
        <small>
          {selectedMatch
            ? t("vote.selectedTargetMeta", {
              match: selectedMatchLabel,
              status: t(selectedPhase.labelKey),
            })
            : t("vote.selectedTargetNoMatch")}
        </small>
      </section>

      {matchPrize ? (
        <section className="vote-match-prize-callout" aria-label={t("vote.matchPrizePoolAria")}>
          <span>
            <Coins size={15} strokeWidth={2.25} />
            {matchPrize.approximate ? t("vote.matchPrizePoolApproxLabel") : t("vote.matchPrizePoolLabel")}
          </span>
          <strong>{matchPrize.amountLabel}</strong>
          <p>{t("vote.matchPrizePoolHint")}</p>
          <small>
            {matchPrize.roundPoolLabel && matchPrize.drawCount
              ? t("vote.matchPrizePoolMeta", {
                pool: matchPrize.roundPoolLabel,
                count: number(matchPrize.drawCount),
              })
              : t("vote.matchPrizePoolFixed")}
            {matchPrize.prizeSlotCount
              ? ` · ${t("vote.matchPrizeWinnerPolicy", {
                winners: number(matchPrize.prizeSlotCount),
              })}`
              : ""}
          </small>
          {projectedTicketRange ? (
            <small className="vote-match-prize-callout__ticket-range">
              <Ticket size={14} strokeWidth={2.25} />
              {t("vote.projectedMatchTeamTickets", { range: projectedTicketRange })}
            </small>
          ) : null}
        </section>
      ) : null}

      <section className="vote-allocation-status">
        <output>
          <span>{t("common.ticketsLeft")}</span>
          <strong>{formatNumber(remainingRoundTickets)}</strong>
        </output>
        <output>
          <span>{t("vote.previewUsed")}</span>
          <strong>{formatNumber(usedRoundTickets)}</strong>
        </output>
        <output>
          <span>{t("common.status")}</span>
          <strong>{selectedPhase ? t(selectedPhase.labelKey) : "-"}</strong>
        </output>
      </section>

      <fieldset className="vote-ticket-stepper" disabled={!canSubmit}>
        <legend>{t("common.allocationAmount")}</legend>
        <button type="button" onClick={() => handleSetTicketAmount(boundedTicketAmount - 1)} aria-label={t("vote.decreaseTickets")}>
          <Minus size={16} strokeWidth={2.35} />
        </button>
        <label>
          <span>{t("common.tickets")}</span>
          <input
            type="number"
            min="1"
            max={maxTickets}
            value={boundedTicketAmount}
            onChange={(event) => handleSetTicketAmount(event.target.value)}
            aria-label={t("vote.ticketAmountInput")}
          />
        </label>
        <button type="button" onClick={() => handleSetTicketAmount(boundedTicketAmount + 1)} aria-label={t("vote.increaseTickets")}>
          <Plus size={16} strokeWidth={2.35} />
        </button>
      </fieldset>

      <ElasticSlider
        className="vote-ticket-range"
        startingValue={1}
        maxValue={maxTickets}
        value={boundedTicketAmount}
        isStepped
        stepSize={1}
        disabled={!canSubmit}
        showValue={false}
        leftIcon={<Minus aria-hidden="true" />}
        rightIcon={<Plus aria-hidden="true" />}
        ariaLabel={t("vote.ticketRange")}
        onChange={handleSetTicketAmount}
      />

      <Magnet
        as="button"
        className="vote-allocation-panel__cta"
        type="button"
        strength={44}
        disabled={!canSubmit}
        onClick={() => onConfirmPreviewVote(boundedTicketAmount)}
      >
        <span className="vote-allocation-panel__cta-content">
          {canSubmit ? <Send size={17} strokeWidth={2.35} /> : <LockKeyhole size={17} strokeWidth={2.35} />}
          <span>{t("vote.submitPreviewVote")}</span>
        </span>
      </Magnet>
    </aside>
  );
}

function VoteWalletPanel({
  ledger,
  ledgerIssue,
  previewVoteIssue,
  activeEntry,
  selectedWallet,
  authSession,
  authEndpointReady,
  activeRound,
  remainingRoundTickets,
  usedRoundTickets,
  roundAllocations,
  matchesById,
  teamsById,
  onSelectWallet,
  onOpenAuthModal,
  copy,
}) {
  const { roundLabel, teamName, t } = copy;
  const authWalletLinked = Boolean(authSession?.walletAddress);

  return (
    <aside className="vote-wallet-panel" aria-label={authEndpointReady ? t("auth.accountAria") : t("vote.previewWallet")}>
      <header>
        <span>
          <WalletCards size={15} strokeWidth={2.25} />
          {authEndpointReady ? t("auth.account") : t("vote.previewWallet")}
        </span>
        {authEndpointReady ? (
          <button className="vote-wallet-panel__auth" type="button" onClick={onOpenAuthModal}>
            <strong>{authWalletLinked ? compactAddress(authSession.walletAddress) : authSession?.authenticated ? t("auth.walletUnlinked") : t("auth.loginCta")}</strong>
            <small>{authWalletLinked ? t("auth.linked") : t("auth.loginDetail")}</small>
          </button>
        ) : (
          <select value={selectedWallet} onChange={(event) => onSelectWallet(event.target.value)} aria-label={t("vote.selectPreviewWallet")}>
            {ledger.leaderboardEntries.map((entry) => (
              <option key={entry.userAddress} value={entry.userAddress}>
                #{entry.rank} {compactAddress(entry.userAddress)} · {formatNumber(entry.finalTickets)}
              </option>
            ))}
          </select>
        )}
      </header>
      <section className="vote-balance-strip" aria-label={t("vote.roundBalance", { round: roundLabel(activeRound) })}>
        <output>
          <span>{t("common.ticketsLeft")}</span>
          <strong>{formatNumber(remainingRoundTickets)}</strong>
        </output>
        <output>
          <span>{t("vote.previewUsed")}</span>
          <strong>{formatNumber(usedRoundTickets)}</strong>
        </output>
        <output>
          <span>{t("vote.walletTotalTickets")}</span>
          <strong>{formatNumber(activeEntry?.finalTickets ?? 0)}</strong>
        </output>
      </section>
      <section className="vote-preview-list" aria-label={t("vote.currentRoundSummary")}>
        <header>
          <span>{t("vote.pendingAllocationSummary")}</span>
          <strong>{formatNumber(roundAllocations.length)}</strong>
        </header>
        {roundAllocations.length > 0 ? (
          <ol>
            {roundAllocations.map((allocation) => {
              const match = matchesById.get(allocation.matchId);
              const team = teamsById.get(allocation.teamId);
              const matchTeams = match?.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean) ?? [];
              const matchTitle = matchTeams.map((entry) => teamName(entry)).join(` ${t("vote.versusShort")} `);
              const ticketRange = getAllocationMatchTeamTicketRange(allocation, roundAllocations);
              return (
                <li key={allocation.id}>
                  <img src={team?.flagSrc} alt="" aria-hidden="true" />
                  <span>
                    <strong>{match?.id.toUpperCase()} · {matchTitle}</strong>
                    <small>
                      {teamName(team) || allocation.teamId} · {formatNumber(allocation.tickets)} {t("common.tickets")}
                      {ticketRange ? ` · ${t("vote.matchTeamTicketRange", { range: ticketRange })}` : ""}
                    </small>
                  </span>
                  <em>{getPreviewNotice(allocation, t)}</em>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>{t("vote.noPreviewAllocations")}</p>
        )}
      </section>
      {ledgerIssue ? (
        <p className="vote-issue">
          <AlertTriangle size={16} strokeWidth={2.35} />
          {ledgerIssue}
        </p>
      ) : null}
      {previewVoteIssue ? (
        <p className="vote-issue">
          <AlertTriangle size={16} strokeWidth={2.35} />
          {previewVoteIssue}
        </p>
      ) : null}
    </aside>
  );
}

export function VoteRoom({
  ledger,
  ledgerIssue,
  activeEntry,
  selectedWallet,
  activeRound,
  activeRoundId,
  matches,
  teamsById,
  selectedMatch,
  selectedTeamId,
  ticketAmount,
  remainingRoundTickets,
  usedRoundTickets,
  roundAllocations,
  roundVoteOutcomes = [],
  roundOutcomeSummary,
  previewVoteIssue = "",
  authSession,
  authEndpointReady = false,
  onSelectWallet,
  onOpenAuthModal,
  onSelectMatch,
  onSelectTeam,
  onSetTicketAmount,
  onConfirmPreviewVote,
}) {
  const copy = useCampaignCopy();
  const { roundLabel, t, teamName } = copy;
  const [prizePresentationMode, setPrizePresentationMode] = useState("matchList");
  const roundMatches = [...matches]
    .filter((match) => match.roundId === activeRoundId)
    .sort(sortMatchesByDisplayPhase);
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const selectedRoundMatch = selectedMatch && roundMatches.some((match) => match.id === selectedMatch.id)
    ? selectedMatch
    : roundMatches[0];
  const activeAllocation = selectedTeamId
    ? getTeamAllocation(roundAllocations, selectedRoundMatch?.id, selectedTeamId)
    : null;
  const selectedTeam = selectedRoundMatch?.teams.includes(selectedTeamId)
    ? teamsById.get(selectedTeamId)
    : null;
  const voteableMatchCount = roundMatches.filter((match) => voteableStatuses.has(match.status)).length;
  const selectedRoundMatchTitle = selectedRoundMatch
    ? selectedRoundMatch.teams.map((teamId) => teamName(teamsById.get(teamId))).join(` ${t("vote.versusShort")} `)
    : "";
  const selectedRoundPrize = getMatchPrize(selectedRoundMatch, activeRound, copy.locale);

  return (
    <section
      className={[
        "vote-room vote-room-groups",
        prizePresentationMode === "matchList" ? "is-match-prize-list" : "is-prize-showcase",
      ].join(" ")}
      aria-label={t("vote.roomAria")}
    >
      <header className="vote-stage-head">
        <span>{roundLabel(activeRound, "englishLabel")}</span>
        <h1>{t("vote.stageDeckTitle", { round: roundLabel(activeRound, "advanceLabel") })}</h1>
        <p>{t("vote.stageDeckBody")}</p>
        <section className="vote-stage-summary" aria-label={t("vote.currentRoundSummary")}>
          <output>
            <span>{t("common.ticketsLeft")}</span>
            <strong>{formatNumber(remainingRoundTickets)}</strong>
          </output>
          <output>
            <span>{t("vote.previewUsed")}</span>
            <strong>{formatNumber(usedRoundTickets)}</strong>
          </output>
          <output>
            <span>{t("vote.lostTickets")}</span>
            <strong>{formatNumber(roundOutcomeSummary?.lostTickets ?? 0)}</strong>
          </output>
          <output>
            <span>{t("common.matches")}</span>
            <strong>{formatNumber(voteableMatchCount)} / {formatNumber(roundMatches.length)}</strong>
          </output>
        </section>
        {selectedRoundMatch ? (
          <strong className="vote-stage-head__current">
            {selectedRoundMatch.id.toUpperCase()}
            {prizePresentationMode === "matchList" && selectedRoundPrize
              ? ` · ${selectedRoundPrize.approximate ? t("vote.matchPrizePillApprox", { amount: selectedRoundPrize.amountLabel }) : t("vote.matchPrizePill", { amount: selectedRoundPrize.amountLabel })}`
              : ` · ${selectedRoundMatchTitle}`}
          </strong>
        ) : null}
      </header>

      <section className="vote-room-grid">
        <section className="vote-prize-stage" aria-label={t("common.prizes")}>
          <header className="vote-prize-stage__toolbar">
            <span>{t("vote.prizeViewLabel")}</span>
            <PrizePresentationSwitch
              mode={prizePresentationMode}
              onChange={setPrizePresentationMode}
              copy={copy}
            />
          </header>
          {prizePresentationMode === "showcase" ? (
            <PrizeMatchCarousel
              matches={roundMatches}
              teamsById={teamsById}
              selectedMatchId={selectedRoundMatch?.id}
              selectedTeamId={selectedTeamId}
              roundAllocations={roundAllocations}
              remainingRoundTickets={remainingRoundTickets}
              prizeSrc={prizeBonneySlab}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              copy={copy}
            />
          ) : (
            <MatchPrizeList
              activeRound={activeRound}
              matches={roundMatches}
              teamsById={teamsById}
              selectedMatchId={selectedRoundMatch?.id}
              selectedTeamId={selectedTeamId}
              roundAllocations={roundAllocations}
              roundVoteOutcomes={roundVoteOutcomes}
              remainingRoundTickets={remainingRoundTickets}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              copy={copy}
            />
          )}
        </section>

        <GlareHover as="aside" className="vote-side-rail">
          <TicketAllocationPanel
            selectedMatch={selectedRoundMatch}
            selectedTeam={selectedTeam}
            activeRound={activeRound}
            ticketAmount={ticketAmount}
            remainingRoundTickets={remainingRoundTickets}
            usedRoundTickets={usedRoundTickets}
            activeAllocation={activeAllocation}
            matchPrize={selectedRoundPrize}
            roundAllocations={roundAllocations}
            onSetTicketAmount={onSetTicketAmount}
            onConfirmPreviewVote={onConfirmPreviewVote}
            copy={copy}
          />

          <VoteWalletPanel
            ledger={ledger}
            ledgerIssue={ledgerIssue}
            previewVoteIssue={previewVoteIssue}
            activeEntry={activeEntry}
            selectedWallet={selectedWallet}
            authSession={authSession}
            authEndpointReady={authEndpointReady}
            activeRound={activeRound}
            remainingRoundTickets={remainingRoundTickets}
            usedRoundTickets={usedRoundTickets}
            roundAllocations={roundAllocations}
            matchesById={matchesById}
            teamsById={teamsById}
            onSelectWallet={onSelectWallet}
            onOpenAuthModal={onOpenAuthModal}
            copy={copy}
          />
        </GlareHover>
      </section>
    </section>
  );
}
