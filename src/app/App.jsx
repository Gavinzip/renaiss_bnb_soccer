import { useEffect, useMemo, useState } from "react";
import { ControlRoom } from "./components/control-room/ControlRoom";
import { VoteConfirmModal } from "./components/control-room/VoteConfirmModal";
import {
  buildRealtimeRound32Preview,
  createPendingFifaQualificationSnapshot,
  fetchFifaQualificationSnapshot,
} from "./data/fifaRealtime";
import { verifiedLedgerSnapshot } from "./data/ticketLedgerSnapshot";
import { campaignMatches, milestones, roundDefinitions } from "./data/worldCupCampaign";
import { teams } from "./data/teams";
import {
  DEFAULT_MATCH_ID,
  DEFAULT_ROUND_ID,
  DEFAULT_TICKET_AMOUNT,
  DEFAULT_VIEW_ID,
  getRoundById,
  normalizeLedgerSummary,
  normalizeMilestoneSummary,
  summarizeRoundDraw,
} from "./data/campaignRuntime";
import {
  getEmptyPreviewVoteData,
  getRoundOutcomeSummary,
  normalizePreviewVotePayload,
} from "./data/votePreviewRuntime";
import { I18nProvider } from "./i18n/I18nProvider";
import { useCampaignCopy } from "./i18n/useCampaignCopy";

const bundledMilestoneSummary = {
  milestones,
  currentMetricValue: null,
  metricType: "tickets_issued",
  sourceLabel: "bundled",
  sourceStatus: "preview",
  generatedAt: null,
};

