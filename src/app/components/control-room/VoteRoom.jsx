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
import { useEffect, useMemo, useRef } from "react";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import ElasticSlider from "../ElasticSlider/ElasticSlider";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { MatchPrizeList } from "./MatchPrizeList";
import ticketIcon from "../../assets/ticket-icon-inverted.png";

const ticketStoreUrl = "https://www.renaiss.xyz/gacha/omega";
const voteableStatuses = new Set(["open", "closing_soon"]);
const matchPhaseOrder = {
  official_final: 0,
  locked: 1,
  in_play: 1,
  scheduled: 1,
  closing_soon: 2,
  open: 2,
};

export function preloadRoomAssets() {
  return Promise.resolve();
}

function clampTicketAmount(value, maxTickets) {
  return Math.max(1, Math.min(Math.floor(Number(value) || 1), Math.max(1, maxTickets)));
}

function compactRoundValue(round, fallbackLabel = "") {
  const values = {
    round32: "32",
    round16: "16",
    quarterFinal: "8",
    semiFinal: "4",
  };
  return values[round?.id] ?? fallbackLabel;
}

function matchDisplayCode(match) {
  return String(match?.displayCode || match?.id || "").toUpperCase();
}

function getTicketVoteState({
  copy,
  remainingRoundTickets,
  selectedMatch,
  selectedTeam,
  ticketAmount,
  voteActionBlocked = false,
}) {
  const maxTickets = Math.max(1, remainingRoundTickets);
  const boundedTicketAmount = clampTicketAmount(ticketAmount, maxTickets);
  const selectedTeamName = selectedTeam ? copy.teamName(selectedTeam) : null;
  const selectedMatchLabel = selectedMatch ? matchDisplayCode(selectedMatch) : null;
  const selectedPhase = selectedMatch ? getMatchPhase(selectedMatch) : null;
  const hasNoRemainingTickets = remainingRoundTickets <= 0;
  const canSubmit = Boolean(
    selectedTeam
    && selectedMatch
    && voteableStatuses.has(selectedMatch.status)
    && remainingRoundTickets > 0
    && !voteActionBlocked,
  );

  return {
    boundedTicketAmount,
    canSubmit,
    hasNoRemainingTickets,
    maxTickets,
    selectedMatchLabel,
    selectedPhase,
    selectedTeamName,
  };
}

function getMatchIcon(match, allocation) {
  if (match.awaitingOfficialResult) return Clock3;
  if (match.status === "open") return Ticket;
  if (match.status === "closing_soon") return Clock3;
  if (match.status === "official_final") return ShieldCheck;
  if (match.status === "in_play") return Clock3;
  return LockKeyhole;
}

