import {
  AlertTriangle,
  Clock3,
  LockKeyhole,
  Minus,
  Plus,
  Send,
  ShieldCheck,
  Ticket,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { compactAddress, formatNumber, ticketRangeLabel } from "../../data/ticketMath";
import { getPreviewNotice } from "../../data/campaignRuntime";
import prizeBonneySlab from "../../assets/prize-bonney-slab.webp";
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
  if (allocation?.teamId === team.id) return "allocated";
  if (selectedTeamId === team.id) return "selected";
  if (match.advancingTeamId === team.id) return "winner";
  if (match.advancingTeamId && match.advancingTeamId !== team.id) return "eliminated";
  return "idle";
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
  allocation,
  selectedMatchId,
  selectedTeamId,
  teamsById,
  remainingRoundTickets,
  onSelectMatch,
  onSelectTeam,
  allocationIndex = 0,
  copy,
}) {
  const { compactVotes, dateTime, t, teamName, venueName } = copy;
  const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
  const canVote = voteableStatuses.has(match.status) && remainingRoundTickets > 0;
  const selected = selectedMatchId === match.id;
  const MatchIcon = getMatchIcon(match, allocation);
  const phase = getMatchPhase(match);
  const tone = getMatchTone(match);

  function handlePickTeam(team) {
    onSelectMatch(match.id);
    if (canVote && (!allocation || allocation.teamId === team.id)) onSelectTeam(team.id);
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
        {allocation ? (
          <em className="vote-match-group__vote-mark">
            {t("vote.votedTicketBadge", {
              index: formatNumber(allocationIndex + 1),
              tickets: formatNumber(allocation.tickets),
            })}
          </em>
        ) : null}
        <small>{venueName(match.venue)} · {dateTime(match.cutoffAt)} {t("common.hkt")}</small>
      </header>

      <section className="vote-match-group__teams" aria-label={t("schedule.teamsAria", { match: match.id.toUpperCase() })}>
        {teams.map((team, index) => {
          const teamTone = getTeamTone(match, team, allocation, selected && selectedTeamId);
          const isSelected = selected && selectedTeamId === team.id;
          const disabled = !canVote || (allocation && allocation.teamId !== team.id);
          const stateText = allocation?.teamId === team.id
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
  onSetTicketAmount,
  onConfirmPreviewVote,
  copy,
}) {
  const { roundLabel, t, teamName } = copy;
  const maxTickets = Math.max(1, remainingRoundTickets);
  const boundedTicketAmount = clampTicketAmount(ticketAmount, maxTickets);
  const selectedTeamName = selectedTeam ? teamName(selectedTeam) : null;
  const selectedMatchLabel = selectedMatch ? selectedMatch.id.toUpperCase() : null;
  const selectedPhase = selectedMatch ? getMatchPhase(selectedMatch) : null;
  const canSubmit = Boolean(
    selectedTeam
    && selectedMatch
    && voteableStatuses.has(selectedMatch.status)
    && (!activeAllocation || activeAllocation.teamId === selectedTeam.id)
    && remainingRoundTickets > 0,
  );

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
        {canSubmit ? <Send size={17} strokeWidth={2.35} /> : <LockKeyhole size={17} strokeWidth={2.35} />}
        {t("vote.submitPreviewVote")}
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
  activeRound,
  remainingRoundTickets,
  usedRoundTickets,
  roundAllocations,
  matchesById,
  teamsById,
  onSelectWallet,
  copy,
}) {
  const { roundLabel, teamName, t } = copy;

  return (
    <aside className="vote-wallet-panel" aria-label={t("vote.previewWallet")}>
      <header>
        <span>
          <WalletCards size={15} strokeWidth={2.25} />
          {t("vote.previewWallet")}
        </span>
        <select value={selectedWallet} onChange={(event) => onSelectWallet(event.target.value)} aria-label={t("vote.selectPreviewWallet")}>
          {ledger.leaderboardEntries.map((entry) => (
            <option key={entry.userAddress} value={entry.userAddress}>
              #{entry.rank} {compactAddress(entry.userAddress)} · {formatNumber(entry.finalTickets)}
            </option>
          ))}
        </select>
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
          <span>{t("common.range")}</span>
          <strong>{ticketRangeLabel(activeEntry)}</strong>
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
              return (
                <li key={allocation.id}>
                  <img src={team?.flagSrc} alt="" aria-hidden="true" />
                  <span>
                    <strong>{match?.id.toUpperCase()} · {matchTitle}</strong>
                    <small>{teamName(team) || allocation.teamId} · {formatNumber(allocation.tickets)} {t("common.tickets")}</small>
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
  onSelectWallet,
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
  const activeAllocation = roundAllocations.find((allocation) => allocation.matchId === selectedRoundMatch?.id);
  const selectedTeam = selectedRoundMatch?.teams.includes(selectedTeamId)
    ? teamsById.get(selectedTeamId)
    : null;
  const voteableMatchCount = roundMatches.filter((match) => voteableStatuses.has(match.status)).length;
  const selectedRoundMatchTitle = selectedRoundMatch
    ? selectedRoundMatch.teams.map((teamId) => teamName(teamsById.get(teamId))).join(` ${t("vote.versusShort")} `)
    : "";
  const selectedRoundPrize = activeRound?.matchPrizeAmount
    ? `${formatNumber(activeRound.matchPrizeAmount)}${activeRound.prizeCurrency === "USDT" ? "U" : ` ${activeRound.prizeCurrency}`}`
    : "";

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
              ? ` · ${selectedRoundPrize}`
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
            activeRound={activeRound}
            remainingRoundTickets={remainingRoundTickets}
            usedRoundTickets={usedRoundTickets}
            roundAllocations={roundAllocations}
            matchesById={matchesById}
            teamsById={teamsById}
            onSelectWallet={onSelectWallet}
            copy={copy}
          />
        </GlareHover>
      </section>
    </section>
  );
}