function AppContent() {
  const copy = useCampaignCopy();
  const { t } = copy;
  const [ledger, setLedger] = useState(verifiedLedgerSnapshot);
  const [ledgerIssue, setLedgerIssue] = useState("");
  const [milestoneSummary, setMilestoneSummary] = useState(bundledMilestoneSummary);
  const [milestoneIssue, setMilestoneIssue] = useState("");
  const [previewVoteData, setPreviewVoteData] = useState(getEmptyPreviewVoteData);
  const [previewVoteIssue, setPreviewVoteIssue] = useState("");
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW_ID);
  const [simulationMode, setSimulationMode] = useState("scenario");
  const [liveQualification, setLiveQualification] = useState(() => createPendingFifaQualificationSnapshot());
  const [simulatedRoundId, setSimulatedRoundId] = useState(DEFAULT_ROUND_ID);
  const [activeRoundId, setActiveRoundId] = useState(DEFAULT_ROUND_ID);
  const [selectedMatchId, setSelectedMatchId] = useState(DEFAULT_MATCH_ID);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [ticketAmount, setTicketAmount] = useState(DEFAULT_TICKET_AMOUNT);
  const [previewAllocations, setPreviewAllocations] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(verifiedLedgerSnapshot.leaderboardEntries[0].userAddress);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingVoteAmount, setPendingVoteAmount] = useState(null);

  useEffect(() => {
    const summaryUrl = import.meta.env.VITE_LEDGER_SUMMARY_URL;
    if (!summaryUrl) return undefined;

    let cancelled = false;
    fetch(summaryUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeLedgerSummary(payload);
        if (!normalized) throw new Error(t("data.invalidLedgerShape"));
        setLedger(normalized);
        setSelectedWallet(normalized.leaderboardEntries[0]?.userAddress ?? "");
        setLedgerIssue("");
      })
      .catch((error) => {
        if (cancelled) return;
        setLedgerIssue(
          t("data.ledgerIssue", { message: error.message }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const milestoneUrl = import.meta.env.VITE_MILESTONE_SUMMARY_URL;
    if (!milestoneUrl) return undefined;

    let cancelled = false;
    fetch(milestoneUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeMilestoneSummary(payload);
        if (!normalized) throw new Error(t("data.invalidMilestoneShape"));
        setMilestoneSummary(normalized);
        setMilestoneIssue("");
      })
      .catch((error) => {
        if (cancelled) return;
        setMilestoneSummary(bundledMilestoneSummary);
        setMilestoneIssue(
          t("data.milestoneIssue", { message: error.message }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const previewVoteUrl = import.meta.env.VITE_VOTE_PREVIEW_URL || "/mock-api/vote-preview.json";
    let cancelled = false;

    fetch(previewVoteUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizePreviewVotePayload(payload);
        setPreviewVoteData(normalized);
        setPreviewAllocations(normalized.allocations);
        setPreviewVoteIssue("");
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewVoteData(getEmptyPreviewVoteData());
        setPreviewAllocations([]);
        setPreviewVoteIssue(t("data.previewVoteIssue", { message: error.message }));
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (simulationMode !== "realtime") return undefined;

    let cancelled = false;
    let intervalId = 0;

    async function syncFifaStandings() {
      setLiveQualification((current) => (
        current.fetchedAt
          ? { ...current, sourceStatus: "stale", issue: t("liveQualification.refreshing") }
          : createPendingFifaQualificationSnapshot(t("liveQualification.connecting"))
      ));

      try {
        const snapshot = await fetchFifaQualificationSnapshot();
        if (!cancelled) setLiveQualification(snapshot);
      } catch (error) {
        if (cancelled) return;
        setLiveQualification((current) => (
          current.fetchedAt
            ? { ...current, sourceStatus: "stale", issue: error.message }
            : createPendingFifaQualificationSnapshot(error.message)
        ));
      }
    }

    syncFifaStandings();
    intervalId = window.setInterval(syncFifaStandings, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [simulationMode, t]);

  const staticTeamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), []);
  const realtimeRound32Preview = useMemo(
    () => buildRealtimeRound32Preview({ matches: campaignMatches, teams, snapshot: liveQualification }),
    [liveQualification],
  );
  const matches = simulationMode === "realtime" ? realtimeRound32Preview.matches : campaignMatches;
  const teamsById = simulationMode === "realtime" ? realtimeRound32Preview.teamsById : staticTeamsById;
  const displayedLiveQualification = simulationMode === "realtime" ? realtimeRound32Preview.snapshot : liveQualification;
  const simulatedRound = useMemo(() => getRoundById(simulatedRoundId), [simulatedRoundId]);
  const activeRound = useMemo(() => getRoundById(activeRoundId), [activeRoundId]);
  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId)
      ?? matches.find((match) => match.roundId === activeRoundId)
      ?? matches[0],
    [activeRoundId, matches, selectedMatchId],
  );
  const activeEntry = useMemo(
    () => ledger.leaderboardEntries.find((entry) => entry.userAddress === selectedWallet) ?? ledger.leaderboardEntries[0],
    [ledger.leaderboardEntries, selectedWallet],
  );
  const walletAllocations = useMemo(
    () => previewAllocations.filter((allocation) => allocation.walletAddress === selectedWallet),
    [previewAllocations, selectedWallet],
  );
  const walletVoteOutcomes = useMemo(
    () => previewVoteData.outcomes.filter((outcome) => outcome.walletAddress === selectedWallet),
    [previewVoteData.outcomes, selectedWallet],
  );
  const roundAllocations = useMemo(
    () => walletAllocations.filter((allocation) => allocation.roundId === activeRoundId),
    [activeRoundId, walletAllocations],
  );
  const roundVoteOutcomes = useMemo(
    () => walletVoteOutcomes.filter((outcome) => outcome.roundId === activeRoundId),
    [activeRoundId, walletVoteOutcomes],
  );
  const roundOutcomeSummary = useMemo(
    () => getRoundOutcomeSummary(previewVoteData, activeRoundId),
    [activeRoundId, previewVoteData],
  );
  const usedRoundTickets = useMemo(
    () => roundAllocations.reduce((total, allocation) => total + allocation.tickets, 0),
    [roundAllocations],
  );
  const remainingRoundTickets = Math.max(0, (activeEntry?.finalTickets ?? 0) - usedRoundTickets);
  const isRealtimeRound32 = simulationMode === "realtime" && activeRoundId === "round32";
  const visibleRoundAllocations = isRealtimeRound32 ? [] : roundAllocations;
  const visibleRoundVoteOutcomes = isRealtimeRound32 ? [] : roundVoteOutcomes;
  const visibleUsedRoundTickets = isRealtimeRound32
    ? 0
    : usedRoundTickets;
  const visibleRemainingRoundTickets = isRealtimeRound32
    ? Math.max(0, activeEntry?.finalTickets ?? 0)
    : remainingRoundTickets;
  const visibleRoundOutcomeSummary = isRealtimeRound32
    ? { lostTickets: 0, winnerTickets: 0, pendingTickets: 0 }
    : roundOutcomeSummary;
  const drawStats = useMemo(
    () => roundDefinitions.map((round) => summarizeRoundDraw(round, walletAllocations)),
    [walletAllocations],
  );
  const milestoneCurrentValue = milestoneSummary.currentMetricValue ?? (ledger.totalFinalTickets ?? 0);

  useEffect(() => {
    setTicketAmount((current) => Math.max(1, Math.min(current, Math.max(1, visibleRemainingRoundTickets))));
  }, [visibleRemainingRoundTickets]);

  function handleSelectView(viewId) {
    setActiveViewId(viewId);
    setMobileNavOpen(false);
  }

  function handleSelectRound(roundId) {
    const firstMatch = matches.find((match) => match.roundId === roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulatedRound(roundId) {
    const firstMatch = campaignMatches.find((match) => match.roundId === roundId);
    setSimulationMode("scenario");
    setSimulatedRoundId(roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulationMode(nextMode) {
    if (!["scenario", "realtime"].includes(nextMode)) return;
    setSimulationMode(nextMode);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);

    if (nextMode === "realtime") {
      const firstRound32Match = matches.find((match) => match.roundId === "round32")
        ?? campaignMatches.find((match) => match.roundId === "round32");
      setSimulatedRoundId("round32");
      setActiveRoundId("round32");
      setSelectedMatchId(firstRound32Match?.id ?? selectedMatchId);
    }
  }

  function handleSelectMatch(matchId) {
    const match = matches.find((entry) => entry.id === matchId);
    if (match?.roundId && match.roundId !== activeRoundId) {
      setActiveRoundId(match.roundId);
    }
    setSelectedMatchId(matchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectTeam(teamId) {
    if (!teamId) return;
    setSelectedTeamId(teamId);
  }

  function handleRequestPreviewVote(amount) {
    if (!selectedTeamId || remainingRoundTickets <= 0) return;
    setPendingVoteAmount(Math.max(1, Math.min(Math.floor(amount || 0), remainingRoundTickets)));
  }

  function handleConfirmPreviewVote(amount) {
    if (!selectedTeamId || remainingRoundTickets <= 0) return;
    const tickets = Math.max(1, Math.min(Math.floor(amount || 0), remainingRoundTickets));
    setPreviewAllocations((current) => {
      const existingIndex = current.findIndex((allocation) => (
        allocation.walletAddress === selectedWallet
        && allocation.roundId === activeRoundId
        && allocation.matchId === selectedMatch.id
      ));

      if (existingIndex >= 0) {
        const existing = current[existingIndex];
        if (existing.teamId !== selectedTeamId) return current;

        return current.map((allocation, index) => (
          index === existingIndex
            ? { ...allocation, tickets: allocation.tickets + tickets }
            : allocation
        ));
      }

      return [
        ...current,
        {
          id: `${selectedWallet}-${selectedMatch.id}-${selectedTeamId}-${Date.now()}`,
          walletAddress: selectedWallet,
          roundId: activeRoundId,
          matchId: selectedMatch.id,
          teamId: selectedTeamId,
          tickets,
          source: "local-preview",
          official: false,
        },
      ];
    });
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
    setPendingVoteAmount(null);
  }

  return (
    <>
      <ControlRoom
        activeViewId={activeViewId}
        mobileNavOpen={mobileNavOpen}
        ledger={ledger}
        ledgerIssue={ledgerIssue}
        activeEntry={activeEntry}
        selectedWallet={selectedWallet}
        simulatedRound={simulatedRound}
        simulatedRoundId={simulatedRoundId}
        activeRound={activeRound}
        activeRoundId={activeRoundId}
        rounds={roundDefinitions}
        matches={matches}
        teamsById={teamsById}
        selectedMatch={selectedMatch}
        selectedTeamId={selectedTeamId}
        ticketAmount={ticketAmount}
        remainingRoundTickets={visibleRemainingRoundTickets}
        usedRoundTickets={visibleUsedRoundTickets}
        roundAllocations={visibleRoundAllocations}
        roundVoteOutcomes={visibleRoundVoteOutcomes}
        roundOutcomeSummary={visibleRoundOutcomeSummary}
        previewVoteIssue={previewVoteIssue}
        drawStats={drawStats}
        milestones={milestoneSummary.milestones}
        currentMilestoneValue={milestoneCurrentValue}
        simulationMode={simulationMode}
        liveQualification={displayedLiveQualification}
        onSelectView={handleSelectView}
        onToggleMobileNav={() => setMobileNavOpen((current) => !current)}
        onSelectWallet={setSelectedWallet}
        onSelectRound={handleSelectRound}
        onSelectSimulatedRound={handleSelectSimulatedRound}
        onSelectSimulationMode={handleSelectSimulationMode}
        onSelectMatch={handleSelectMatch}
        onSelectTeam={handleSelectTeam}
        onSetTicketAmount={setTicketAmount}
        onConfirmPreviewVote={handleRequestPreviewVote}
      />
      <VoteConfirmModal
        amount={pendingVoteAmount}
        match={selectedMatch}
        team={teamsById.get(selectedTeamId)}
        onCancel={() => setPendingVoteAmount(null)}
        onConfirm={() => handleConfirmPreviewVote(pendingVoteAmount)}
      />
    </>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;