function getMatchPhase(match) {
  if (match.awaitingOfficialResult) {
    return {
      id: "locked",
      labelKey: "vote.phasePendingResult",
    };
  }

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

  if (match.status === "locked") {
    return {
      id: "locked",
      labelKey: "vote.phaseLocked",
    };
  }

  if (match.status === "in_play") {
    return {
      id: "live",
      labelKey: "vote.phaseInPlay",
    };
  }

  return {
    id: "scheduled",
    labelKey: "vote.phaseScheduled",
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

function MatchVoteGroup({
  match,
  allocations = [],
  selectedMatchId,
  selectedTeamId,
  teamsById,
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
  const canSelectTeam = voteableStatuses.has(match.status);
  const selected = selectedMatchId === match.id;
  const MatchIcon = getMatchIcon(match, matchAllocations[0]);
  const phase = getMatchPhase(match);
  const tone = getMatchTone(match);

  function handlePickTeam(team) {
    onSelectMatch(match.id);
    if (canSelectTeam) onSelectTeam(team.id);
  }

  return (
    <article className={[
      "vote-match-group",
      `is-${tone}`,
      selected ? "is-selected" : "",
    ].filter(Boolean).join(" ")}
    >
      <header className="vote-match-group__header">
        <span className="vote-match-group__code">{matchDisplayCode(match)}</span>
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

      <section className="vote-match-group__teams" aria-label={t("schedule.teamsAria", { match: matchDisplayCode(match) })}>
        {teams.map((team, index) => {
          const allocation = getTeamAllocation(allocations, match.id, team.id);
          const teamTone = getTeamTone(match, team, allocation, selected && selectedTeamId);
          const isSelected = selected && selectedTeamId === team.id;
          const disabled = !canSelectTeam;
          const stateText = allocation
            ? t("vote.allocationForMatch", { team: teamName(team), tickets: formatNumber(allocation.tickets) })
            : isSelected
              ? t("vote.selectedForPreview")
              : canSelectTeam
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
  roundTicketBreakdown,
  usedRoundTickets,
  voteActionBlocked,
  voteActionBlockReason,
  onSetTicketAmount,
  onConfirmPreviewVote,
  onRequestVoteEligibility,
  copy,
}) {
  const { roundLabel, t } = copy;
  const {
    boundedTicketAmount,
    canSubmit,
    hasNoRemainingTickets,
    maxTickets,
    selectedMatchLabel,
    selectedPhase,
    selectedTeamName,
  } = getTicketVoteState({
    copy,
    remainingRoundTickets,
    selectedMatch,
    selectedTeam,
    ticketAmount,
    voteActionBlocked,
  });
  const statusMessage = voteActionBlocked
    ? voteActionBlockReason || t("vote.voteEligibilityBlocked")
    : canSubmit
      ? t("vote.votePanelReady", { team: selectedTeamName, match: selectedMatchLabel })
      : t("vote.votePanelIdle");

  function handleSetTicketAmount(value) {
    onSetTicketAmount(clampTicketAmount(value, maxTickets));
  }

  const ctaBlockedByEligibility = voteActionBlocked && !hasNoRemainingTickets;
  const ctaClassName = [
    "vote-allocation-panel__cta",
    ctaBlockedByEligibility ? "is-eligibility-action" : "",
  ].filter(Boolean).join(" ");
  const ctaIcon = ctaBlockedByEligibility
    ? <ShieldCheck size={17} strokeWidth={2.35} />
    : canSubmit
      ? <Send size={17} strokeWidth={2.35} />
      : <LockKeyhole size={17} strokeWidth={2.35} />;
  const ctaLabel = ctaBlockedByEligibility
    ? t("xFollowGate.verifyEligibility")
    : t("vote.submitPreviewVote");
  const ctaDisabled = ctaBlockedByEligibility ? !onRequestVoteEligibility : !canSubmit;

  return (
    <aside className={voteActionBlocked ? "vote-allocation-panel is-action-blocked" : "vote-allocation-panel"} aria-label={t("vote.votePanelTitle")}>
      <header>
        <span>{roundLabel(activeRound, "advanceLabel")}</span>
        <h2>{t("vote.votePanelTitle")}</h2>
        <p>{statusMessage}</p>
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
          <span className="vote-ticket-unit">
            <img src={ticketIcon} alt="" aria-hidden="true" />
            {t("common.tickets")}
          </span>
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

      {hasNoRemainingTickets ? (
        <Magnet
          as="a"
          className="vote-allocation-panel__cta is-ticket-store-link"
          href={ticketStoreUrl}
          strength={44}
        >
          <span className="vote-allocation-panel__cta-content">
            <Ticket size={17} strokeWidth={2.35} />
            <span>{t("vote.getMoreTickets")}</span>
          </span>
        </Magnet>
      ) : (
        <Magnet
          as="button"
          className={ctaClassName}
          type="button"
          strength={44}
          disabled={ctaDisabled}
          onClick={ctaBlockedByEligibility
            ? onRequestVoteEligibility
            : () => onConfirmPreviewVote(boundedTicketAmount, {
              matchId: selectedMatch?.id || "",
              teamId: selectedTeam?.id || "",
            })}
        >
          <span className="vote-allocation-panel__cta-content">
            {ctaIcon}
            <span>{ctaLabel}</span>
          </span>
        </Magnet>
      )}
    </aside>
  );
}

function MobileTicketDock({
  selectedMatch,
  selectedTeam,
  ticketAmount,
  remainingRoundTickets,
  voteActionBlocked,
  onSetTicketAmount,
  onConfirmPreviewVote,
  onRequestVoteEligibility,
  copy,
}) {
  const { t } = copy;
  const {
    boundedTicketAmount,
    canSubmit,
    hasNoRemainingTickets,
    maxTickets,
    selectedMatchLabel,
    selectedPhase,
    selectedTeamName,
  } = getTicketVoteState({
    copy,
    remainingRoundTickets,
    selectedMatch,
    selectedTeam,
    ticketAmount,
    voteActionBlocked,
  });
  const selectedPhaseLabel = selectedPhase ? t(selectedPhase.labelKey) : "";

  function handleSetTicketAmount(value) {
    onSetTicketAmount(clampTicketAmount(value, maxTickets));
  }

  const Action = hasNoRemainingTickets ? "a" : "button";
  const actionProps = hasNoRemainingTickets
    ? { href: ticketStoreUrl }
    : voteActionBlocked
      ? {
        type: "button",
        disabled: !onRequestVoteEligibility,
        onClick: onRequestVoteEligibility,
      }
    : {
      type: "button",
      disabled: !canSubmit,
      onClick: () => onConfirmPreviewVote(boundedTicketAmount, {
        matchId: selectedMatch?.id || "",
        teamId: selectedTeam?.id || "",
      }),
    };
  const ctaLabel = hasNoRemainingTickets
    ? t("vote.getMoreTickets")
    : voteActionBlocked
      ? t("xFollowGate.verifyEligibility")
      : t("vote.mobilePreviewCta");
  const ctaClassName = [
    "mobile-vote-dock__cta",
    voteActionBlocked && !hasNoRemainingTickets ? "is-eligibility-action" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside className={selectedTeam ? "mobile-vote-dock has-team" : "mobile-vote-dock"} aria-label={t("vote.mobileQuickAllocation")}>
      <section className="mobile-vote-dock__target" aria-live="polite">
        {selectedTeam ? (
          <>
            <img src={selectedTeam.flagSrc} alt="" aria-hidden="true" />
            <span>
              <small>{selectedMatchLabel} · {selectedPhaseLabel}</small>
              <strong>{selectedTeamName}</strong>
            </span>
          </>
        ) : (
          <span>
            <small>{t("vote.selectedTargetLabel")}</small>
            <strong>{t("vote.selectedTargetEmpty")}</strong>
          </span>
        )}
      </section>

      <fieldset className="mobile-vote-dock__stepper" disabled={!canSubmit}>
        <legend>{t("common.allocationAmount")}</legend>
        <button type="button" onClick={() => handleSetTicketAmount(boundedTicketAmount - 1)} aria-label={t("vote.decreaseTickets")}>
          <Minus size={15} strokeWidth={2.35} />
        </button>
        <label>
          <span className="vote-ticket-unit">
            <img src={ticketIcon} alt="" aria-hidden="true" />
            {t("common.tickets")}
          </span>
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
          <Plus size={15} strokeWidth={2.35} />
        </button>
      </fieldset>

      <ElasticSlider
        className="mobile-vote-dock__range"
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

      <Action className={ctaClassName} {...actionProps}>
        {voteActionBlocked && !hasNoRemainingTickets ? <ShieldCheck size={15} strokeWidth={2.35} /> : null}
        <span>{ctaLabel}</span>
      </Action>
    </aside>
  );
}

function VoteWalletPanel({
  ledger,
  ledgerIssue,
  previewVoteIssue,
  selectedWallet,
  authSession,
  authEndpointReady,
  onSelectWallet,
  onRequestLogin,
  copy,
}) {
  const { t } = copy;
  const authWalletLinked = Boolean(authSession?.walletAddress);
  const authActionable = authEndpointReady && !authSession?.authenticated;
  const VoteWalletAuth = authActionable ? "button" : "div";

  return (
    <aside className="vote-wallet-panel vote-wallet-panel--compact" aria-label={authEndpointReady ? t("auth.accountAria") : t("vote.previewWallet")}>
      <header>
        <span>
          <WalletCards size={15} strokeWidth={2.25} />
          {authEndpointReady ? t("auth.account") : t("vote.previewWallet")}
        </span>
        {authEndpointReady ? (
          <VoteWalletAuth
            className={authActionable ? "vote-wallet-panel__auth" : "vote-wallet-panel__auth is-static"}
            {...(authActionable ? { type: "button", onClick: onRequestLogin } : {})}
          >
            <strong>{authWalletLinked ? compactAddress(authSession.walletAddress) : authSession?.authenticated ? t("auth.walletUnlinked") : t("auth.loginCta")}</strong>
            <small>{authWalletLinked ? t("auth.linked") : t("auth.loginDetail")}</small>
          </VoteWalletAuth>
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
  roundTicketBreakdown,
  usedRoundTickets,
  roundAllocations,
  roundVoteOutcomes = [],
  roundOutcomeSummary,
  previewVoteIssue = "",
  voteActionBlocked = false,
  voteActionBlockReason = "",
  authSession,
  authEndpointReady = false,
  onSelectWallet,
  onRequestLogin,
  onSelectMatch,
  onSelectTeam,
  onSetTicketAmount,
  onConfirmPreviewVote,
  onRequestVoteEligibility,
}) {
  const copy = useCampaignCopy();
  const { roundLabel, t } = copy;
  const autoSelectedRoundRef = useRef("");
  const roundMatches = useMemo(
    () => [...matches]
      .filter((match) => match.roundId === activeRoundId)
      .sort(sortMatchesByDisplayPhase),
    [activeRoundId, matches],
  );
  const preferredRoundMatch = roundMatches.find((match) => voteableStatuses.has(match.status)) ?? roundMatches[0] ?? null;
  const selectedMatchInRound = Boolean(selectedMatch && roundMatches.some((match) => match.id === selectedMatch.id));
  const selectedRoundMatch = selectedMatchInRound ? selectedMatch : preferredRoundMatch;
  const selectedTeam = selectedRoundMatch?.teams.includes(selectedTeamId)
    ? teamsById.get(selectedTeamId)
    : null;
  const activeRoundLabel = roundLabel(activeRound);
  const activeRoundSummaryValue = compactRoundValue(activeRound, activeRoundLabel);
  const activeRoundAdvanceLabel = roundLabel(activeRound, "advanceLabel");
  const userTotalTickets = Math.max(
    0,
    Math.floor(Number(roundTicketBreakdown?.usableTickets ?? activeEntry?.totalVotingTickets ?? activeEntry?.finalTickets) || 0),
  );

  useEffect(() => {
    const selectedIsVoteable = Boolean(
      selectedMatchInRound
      && selectedMatch
      && voteableStatuses.has(selectedMatch.status),
    );
    if (!preferredRoundMatch || autoSelectedRoundRef.current === activeRoundId || selectedIsVoteable) return;

    autoSelectedRoundRef.current = activeRoundId;
    onSelectMatch?.(preferredRoundMatch.id);
  }, [
    activeRoundId,
    onSelectMatch,
    preferredRoundMatch,
    selectedMatch,
    selectedMatchInRound,
  ]);

  return (
    <section
      className="vote-room vote-room-groups is-match-prize-list"
      aria-label={t("vote.roomAria")}
    >
      <header className="vote-stage-head">
        <h1 className="vote-stage-head__sr-title">{t("vote.stageDeckTitle", { round: activeRoundAdvanceLabel })}</h1>
        <div className="vote-stage-hero">
          <section
            className="vote-stage-summary"
            style={{ "--vote-summary-count": 3 }}
            aria-label={t("vote.currentRoundSummary")}
          >
            <output className="is-round">
              <span>{t("vote.stageSummaryRound")}</span>
              <strong>{activeRoundSummaryValue}</strong>
              <small>{activeRoundAdvanceLabel}</small>
            </output>
            <output className="is-user-tickets">
              <span>{t("vote.stageSummaryYourTickets")}</span>
              <strong>{formatNumber(userTotalTickets)}</strong>
              <small>{t("vote.stageSummaryWalletHint")}</small>
            </output>
            <output className="is-remaining">
              <span>{t("vote.stageSummaryRemainingTickets")}</span>
              <strong>{formatNumber(remainingRoundTickets)}</strong>
              <small>{t("vote.stageSummaryUsedTickets", { tickets: formatNumber(usedRoundTickets) })}</small>
            </output>
          </section>
        </div>
      </header>

      <section className="vote-room-grid">
        <section className="vote-prize-stage" aria-label={t("common.prizes")}>
          <MatchPrizeList
            activeRound={activeRound}
            matches={roundMatches}
            teamsById={teamsById}
            selectedMatchId={selectedRoundMatch?.id}
            selectedTeamId={selectedTeamId}
            roundAllocations={roundAllocations}
            roundVoteOutcomes={roundVoteOutcomes}
            onSelectMatch={onSelectMatch}
            onSelectTeam={onSelectTeam}
            copy={copy}
          />
        </section>

        <GlareHover as="aside" className="vote-side-rail">
          <TicketAllocationPanel
            selectedMatch={selectedRoundMatch}
            selectedTeam={selectedTeam}
            activeRound={activeRound}
            ticketAmount={ticketAmount}
            remainingRoundTickets={remainingRoundTickets}
            roundTicketBreakdown={roundTicketBreakdown}
            usedRoundTickets={usedRoundTickets}
            voteActionBlocked={voteActionBlocked}
            voteActionBlockReason={voteActionBlockReason}
            onSetTicketAmount={onSetTicketAmount}
            onConfirmPreviewVote={onConfirmPreviewVote}
            onRequestVoteEligibility={onRequestVoteEligibility}
            copy={copy}
          />

          <VoteWalletPanel
            ledger={ledger}
            ledgerIssue={ledgerIssue}
            previewVoteIssue={previewVoteIssue}
            selectedWallet={selectedWallet}
            authSession={authSession}
            authEndpointReady={authEndpointReady}
            onSelectWallet={onSelectWallet}
            onRequestLogin={onRequestLogin}
            copy={copy}
          />
        </GlareHover>
      </section>

      <MobileTicketDock
        selectedMatch={selectedRoundMatch}
        selectedTeam={selectedTeam}
        ticketAmount={ticketAmount}
        remainingRoundTickets={remainingRoundTickets}
        voteActionBlocked={voteActionBlocked}
        onSetTicketAmount={onSetTicketAmount}
        onConfirmPreviewVote={onConfirmPreviewVote}
        onRequestVoteEligibility={onRequestVoteEligibility}
        copy={copy}
      />
    </section>
  );
}
